import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Bucket = { count: number; resetAt: number };

/**
 * Limite de peticiones por aplicacion (ventana fija de 1 minuto).
 * En memoria por replica: suficiente para una instancia; si se escala a varias,
 * el limite efectivo se multiplica por el numero de replicas.
 */
@Injectable()
export class ApplicationRateLimiter {
  private readonly limit: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(config: ConfigService) {
    this.limit = Number(config.get<number>('RATE_LIMIT_PER_MINUTE') ?? 120);
  }

  consume(applicationId: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(applicationId);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(applicationId, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (bucket.count >= this.limit) return false;

    bucket.count += 1;
    return true;
  }
}
