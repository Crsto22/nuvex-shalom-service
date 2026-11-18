import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../libs/database/src/prisma.service';

export type WebhookEvent =
  | 'order.registered'
  | 'order.status_changed';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Encola una entrega por cada endpoint activo suscrito al evento.
   * Se ejecuta dentro del worker; el dispatcher hace el POST con reintentos.
   */
  async enqueue(params: {
    tenantId: string;
    event: WebhookEvent;
    data: unknown;
  }): Promise<number> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        active: true,
        events: { has: params.event },
        application: { tenantId: params.tenantId, status: 'ACTIVE' },
      },
      select: { id: true },
    });

    if (endpoints.length === 0) return 0;

    await this.prisma.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({
        endpointId: endpoint.id,
        event: params.event,
        payload: { event: params.event, data: params.data } as object,
      })),
    });

    this.logger.log(`Webhook ${params.event}: ${endpoints.length} entrega(s) encolada(s)`);
    return endpoints.length;
  }
}
