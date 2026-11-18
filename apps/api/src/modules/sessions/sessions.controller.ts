import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { ApiKeyGuard } from '../../common/api-key.guard';
import { Auth, Scopes } from '../../common/auth.decorators';
import type { AuthContext } from '../../common/auth-context';
import { assertTenantAccess } from '../../common/tenant-access';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(ApiKeyGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post(':tenantId/login')
  @Scopes('shalom:sessions:write')
  login(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Auth() auth: AuthContext,
  ) {
    assertTenantAccess(auth, tenantId);
    return this.sessions.login(tenantId);
  }

  @Get(':tenantId')
  @Scopes('shalom:sessions:read')
  get(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Auth() auth: AuthContext,
  ) {
    assertTenantAccess(auth, tenantId);
    return this.sessions.get(tenantId);
  }
}
