import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../../../libs/database/src/prisma.service';
import { isWithinWindow, startOfDayInTimeZone } from '../../../../../libs/shalom/src/schedule';
import type { CreateOrderDto } from './dto/create-order.dto';

export type CreateOrderResponse = {
  jobId: string;
  status: string;
  /** Presente cuando la orden ya existia (dedupe por externalRef). */
  order?: {
    id: string;
    orden: string | null;
    codigo: string | null;
    status: string;
  };
  /** Presente cuando se pidio `wait=true` y el job termino. */
  result?: {
    orderId: string;
    orden: string | null;
    codigo: string | null;
    monto: number | null;
  };
  error?: string;
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    tenantId: string,
    dto: CreateOrderDto,
    wait = false,
  ): Promise<CreateOrderResponse> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    if (tenant.status !== 'ACTIVE') {
      throw new BadRequestException('Tenant inactivo');
    }

    if (!isWithinWindow(tenant.timezone, tenant.windowStart, tenant.windowEnd)) {
      throw new BadRequestException(
        `Fuera de la ventana operativa (${tenant.windowStart}-${tenant.windowEnd} ${tenant.timezone})`,
      );
    }

    const since = startOfDayInTimeZone(tenant.timezone, new Date());
    const today = await this.prisma.shalomOrder.count({
      where: { tenantId, registeredAt: { gte: since } },
    });
    if (today >= tenant.maxOrdersPerDay) {
      throw new HttpException(
        `Limite diario alcanzado (${tenant.maxOrdersPerDay} envios por dia)`,
        429,
      );
    }

    if (dto.externalRef) {
      const existing = await this.prisma.shalomOrder.findUnique({
        where: { tenantId_externalRef: { tenantId, externalRef: dto.externalRef } },
      });
      if (existing) {
        return {
          jobId: '',
          status: 'COMPLETED',
          order: {
            id: existing.id,
            orden: existing.orden,
            codigo: existing.codigo,
            status: existing.status,
          },
        };
      }
    }

    if (dto.idempotencyKey) {
      const existingJob = await this.prisma.shalomJob.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: dto.idempotencyKey } },
      });
      if (existingJob) {
        return { jobId: existingJob.id, status: existingJob.status };
      }
    }

    const job = await this.prisma.shalomJob.create({
      data: {
        tenantId,
        type: 'REGISTER_ORDER',
        idempotencyKey: dto.idempotencyKey ?? null,
        payload: {
          recipientDocument: dto.recipientDocument,
          documentType: dto.documentType ?? 'DNI',
          recipientName: dto.recipientName,
          recipientPaternalLastName: dto.recipientPaternalLastName,
          recipientMaternalLastName: dto.recipientMaternalLastName,
          businessName: dto.businessName,
          recipientPhone: dto.recipientPhone,
          originAgency: dto.originAgency,
          destinationAgency: dto.destinationAgency,
          packageType: dto.packageType,
          securityKey: dto.securityKey,
          declarationType: dto.declarationType,
          extraSecurity: dto.extraSecurity ?? false,
          cashOnDelivery: dto.cashOnDelivery ?? false,
          externalRef: dto.externalRef ?? null,
        },
      },
    });

    return wait ? this.waitForJob(job.id) : { jobId: job.id, status: job.status };
  }

  /**
   * Espera (opcional) a que el job termine y devuelve orden + codigo en la
   * misma respuesta. El registro real tarda ~40-70 s (abre navegador).
   */
  private async waitForJob(jobId: string, timeoutMs = 180_000): Promise<CreateOrderResponse> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const job = await this.prisma.shalomJob.findUnique({ where: { id: jobId } });
      if (!job) return { jobId, status: 'NOT_FOUND', error: 'Job no encontrado' };

      if (job.status === 'COMPLETED') {
        const result = (job.result ?? {}) as {
          orderId?: string;
          orden?: string | null;
          codigo?: string | null;
          monto?: number | null;
        };
        return {
          jobId,
          status: job.status,
          result: {
            orderId: result.orderId ?? '',
            orden: result.orden ?? null,
            codigo: result.codigo ?? null,
            monto: result.monto ?? null,
          },
        };
      }

      if (job.status === 'DEAD' || job.status === 'FAILED') {
        return {
          jobId,
          status: job.status,
          error: job.errorMessage ?? 'El registro fallo en Shalom',
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    return { jobId, status: 'PENDING', error: 'Tiempo de espera agotado; consulta el job' };
  }

  async getOrder(orderId: string, tenantId: string) {
    const order = await this.prisma.shalomOrder.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException('Orden no encontrada');

    return {
      id: order.id,
      externalRef: order.externalRef,
      orden: order.orden,
      codigo: order.codigo,
      monto: order.monto,
      status: order.status,
      registeredAt: order.registeredAt,
      trackingStatus: order.trackingStatus,
      trackingProgress: order.trackingProgress,
    };
  }

  async getJob(jobId: string, tenantId: string) {
    const job = await this.prisma.shalomJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundException('Job no encontrado');

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      errorMessage: job.errorMessage,
      result: job.result,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    };
  }

  /** Encola un rastreo puntual de la orden (no bloquea la respuesta). */
  async enqueueTracking(orderId: string, tenantId: string) {
    const order = await this.prisma.shalomOrder.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (!order.orden) {
      throw new HttpException('La orden todavia no tiene numero de Shalom', 409);
    }

    try {
      const job = await this.prisma.shalomJob.create({
        data: {
          tenantId: order.tenantId,
          type: 'TRACKING',
          payload: { orderId: order.id },
        },
      });
      return { jobId: job.id, status: job.status };
    } catch {
      // Ya existe un rastreo pendiente para esta orden (indice unico parcial).
      const existing = await this.prisma.shalomJob.findFirst({
        where: {
          tenantId: order.tenantId,
          type: 'TRACKING',
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      return { jobId: existing?.id ?? null, status: existing?.status ?? 'PENDING' };
    }
  }

  /** Estado guardado de la orden + historial de eventos (sin abrir navegador). */
  async getTracking(orderId: string, tenantId: string) {
    const order = await this.prisma.shalomOrder.findFirst({
      where: { id: orderId, tenantId },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!order) throw new NotFoundException('Orden no encontrada');

    return {
      id: order.id,
      orden: order.orden,
      codigo: order.codigo,
      status: order.status,
      trackingStatus: order.trackingStatus,
      trackingProgress: order.trackingProgress,
      lastTrackedAt: order.lastTrackedAt,
      events: order.events.map((event) => ({
        status: event.status,
        progress: event.progress,
        description: event.description,
        createdAt: event.createdAt,
      })),
    };
  }
}
