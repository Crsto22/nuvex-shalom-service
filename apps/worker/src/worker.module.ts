import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnvironment } from '../../../libs/config/src/env.validation';
import { DatabaseModule } from '../../../libs/database/src/database.module';
import { SecurityModule } from '../../../libs/security/src/security.module';
import { SessionModule } from '../../../libs/session/src/session.module';
import { ShalomModule } from '../../../libs/shalom/src/shalom.module';
import { JobQueueRepository } from './job-queue.repository';
import { ShalomJobProcessor } from './shalom-job.processor';
import { TrackingScheduler } from './tracking.scheduler';
import { WebhookDispatcher } from './webhook.dispatcher';
import { WebhooksService } from './webhooks.service';
import { WorkerService } from './worker.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    SecurityModule,
    ShalomModule,
    SessionModule,
  ],
  providers: [
    JobQueueRepository,
    ShalomJobProcessor,
    TrackingScheduler,
    WebhooksService,
    WebhookDispatcher,
    WorkerService,
  ],
})
export class WorkerModule {}
