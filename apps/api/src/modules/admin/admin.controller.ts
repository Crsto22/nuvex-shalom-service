import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminTokenGuard } from '../../common/admin-token.guard';
import { AdminService } from './admin.service';
import {
  AuditQueryDto,
  CreateApiKeyDto,
  CreateTenantDto,
  CreateWebhookDto,
  UpdateCredentialsQueryDto,
  UpdateShalomCredentialsDto,
} from './dto/admin.dto';

/**
 * Administracion (solo con X-Admin-Token).
 * La API publica de negocio usa API keys por aplicacion.
 */
@Controller('admin')
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.admin.createTenant(dto);
  }

  @Put('tenants/:tenantId/credentials')
  updateCredentials(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateShalomCredentialsDto,
    @Query() query: UpdateCredentialsQueryDto,
  ) {
    return this.admin.updateCredentials(tenantId, dto, query.validate === 'true');
  }

  @Post('tenants/:tenantId/validate-credentials')
  validateCredentials(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.admin.validateCredentials(tenantId);
  }

  @Get('sessions')
  listSessions() {
    return this.admin.listSessions();
  }

  @Get('audit')
  listAudit(@Query() query: AuditQueryDto) {
    return this.admin.listAudit(query);
  }

  @Post('applications/:applicationId/api-keys')
  createApiKey(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.admin.createApiKey(applicationId, dto);
  }

  @Get('applications/:applicationId/api-keys')
  listApiKeys(@Param('applicationId', ParseUUIDPipe) applicationId: string) {
    return this.admin.listApiKeys(applicationId);
  }

  @Delete('api-keys/:apiKeyId')
  revokeApiKey(@Param('apiKeyId', ParseUUIDPipe) apiKeyId: string) {
    return this.admin.revokeApiKey(apiKeyId);
  }

  @Post('applications/:applicationId/webhooks')
  createWebhook(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.admin.createWebhook(applicationId, dto);
  }

  @Get('applications/:applicationId/webhooks')
  listWebhooks(@Param('applicationId', ParseUUIDPipe) applicationId: string) {
    return this.admin.listWebhooks(applicationId);
  }
}
