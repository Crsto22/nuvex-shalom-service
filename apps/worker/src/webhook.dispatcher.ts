import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { hostname } from 'node:os';

import { PrismaService } from '../../../libs/database/src/prisma.service';
import { signWebhook } from '../../../libs/security/src/api-key';

type ClaimedDelivery = {
  id: string;
  url: string;
  secret: string;
  event: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

const POLL_MS = 3_000;
const LEASE_MINUTES = 2;

/**
 * Entrega de webhooks con firma HMAC y reintentos.
 * Misma mecanica que la cola de jobs: claim atomico + lease + backoff.
 */
@Injectable()
export class WebhookDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private readonly workerId: string;
  private readonly timeoutMs: number;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.workerId = `${hostname()}-${process.pid}-wh`.slice(0, 80);
    this.timeoutMs = Number(config.get<number>('WEBHOOK_TIMEOUT_MS') ?? 10_000);
  }

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop?.catch(() => undefined);
  }

  private async run(): Promise<void> {
    while (this.running) {
      const delivery = await this.claim().catch((error) => {
        this.logger.error(`Claim de webhooks fallo: ${(error as Error).message}`);
        return null;
      });

      if (!delivery) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        continue;
      }

      await this.deliver(delivery);
    }
  }

  private async claim(): Promise<ClaimedDelivery | null> {
    const rows = await this.prisma.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
      WITH candidate AS (
        SELECT d.id
        FROM webhook_delivery d
        WHERE (
            (d.status = 'PENDING' AND d.next_attempt_at <= now())
            OR (d.status = 'PROCESSING' AND d.locked_at < now() - (${LEASE_MINUTES}::int * interval '1 minute'))
          )
        ORDER BY d.next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE webhook_delivery d
      SET status = 'PROCESSING',
          locked_by = ${this.workerId},
          locked_at = now(),
          attempts = d.attempts + 1
      FROM candidate
      WHERE d.id = candidate.id
      RETURNING d.id, d.event, d.payload, d.attempts, d.max_attempts,
                (SELECT e.url FROM webhook_endpoint e WHERE e.id = d.endpoint_id) AS url,
                (SELECT e.secret FROM webhook_endpoint e WHERE e.id = d.endpoint_id) AS secret
    `);

    return rows[0] ?? null;
  }

  private async deliver(delivery: ClaimedDelivery): Promise<void> {
    const body = JSON.stringify({
      event: delivery.event,
      deliveryId: delivery.id,
      data: delivery.payload,
      createdAt: new Date().toISOString(),
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhook(delivery.secret, timestamp, body);

    try {
      const response = await fetch(delivery.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'shalom-service-webhooks/1.0',
          'x-shalom-signature': signature,
          'x-shalom-event': delivery.event,
          'x-shalom-delivery': delivery.id,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'DELIVERED',
            deliveredAt: new Date(),
            lockedBy: null,
            lockedAt: null,
            lastError: null,
          },
        });
        this.logger.log(`Webhook ${delivery.event} entregado (${response.status})`);
        return;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      const exhausted = delivery.attempts >= delivery.max_attempts;
      const backoffSeconds = Math.min(300, 2 ** delivery.attempts * 5);

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: exhausted
          ? { status: 'DEAD', lastError: message, lockedBy: null, lockedAt: null }
          : {
              status: 'FAILED',
              lastError: message,
              lockedBy: null,
              lockedAt: null,
              nextAttemptAt: new Date(Date.now() + backoffSeconds * 1_000),
            },
      });

      this.logger.warn(
        `Webhook ${delivery.event} fallo (${message}). ${exhausted ? 'DEAD' : `reintento en ${backoffSeconds}s`}`,
      );
    }
  }
}
