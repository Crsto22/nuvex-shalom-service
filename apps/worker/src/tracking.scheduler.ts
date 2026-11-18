import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../libs/database/src/prisma.service';

const ACTIVE_STATUSES = ['REGISTRADO', 'EN_ORIGEN', 'EN_TRANSITO'] as const;

/**
 * Barrido periodico: encola un job de rastreo por cada orden activa que no se
 * consulto en el ultimo intervalo. El indice unico parcial de shalom_job evita
 * duplicar trabajos pendientes para la misma orden.
 */
@Injectable()
export class TrackingScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TrackingScheduler.name);
  private readonly enabled: boolean;
  private readonly intervalMinutes: number;
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = (config.get<string>('SHALOM_TRACKING_ENABLED') ?? 'false') === 'true';
    this.intervalMinutes = Number(config.get<number>('SHALOM_TRACKING_INTERVAL_MINUTES') ?? 15);
    this.batchSize = Number(config.get<number>('SHALOM_TRACKING_BATCH') ?? 20);
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Barrido de rastreo deshabilitado');
      return;
    }

    const intervalMs = this.intervalMinutes * 60_000;
    this.logger.log(`Barrido de rastreo cada ${this.intervalMinutes} min (lote ${this.batchSize})`);
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    setTimeout(() => void this.sweep(), 30_000);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(now: Date = new Date()): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;

    try {
      const cutoff = new Date(now.getTime() - this.intervalMinutes * 60_000);
      const orders = await this.prisma.shalomOrder.findMany({
        where: {
          status: { in: [...ACTIVE_STATUSES] },
          orden: { not: null },
          OR: [{ lastTrackedAt: null }, { lastTrackedAt: { lt: cutoff } }],
        },
        orderBy: [{ lastTrackedAt: 'asc' }],
        take: this.batchSize,
        select: { id: true, tenantId: true },
      });

      let enqueued = 0;
      for (const order of orders) {
        try {
          await this.prisma.shalomJob.create({
            data: {
              tenantId: order.tenantId,
              type: 'TRACKING',
              payload: { orderId: order.id },
            },
          });
          enqueued += 1;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            continue; // ya hay un rastreo pendiente para esta orden
          }
          this.logger.warn(`No se pudo encolar rastreo de ${order.id}: ${(error as Error).message}`);
        }
      }

      if (enqueued > 0) this.logger.log(`Rastreos encolados: ${enqueued}`);
      return enqueued;
    } catch (error) {
      this.logger.error(`Fallo el barrido de rastreo: ${(error as Error).message}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }
}
