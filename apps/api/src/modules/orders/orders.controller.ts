import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ApiKeyGuard } from '../../common/api-key.guard';
import { Auth, Scopes } from '../../common/auth.decorators';
import type { AuthContext } from '../../common/auth-context';
import { assertTenantAccess } from '../../common/tenant-access';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller()
@UseGuards(ApiKeyGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('tenants/:tenantId/orders')
  @Scopes('shalom:orders:write')
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateOrderDto,
    @Auth() auth: AuthContext,
    @Query('wait') wait?: string,
  ) {
    assertTenantAccess(auth, tenantId);
    return this.orders.create(tenantId, dto, wait === 'true' || wait === '1');
  }

  @Get('orders/:orderId')
  @Scopes('shalom:orders:read')
  getOrder(@Param('orderId') orderId: string, @Auth() auth: AuthContext) {
    return this.orders.getOrder(orderId, auth.tenantId);
  }

  @Get('orders/:orderId/tracking')
  @Scopes('shalom:tracking:read')
  getTracking(@Param('orderId') orderId: string, @Auth() auth: AuthContext) {
    return this.orders.getTracking(orderId, auth.tenantId);
  }

  @Post('orders/:orderId/track')
  @Scopes('shalom:tracking:read')
  track(@Param('orderId') orderId: string, @Auth() auth: AuthContext) {
    return this.orders.enqueueTracking(orderId, auth.tenantId);
  }

  @Get('jobs/:jobId')
  @Scopes('shalom:orders:read')
  getJob(@Param('jobId', ParseUUIDPipe) jobId: string, @Auth() auth: AuthContext) {
    return this.orders.getJob(jobId, auth.tenantId);
  }
}
