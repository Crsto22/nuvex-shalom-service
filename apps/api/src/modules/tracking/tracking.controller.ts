import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { ApiKeyGuard } from '../../common/api-key.guard';
import { Scopes } from '../../common/auth.decorators';
import { TrackingQueryDto } from './dto/tracking-query.dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
@UseGuards(ApiKeyGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get()
  @Scopes('shalom:tracking:read')
  live(@Query() query: TrackingQueryDto) {
    return this.tracking.live(query.orden, query.codigo);
  }
}
