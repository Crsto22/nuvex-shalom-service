import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { validateEnvironment } from '../../../libs/config/src/env.validation';
import { DatabaseModule } from '../../../libs/database/src/database.module';
import { SecurityModule } from '../../../libs/security/src/security.module';
import { SessionModule } from '../../../libs/session/src/session.module';
import { ShalomModule } from '../../../libs/shalom/src/shalom.module';
import { ApiSecurityModule } from './common/api-security.module';
import { AuditModule } from './common/audit.module';
import { ShalomErrorFilter } from './common/shalom-error.filter';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { TrackingModule } from './modules/tracking/tracking.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    DatabaseModule,
    SecurityModule,
    ShalomModule,
    SessionModule,
    ApiSecurityModule,
    AuditModule,
    HealthModule,
    SessionsModule,
    OrdersModule,
    TrackingModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ShalomErrorFilter,
    },
  ],
})
export class AppModule {}
