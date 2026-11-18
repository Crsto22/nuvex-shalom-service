import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { SecretsCryptoService } from '../../../../libs/security/src/secrets-crypto.service';

/**
 * Guard temporal de administracion (Fase 5 lo reemplaza por API keys con scopes).
 * Si ADMIN_TOKEN no esta configurado, el servicio asume entorno de desarrollo.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly crypto: SecretsCryptoService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('ADMIN_TOKEN')?.trim();
    if (!expected) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-admin-token'];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided || !this.crypto.safeEqual(provided, expected)) {
      throw new UnauthorizedException('X-Admin-Token invalido');
    }
    return true;
  }
}
