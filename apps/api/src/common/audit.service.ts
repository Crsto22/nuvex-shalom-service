import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../libs/database/src/prisma.service';

export type AuditAction =
  | 'tenant.created'
  | 'credentials.updated'
  | 'credentials.validated'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'webhook.created';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Registra un cambio administrativo. Nunca interrumpe la operacion. */
  async record(entry: {
    tenantId?: string | null;
    actor: string;
    action: AuditAction;
    target?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog
      .create({
        data: {
          tenantId: entry.tenantId ?? null,
          actor: entry.actor,
          action: entry.action,
          target: entry.target ?? null,
          metadata: (entry.metadata ?? {}) as object,
        },
      })
      .catch((error) => {
        this.logger.warn(`No se pudo guardar auditoria (${entry.action}): ${(error as Error).message}`);
      });
  }

  async list(query: { tenantId?: string; limit?: number }) {
    const logs = await this.prisma.auditLog.findMany({
      where: query.tenantId ? { tenantId: query.tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
    });

    return logs.map((log) => ({
      id: log.id,
      tenantId: log.tenantId,
      actor: log.actor,
      action: log.action,
      target: log.target,
      metadata: log.metadata,
      createdAt: log.createdAt,
    }));
  }
}
