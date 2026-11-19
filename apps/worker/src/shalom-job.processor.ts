import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../libs/database/src/prisma.service';
import { SessionManager } from '../../../libs/session/src/session-manager.service';
import { mapTracking } from '../../../libs/shalom/src/tracking-status';
import { SHALOM_DRIVER } from '../../../libs/shalom/src/tokens';
import {
  ShalomError,
  type RegisterOrderInput,
  type ShalomDriver,
} from '../../../libs/shalom/src/types';
import type { ClaimedJob } from './job-queue.repository';
import { WebhooksService } from './webhooks.service';

export type RegisterOrderPayload = RegisterOrderInput & { externalRef?: string | null };
type TrackingPayload = { orderId?: string };

@Injectable()
export class ShalomJobProcessor {
  private readonly logger = new Logger(ShalomJobProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionManager,
    @Inject(SHALOM_DRIVER) private readonly driver: ShalomDriver,
    private readonly webhooks: WebhooksService,
  ) {}

  async process(job: ClaimedJob): Promise<unknown> {
    if (job.type === 'REGISTER_ORDER') return this.processRegisterOrder(job);
    if (job.type === 'TRACKING') return this.processTracking(job);
    throw new ShalomError(`Tipo de job no soportado: ${job.type}`, 'PERMANENT');
  }

  // ---------------------------------------------------------------------------
  // Registro individual
  // ---------------------------------------------------------------------------

  private async processRegisterOrder(job: ClaimedJob): Promise<unknown> {
    const payload = job.payload as RegisterOrderPayload;

    // Si el externalRef ya tiene una orden, no se vuelve a registrar en Shalom.
    if (payload.externalRef) {
      const existing = await this.prisma.shalomOrder.findUnique({
        where: {
          tenantId_externalRef: { tenantId: job.tenant_id, externalRef: payload.externalRef },
        },
      });
      if (existing) {
        this.logger.warn(
          `externalRef ${payload.externalRef} ya registrado (orden ${existing.orden}); no se reenvia`,
        );
        return {
          orderId: existing.id,
          orden: existing.orden,
          codigo: existing.codigo,
          monto: existing.monto,
          externalRef: payload.externalRef,
          alreadyRegistered: true,
        };
      }
    }

    // Obtiene una sesion valida; si cayo, el SessionManager re-loguea solo.
    const storageState = await this.sessions.requireStorageState(job.tenant_id);

    const result = await this.driver.registerOrder(payload, storageState);

    const orderData = {
      tenantId: job.tenant_id,
      orden: result.orden,
      codigo: result.codigo,
      monto: result.monto,
      status: 'REGISTRADO' as const,
      destinatarioDoc: payload.recipientDocument,
      origen: payload.originAgency,
      destino: payload.destinationAgency,
      paquete: payload.packageType,
    };

    let order;
    try {
      order = await this.prisma.shalomOrder.upsert({
        where: { tenantId_orden: { tenantId: job.tenant_id, orden: result.orden } },
        create: { ...orderData, externalRef: payload.externalRef ?? null },
        update: {
          codigo: result.codigo,
          monto: result.monto,
          status: 'REGISTRADO',
        },
      });
    } catch (error) {
      // El externalRef ya pertenece a otra orden: se guarda la guia igual
      // (existe en Shalom) sin externalRef, para no perderla.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        order = await this.prisma.shalomOrder.upsert({
          where: { tenantId_orden: { tenantId: job.tenant_id, orden: result.orden } },
          create: { ...orderData, externalRef: null },
          update: { codigo: result.codigo, monto: result.monto, status: 'REGISTRADO' },
        });
        this.logger.warn(
          `La guia ${result.orden} se guardo sin externalRef: "${payload.externalRef}" ya existia`,
        );
      } else {
        throw error;
      }
    }

    await this.prisma.shalomEvent.create({
      data: {
        orderId: order.id,
        status: 'REGISTRADO',
        progress: 0,
        description: `Registrado en Shalom (${result.orden})`,
      },
    });

    this.logger.log(
      `Orden ${order.id} registrada en Shalom: ${result.orden} / ${result.codigo ?? 'sin codigo'}`,
    );

    await this.webhooks.enqueue({
      tenantId: job.tenant_id,
      event: 'order.registered',
      data: {
        orderId: order.id,
        orden: order.orden,
        codigo: order.codigo,
        monto: result.monto,
        externalRef: payload.externalRef ?? null,
      },
    });

    return {
      orderId: order.id,
      orden: order.orden,
      codigo: order.codigo,
      monto: result.monto,
      externalRef: payload.externalRef ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Rastreo
  // ---------------------------------------------------------------------------

  private async processTracking(job: ClaimedJob): Promise<unknown> {
    const payload = job.payload as TrackingPayload;
    if (!payload.orderId) {
      throw new ShalomError('Job de rastreo sin orderId', 'PERMANENT');
    }

    const order = await this.prisma.shalomOrder.findUnique({ where: { id: payload.orderId } });
    if (!order || !order.orden) {
      throw new ShalomError('Orden inexistente o sin numero de Shalom', 'PERMANENT');
    }

    const tracking = await this.driver.tracking(order.orden, order.codigo);
    const mapped = mapTracking(tracking);
    const changed =
      mapped.status !== order.status ||
      mapped.progress !== (order.trackingProgress ?? 0);

    await this.prisma.shalomOrder.update({
      where: { id: order.id },
      data: {
        status: mapped.status,
        trackingStatus: mapped.label,
        trackingProgress: mapped.progress,
        lastTrackedAt: new Date(),
      },
    });

    if (changed) {
      await this.prisma.shalomEvent.create({
        data: {
          orderId: order.id,
          status: mapped.status,
          progress: mapped.progress,
          description: tracking.mensaje?.slice(0, 300) ?? mapped.label.slice(0, 300),
        },
      });
      this.logger.log(`Orden ${order.orden} cambio a ${mapped.status}`);

      await this.webhooks.enqueue({
        tenantId: order.tenantId,
        event: 'order.status_changed',
        data: {
          orderId: order.id,
          orden: order.orden,
          externalRef: order.externalRef,
          status: mapped.status,
          progress: mapped.progress,
          label: mapped.label,
          message: tracking.mensaje ?? null,
          steps: tracking.pasos,
        },
      });
    }

    return {
      orderId: order.id,
      orden: order.orden,
      status: mapped.status,
      progress: mapped.progress,
      changed,
    };
  }

}
