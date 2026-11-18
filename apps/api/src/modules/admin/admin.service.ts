import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../../../../libs/database/src/prisma.service';
import {
  API_KEY_SCOPES,
  generateApiKey,
  hashApiKey,
} from '../../../../../libs/security/src/api-key';
import { SecretsCryptoService } from '../../../../../libs/security/src/secrets-crypto.service';
import { SessionManager } from '../../../../../libs/session/src/session-manager.service';
import { AuditService } from '../../common/audit.service';
import type {
  AuditQueryDto,
  CreateApiKeyDto,
  CreateTenantDto,
  CreateWebhookDto,
  UpdateShalomCredentialsDto,
} from './dto/admin.dto';

const ADMIN_ACTOR = 'admin-token';

@Injectable()
export class AdminService {
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretsCryptoService,
    private readonly audit: AuditService,
    private readonly sessions: SessionManager,
    config: ConfigService,
  ) {
    this.pepper = config.get<string>('API_KEY_PEPPER') ?? '';
  }

  private async requireApplication(applicationId: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) throw new NotFoundException('Aplicacion no encontrada');
    return application;
  }

  /** Crea una API key. El valor completo se devuelve una sola vez. */
  async createApiKey(applicationId: string, dto: CreateApiKeyDto) {
    await this.requireApplication(applicationId);

    const environment = dto.environment ?? 'PRODUCTION';
    const generated = generateApiKey(
      this.pepper,
      environment === 'SANDBOX' ? 'sandbox' : 'production',
    );

    const apiKey = await this.prisma.apiKey.create({
      data: {
        applicationId,
        prefix: generated.prefix,
        hashedKey: generated.hashedKey,
        environment,
        scopes: dto.scopes ?? [...API_KEY_SCOPES],
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { tenantId: true, code: true },
    });

    await this.audit.record({
      tenantId: application?.tenantId ?? null,
      actor: ADMIN_ACTOR,
      action: 'api_key.created',
      target: apiKey.id,
      metadata: { prefix: apiKey.prefix, environment, scopes: apiKey.scopes },
    });

    return {
      id: apiKey.id,
      prefix: apiKey.prefix,
      scopes: apiKey.scopes,
      environment: apiKey.environment,
      expiresAt: apiKey.expiresAt,
      /** Guardar ahora: no se puede recuperar despues. */
      apiKey: generated.plain,
    };
  }

  async listApiKeys(applicationId: string) {
    await this.requireApplication(applicationId);

    const keys = await this.prisma.apiKey.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map((key) => ({
      id: key.id,
      prefix: key.prefix,
      environment: key.environment,
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
    }));
  }

  async revokeApiKey(apiKeyId: string) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    if (!existing) throw new NotFoundException('API key no encontrada');

    const key = await this.prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      actor: ADMIN_ACTOR,
      action: 'api_key.revoked',
      target: key.id,
      metadata: { prefix: key.prefix },
    });

    return { id: key.id, revokedAt: key.revokedAt };
  }

  /** Registra un endpoint de webhooks; el secreto de firma se devuelve una vez. */
  async createWebhook(applicationId: string, dto: CreateWebhookDto) {
    await this.requireApplication(applicationId);

    const secret = `whsec_${randomBytes(24).toString('base64url')}`;

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { applicationId, url: dto.url, events: dto.events, secret },
    });

    await this.audit.record({
      actor: ADMIN_ACTOR,
      action: 'webhook.created',
      target: endpoint.id,
      metadata: { url: endpoint.url, events: endpoint.events },
    });

    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      secret,
      signatureHeader: 'X-Shalom-Signature: t=<unix>,v1=<hmac_sha256(secret, "t.body")>',
    };
  }

  async listWebhooks(applicationId: string) {
    await this.requireApplication(applicationId);

    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });

    return endpoints.map((endpoint) => ({
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      active: endpoint.active,
      deliveries: endpoint.deliveries.map((delivery) => ({
        id: delivery.id,
        event: delivery.event,
        status: delivery.status,
        attempts: delivery.attempts,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt,
      })),
    }));
  }

  /** Verifica y hashea una key existente (util para soporte). */
  hashKey(plain: string): string {
    return hashApiKey(this.pepper, plain);
  }

  /** Guarda (cifradas) las credenciales de Shalom del tenant. */
  async updateCredentials(tenantId: string, dto: UpdateShalomCredentialsDto, validate = false) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const encrypted = this.crypto.encrypt(
      dto.password,
      `tenant:${tenantId}:shalom-password`,
    );

    await this.prisma.shalomCredential.upsert({
      where: { tenantId },
      create: { tenantId, username: dto.username, encryptedPassword: encrypted },
      update: { username: dto.username, encryptedPassword: encrypted },
    });

    await this.audit.record({
      tenantId,
      actor: ADMIN_ACTOR,
      action: 'credentials.updated',
      target: tenant.code,
      metadata: { username: dto.username },
    });

    if (validate) {
      return this.validateCredentials(tenantId);
    }

    return { tenantId, username: dto.username, updated: true };
  }

  /** Intenta iniciar sesion con las credenciales guardadas y devuelve el resultado. */
  async validateCredentials(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const attempt = await this.sessions.login(tenantId);
    const ok = attempt.status === 'ACTIVE';

    await this.audit.record({
      tenantId,
      actor: ADMIN_ACTOR,
      action: 'credentials.validated',
      target: tenant.code,
      metadata: { ok, status: attempt.status, outcome: attempt.outcome ?? null },
    });

    return {
      tenantId,
      valid: ok,
      status: attempt.status,
      outcome: attempt.outcome ?? null,
      message: attempt.message ?? null,
      lastLoginAt: attempt.lastLoginAt,
    };
  }

  /**
   * Alta de empresa completa: tenant + credenciales (opcional) + aplicacion + API key.
   * Devuelve la key completa una sola vez.
   */
  async createTenant(dto: CreateTenantDto) {
    if ((dto.username && !dto.password) || (!dto.username && dto.password)) {
      throw new ConflictException('username y password deben enviarse juntos');
    }

    const existing = await this.prisma.tenant.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`Ya existe una empresa con code "${dto.code}"`);

    let tenant;
    try {
      tenant = await this.prisma.tenant.create({
        data: { code: dto.code, name: dto.name },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Ya existe una empresa con code "${dto.code}"`);
      }
      throw error;
    }

    if (dto.username && dto.password) {
      await this.prisma.shalomCredential.create({
        data: {
          tenantId: tenant.id,
          username: dto.username,
          encryptedPassword: this.crypto.encrypt(
            dto.password,
            `tenant:${tenant.id}:shalom-password`,
          ),
        },
      });
    }

    const applicationCode = dto.applicationCode ?? 'nuvex';
    const application = await this.prisma.application.create({
      data: {
        tenantId: tenant.id,
        code: applicationCode,
        name: dto.applicationName ?? applicationCode,
      },
    });

    const generated = generateApiKey(this.pepper, 'production');
    const apiKey = await this.prisma.apiKey.create({
      data: {
        applicationId: application.id,
        prefix: generated.prefix,
        hashedKey: generated.hashedKey,
        environment: 'PRODUCTION',
        scopes: [...API_KEY_SCOPES],
      },
    });

    await this.audit.record({
      tenantId: tenant.id,
      actor: ADMIN_ACTOR,
      action: 'tenant.created',
      target: tenant.code,
      metadata: {
        applicationId: application.id,
        applicationCode,
        credentials: Boolean(dto.username),
        apiKeyPrefix: apiKey.prefix,
      },
    });

    return {
      tenantId: tenant.id,
      code: tenant.code,
      name: tenant.name,
      applicationId: application.id,
      applicationCode,
      apiKey: generated.plain,
      apiKeyPrefix: apiKey.prefix,
      credentialsConfigured: Boolean(dto.username),
    };
  }

  /** Historial de cambios administrativos. */
  listAudit(query: AuditQueryDto) {
    return this.audit.list({ tenantId: query.tenantId, limit: query.limit });
  }

  /** Estado de sesion de todas las empresas (para monitoreo). */
  async listSessions() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        session: { select: { status: true, lastLoginAt: true, lastError: true } },
      },
    });

    return tenants.map((tenant) => ({
      tenantId: tenant.id,
      code: tenant.code,
      name: tenant.name,
      status: tenant.session?.status ?? 'SIN_SESION',
      lastLoginAt: tenant.session?.lastLoginAt ?? null,
      lastError: tenant.session?.lastError ?? null,
    }));
  }
}
