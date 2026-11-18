import { Global, Module } from '@nestjs/common';

import { AdminTokenGuard } from './admin-token.guard';
import { ApiKeyGuard } from './api-key.guard';
import { ApplicationRateLimiter } from './rate-limiter';

@Global()
@Module({
  providers: [ApiKeyGuard, AdminTokenGuard, ApplicationRateLimiter],
  exports: [ApiKeyGuard, AdminTokenGuard, ApplicationRateLimiter],
})
export class ApiSecurityModule {}
