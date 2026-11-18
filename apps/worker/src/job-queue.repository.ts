import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../libs/database/src/prisma.service';

export type ClaimedJob = {
  id: string;
  tenant_id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

/**
 * Cola durable en PostgreSQL.
 *
 * - Reclamo atomico con FOR UPDATE SKIP LOCKED: varias replicas pueden correr
 *   sin procesar el mismo job.
 * - Exclusividad por tenant: no se reclama un job si esa empresa ya tiene otro
 *   en PROCESSING. Como cada tenant tiene una sola cuenta Shalom, dos registros
 *   simultaneos pelearian por la misma sesion.
 * - Los locks vencen: si un worker muere, otro recupera el job.
 */
@Injectable()
export class JobQueueRepository {
  private readonly logger = new Logger(JobQueueRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async claimNext(workerId: string, leaseMinutes: number): Promise<ClaimedJob | null> {
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
      WITH candidate AS (
        SELECT j.id
        FROM shalom_job j
        WHERE (
            (j.status = 'PENDING' AND j.next_attempt_at <= now())
            OR (
              j.status = 'PROCESSING'
              AND j.locked_at < now() - (${leaseMinutes}::int * interval '1 minute')
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM shalom_job running
            WHERE running.tenant_id = j.tenant_id
              AND running.status = 'PROCESSING'
              AND running.id <> j.id
              AND running.locked_at >= now() - (${leaseMinutes}::int * interval '1 minute')
          )
        ORDER BY j.next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE shalom_job j
      SET status = 'PROCESSING',
          locked_by = ${workerId},
          locked_at = now(),
          attempts = j.attempts + 1,
          updated_at = now()
      FROM candidate
      WHERE j.id = candidate.id
      RETURNING j.id, j.tenant_id, j.type::text AS type, j.payload,
                j.attempts, j.max_attempts
    `);

    const job = rows[0] ?? null;
    if (job) {
      this.logger.log(`Job reclamado ${job.id} (${job.type}) tenant=${job.tenant_id} intento=${job.attempts}`);
    }
    return job;
  }

  async heartbeat(jobId: string, workerId: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE shalom_job
      SET locked_at = now(), updated_at = now()
      WHERE id = ${jobId}::uuid AND locked_by = ${workerId} AND status = 'PROCESSING'
    `);
  }

  async complete(jobId: string, result: unknown): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE shalom_job
      SET status = 'COMPLETED',
          result = ${JSON.stringify(result)}::jsonb,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = now(),
          finished_at = now()
      WHERE id = ${jobId}::uuid
    `);
  }

  /**
   * Error reintentable => vuelve a PENDING con backoff.
   * Error permanente o intentos agotados => DEAD.
   */
  async fail(
    jobId: string,
    message: string,
    options: { retryable: boolean; retryInSeconds?: number },
  ): Promise<'PENDING' | 'DEAD'> {
    const rows = await this.prisma.$queryRaw<Array<{ attempts: number; max_attempts: number }>>(
      Prisma.sql`SELECT attempts, max_attempts FROM shalom_job WHERE id = ${jobId}::uuid`,
    );
    const current = rows[0];
    const exhausted = !current || current.attempts >= current.max_attempts;

    if (!options.retryable || exhausted) {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE shalom_job
        SET status = 'DEAD',
            error_message = ${message.slice(0, 500)},
            locked_by = NULL,
            locked_at = NULL,
            updated_at = now(),
            finished_at = now()
        WHERE id = ${jobId}::uuid
      `);
      return 'DEAD';
    }

    const delay = options.retryInSeconds ?? 60;
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE shalom_job
      SET status = 'PENDING',
          error_message = ${message.slice(0, 500)},
          next_attempt_at = now() + (${delay}::int * interval '1 second'),
          locked_by = NULL,
          locked_at = NULL,
          updated_at = now()
      WHERE id = ${jobId}::uuid
    `);
    return 'PENDING';
  }
}
