import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PrismaService } from '../../../../libs/database/src/prisma.service';
import { hasScopes, hashApiKey } from '../../../../libs/security/src/api-key';
import { AUTH_REQUEST_KEY, type AuthContext } from './auth-context';
import { SCOPES_METADATA } from './auth.decorators';
import { ApplicationRateLimiter } from './rate-limiter';

/**
 * Autentica con `Authorization: Bearer <api key>`.
 *
 * Resuelve tenant + aplicacion + scopes desde el HMAC de la key, verifica
 * vigencia y aplica el limite de peticiones por aplicacion.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly limiter: ApplicationRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.bearer(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Se requiere Authorization: Bearer <api key>');
    }

    const pepper = this.config.get<string>('API_KEY_PEPPER') ?? '';
    const hashedKey = hashApiKey(pepper, token);

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { hashedKey },
      include: { application: { include: { tenant: true } } },
    });

    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException('API key invalida o revocada');
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('API key expirada');
    }
    if (apiKey.application.status !== 'ACTIVE' || apiKey.application.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException('Aplicacion o tenant inactivo');
    }

    if (!this.limiter.consume(apiKey.applicationId)) {
      throw new ForbiddenException('Limite de peticiones por aplicacion excedido');
    }

    const required =
      this.reflector.getAllAndOverride<string[]>(SCOPES_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length > 0 && !hasScopes(apiKey.scopes, required)) {
      throw new ForbiddenException(`Faltan scopes: ${required.join(', ')}`);
    }

    const auth: AuthContext = {
      apiKeyId: apiKey.id,
      tenantId: apiKey.application.tenantId,
      applicationId: apiKey.applicationId,
      environment: apiKey.environment,
      scopes: apiKey.scopes,
    };

    (request as unknown as Record<string, AuthContext>)[AUTH_REQUEST_KEY] = auth;
    return true;
  }

  private bearer(header?: string): string | null {
    const [scheme, token, extra] = header?.trim().split(/\s+/) ?? [];
    if (scheme !== 'Bearer' || !token || extra) return null;
    return token;
  }
}
