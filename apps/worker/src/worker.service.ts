import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';

import { SessionManager } from '../../../libs/session/src/session-manager.service';
import { ShalomError } from '../../../libs/shalom/src/types';
import { JobQueueRepository, type ClaimedJob } from './job-queue.repository';
import { ShalomJobProcessor } from './shalom-job.processor';

const LEASE_MINUTES = 5;
const IDLE_DELAY_MS = 3_000;

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly workerId: string;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly queue: JobQueueRepository,
    private readonly processor: ShalomJobProcessor,
    private readonly sessions: SessionManager,
    config: ConfigService,
  ) {
    this.workerId =
      config.get<string>('WORKER_ID') ?? `${hostname()}-${process.pid}`.slice(0, 80);
  }

  onApplicationBootstrap(): void {
    this.running = true;
    this.logger.log(`Worker ${this.workerId} iniciado`);
    this.loop = this.runLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.logger.log('Deteniendo worker: esperando el job en curso');
    await this.loop?.catch(() => undefined);
    this.logger.log('Worker detenido');
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const job = await this.queue.claimNext(this.workerId, LEASE_MINUTES);
        if (!job) {
          await this.sleep(IDLE_DELAY_MS);
          continue;
        }
        await this.handle(job);
      } catch (error) {
        this.logger.error(`Error en el loop del worker: ${(error as Error).message}`);
        await this.sleep(IDLE_DELAY_MS);
      }
    }
  }

  private async handle(job: ClaimedJob): Promise<void> {
    try {
      const result = await this.processor.process(job);
      await this.queue.complete(job.id, result);
      return;
    } catch (error) {
      const failure =
        error instanceof ShalomError
          ? error
          : new ShalomError((error as Error).message, 'RETRYABLE');

      this.logger.warn(`Job ${job.id} fallo (${failure.kind}): ${failure.message}`);

      if (failure.kind === 'SESSION_REQUIRED') {
        // La sesion cayo a mitad del flujo: se intenta re-loguear una vez.
        const recovered = await this.sessions.recover(job.tenant_id).catch(() => false);

        if (recovered) {
          this.logger.warn(`Sesion recuperada para ${job.tenant_id}; reintentando job ${job.id}`);
          await this.queue.fail(job.id, failure.message, {
            retryable: true,
            retryInSeconds: 10,
          });
          return;
        }

        await this.sessions.markManual(job.tenant_id, failure.message);
        await this.queue.fail(job.id, failure.message, {
          retryable: true,
          retryInSeconds: 900,
        });
        return;
      }

      await this.queue.fail(job.id, failure.message, {
        retryable: failure.retryable,
        retryInSeconds: 120,
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
