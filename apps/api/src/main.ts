import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/request-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.setGlobalPrefix('v1');

  const trustProxyHops = Number(config.get<number>('TRUST_PROXY_HOPS') ?? 0);
  if (trustProxyHops > 0) {
    const express = app.getHttpAdapter().getInstance() as Express;
    express.set('trust proxy', trustProxyHops);
  }

  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Admin-Token',
      'Idempotency-Key',
      'X-Request-Id',
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const host = config.get<string>('API_HOST') ?? '0.0.0.0';
  const port = Number(config.get<number>('API_PORT') ?? 4100);

  await app.listen(port, host);
  logger.log(`shalom-service API escuchando en http://${host}:${port}/v1`);
}

void bootstrap();
