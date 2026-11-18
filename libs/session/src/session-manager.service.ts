import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../database/src/prisma.service';
import { SecretsCryptoService } from '../../security/src/secrets-crypto.service';
import { SHALOM_DRIVER } from '../../shalom/src/tokens';
import { ShalomError, type ShalomDriver } from '../../shalom/src/types';

export type SessionStatus = 'ACTIVE' | 'EXPIRED' | 'REQUIERE_LOGIN_MANUAL';

export type SessionView = {
  tenantId: string;
  status: SessionStatus;
  lastLoginAt: Date | null;
  lastError: string | null;
  expiresAt: Date | null;
};

export type LoginAttempt = SessionView & {
  outcome?: string;
  message?: string;
  /** true si se reutilizo una sesion valida en lugar de loguear. */
  reused?: boolean;
};

/**
 * Unica puerta de acceso a la sesion de Shalom.
 *
 * - Guarda el storage state cifrado por tenant.
 * - Re-loguea automaticamente cuando la sesion cayo (con credenciales cifradas).
 * - Aplica un cooldown por tenant para no martillar el login (Shalom invalida
 *   sesiones anteriores y castiga los intentos repetidos).
 */
@Injectable()
export class SessionManager {
  private readonly logger = new Logger(SessionManager.name);
  private readonly cooldownMs: number;

  /** ultimo intento de login por tenant (para el cooldown). */
  private readonly lastAttempt = new Map<string, number>();
  /** login en curso por tenant (evita dos logins simultaneos). */
  private readonly inFlight = new Map<string, Promise<LoginAttempt>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretsCryptoService,
    @Inject(SHALOM_DRIVER) private readonly driver: ShalomDriver,
    config: ConfigService,
  ) {
    this.cooldownMs = Number(config.get<number>('SHALOM_RELOGIN_COOLDOWN_SECONDS') ?? 30) * 1_000;
  }

  sessionContext(tenantId: string): string {
    return `tenant:${tenantId}:shalom-session`;
  }

  passwordContext(tenantId: string): string {
    return `tenant:${tenantId}:shalom-password`;
  }

  async get(tenantId: string): Promise<SessionView> {
    const session = await this.prisma.shalomSession.findUnique({ where: { tenantId } });
    if (!session) {
      return {
        tenantId,
        status: 'REQUIERE_LOGIN_MANUAL',
        lastLoginAt: null,
        lastError: 'Sin sesion registrada',
        expiresAt: null,
      };
    }

    return {
      tenantId,
      status: session.status,
      lastLoginAt: session.lastLoginAt,
      lastError: session.lastError,
      expiresAt: session.expiresAt,
    };
  }

  /** Storage state listo para usar o error SESSION_REQUIRED. */
  async requireStorageState(tenantId: string): Promise<string> {
    const session = await this.prisma.shalomSession.findUnique({ where: { tenantId } });

    if (session?.status === 'ACTIVE' && session.encryptedStorageState) {
      return this.crypto.decrypt(session.encryptedStorageState, this.sessionContext(tenantId));
    }

    this.logger.warn(`Sesion de ${tenantId} no disponible (${session?.status ?? 'sin sesion'}); intentando re-login`);
    const attempt = await this.login(tenantId, { auto: true });
    const storage = await this.readStorageState(tenantId);
    if (storage) return storage;

    throw new ShalomError(
      `No se pudo iniciar sesion en Shalom: ${attempt.message ?? attempt.status}`,
      'SESSION_REQUIRED',
    );
  }

  /** Login explicito (API) o automatico (worker). */
  async login(tenantId: string, options: { auto?: boolean } = {}): Promise<LoginAttempt> {
    const running = this.inFlight.get(tenantId);
    if (running) return running;

    const last = this.lastAttempt.get(tenantId) ?? 0;
    if (options.auto && Date.now() - last < this.cooldownMs) {
      const storage = await this.readStorageState(tenantId);
      if (storage) {
        return { ...(await this.get(tenantId)), reused: true };
      }
      return {
        ...(await this.get(tenantId)),
        message: 'Re-login en espera (cooldown)',
      };
    }

    const promise = this.performLogin(tenantId).finally(() => this.inFlight.delete(tenantId));
    this.inFlight.set(tenantId, promise);
    return promise;
  }

  /** Intento de recuperacion usado por el worker tras un SESSION_REQUIRED. */
  async recover(tenantId: string): Promise<boolean> {
    this.lastAttempt.delete(tenantId); // permite un intento inmediato
    const attempt = await this.login(tenantId, { auto: true });
    return attempt.status === 'ACTIVE' && Boolean(await this.readStorageState(tenantId));
  }

  async markManual(tenantId: string, message: string): Promise<void> {
    await this.prisma.shalomSession
      .updateMany({
        where: { tenantId },
        data: { status: 'REQUIERE_LOGIN_MANUAL', lastError: message.slice(0, 500) },
      })
      .catch(() => undefined);

    this.logger.error(`TENANT ${tenantId} requiere login manual: ${message}`);
  }

  private async performLogin(tenantId: string): Promise<LoginAttempt> {
    this.lastAttempt.set(tenantId, Date.now());

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { credentials: true },
    });

    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    if (!tenant.credentials) {
      const message = 'El tenant no tiene credenciales de Shalom configuradas';
      await this.markManual(tenantId, message);
      return { ...(await this.get(tenantId)), message };
    }

    const password = this.crypto.decrypt(
      tenant.credentials.encryptedPassword,
      this.passwordContext(tenantId),
    );

    const result = await this.driver.login(tenant.credentials.username, password);

    if (result.outcome === 'SUCCESS' && result.storageState) {
      const encrypted = this.crypto.encrypt(result.storageState, this.sessionContext(tenantId));
      const session = await this.prisma.shalomSession.upsert({
        where: { tenantId },
        create: {
          tenantId,
          encryptedStorageState: encrypted,
          status: 'ACTIVE',
          lastLoginAt: new Date(),
          lastError: null,
        },
        update: {
          encryptedStorageState: encrypted,
          status: 'ACTIVE',
          lastLoginAt: new Date(),
          lastError: null,
        },
      });

      this.logger.log(`Sesion renovada para tenant ${tenant.code}`);

      return {
        tenantId,
        status: session.status,
        lastLoginAt: session.lastLoginAt,
        lastError: session.lastError,
        expiresAt: session.expiresAt,
        outcome: result.outcome,
      };
    }

    const message = `${result.outcome}: ${result.message ?? 'sin detalle'}`;
    await this.markManual(tenantId, message);

    return {
      ...(await this.get(tenantId)),
      outcome: result.outcome,
      message: result.message ?? undefined,
    };
  }

  private async readStorageState(tenantId: string): Promise<string | null> {
    const session = await this.prisma.shalomSession.findUnique({ where: { tenantId } });
    if (!session || session.status !== 'ACTIVE' || !session.encryptedStorageState) return null;
    return this.crypto.decrypt(session.encryptedStorageState, this.sessionContext(tenantId));
  }
}
