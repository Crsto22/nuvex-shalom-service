import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../libs/database/src/prisma.service';
import { WebhooksService } from './webhooks.service';

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
  private readonly expiryHours: number;
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    config: ConfigService,
  ) {
    this.enabled = (config.get<string>('SHALOM_TRACKING_ENABLED') ?? 'false') === 'true';
    this.intervalMinutes = Number(config.get<number>('SHALOM_TRACKING_INTERVAL_MINUTES') ?? 15);
    this.batchSize = Number(config.get<number>('SHALOM_TRACKING_BATCH') ?? 20);
    this.expiryHours = Number(config.get<number>('SHALOM_ORDER_EXPIRY_HOURS') ?? 24);
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
      await this.expireOrders(now);

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

  /**
   * Marca como vencidas las guias que no fueron recepcionadas en la agencia
   * dentro del plazo (24 h por defecto). Emite el webhook para que Nuvex
   * devuelva el envio a pendiente y permita generar una nueva guia.
   */
  private async expireOrders(now: Date) {
    const limit = new Date(now.getTime() - this.expiryHours * 3_600_000);

    const expired = await this.prisma.shalomOrder.findMany({
      where: {
        status: 'REGISTRADO',
        orden: { not: null },
        registeredAt: { lt: limit },
        OR: [{ trackingProgress: null }, { trackingProgress: { lte: 0 } }],
      },
      select: { id: true, tenantId: true, orden: true, codigo: true },
      take: 50,
    });

    for (const order of expired) {
      try {
        await this.prisma.shalomOrder.update({
          where: { id: order.id },
          data: {
            status: 'ANULADO',
            trackingStatus: 'Guía vencida',
            trackingProgress: 0,
          },
        });

        await this.prisma.shalomEvent.create({
          data: {
            orderId: order.id,
            status: 'ANULADO',
            progress: 0,
            description: `Guía vencida: más de ${this.expiryHours} h sin recepción en agencia`,
          },
        });

        await this.webhooks.enqueue({
          tenantId: order.tenantId,
          event: 'order.status_changed',
          data: {
            orderId: order.id,
            orden: order.orden,
            status: 'ANULADO',
            progress: 0,
            label: 'Guía vencida',
            message: 'No se recibió en la agencia dentro del plazo',
            steps: [],
          },
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo marcar vencida la guia ${order.orden}: ${(error as Error).message}`,
        );
      }
    }

    if (expired.length > 0) {
      this.logger.log(`Guias vencidas marcadas: ${expired.length}`);
    }
  }
}
