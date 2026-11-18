import { Controller, Get } from '@nestjs/common';

import { PrismaService } from '../../../../../libs/database/src/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const healthy = await this.prisma.isHealthy();
    if (!healthy) {
      return {
        status: 'degraded',
        service: 'shalom-service',
        database: 'down',
        timestamp: new Date().toISOString(),
      };
    }

    const [pendingJobs, processingJobs, deadJobs, activeOrders, activeSessions, todayOrders, requiresLogin] =
      await Promise.all([
        this.prisma.shalomJob.count({ where: { status: 'PENDING' } }),
        this.prisma.shalomJob.count({ where: { status: 'PROCESSING' } }),
        this.prisma.shalomJob.count({ where: { status: 'DEAD' } }),
        this.prisma.shalomOrder.count({
          where: { status: { in: ['REGISTRADO', 'EN_ORIGEN', 'EN_TRANSITO'] } },
        }),
        this.prisma.shalomSession.count({ where: { status: 'ACTIVE' } }),
        this.prisma.shalomOrder.count({
          where: { registeredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
        this.prisma.shalomSession.count({ where: { status: 'REQUIERE_LOGIN_MANUAL' } }),
      ]);

    return {
      status: 'ok',
      service: 'shalom-service',
      uptimeSeconds: Math.round(process.uptime()),
      database: 'up',
      metrics: {
        jobs: { pending: pendingJobs, processing: processingJobs, dead: deadJobs },
        orders: { active: activeOrders, last24h: todayOrders },
        sessions: { active: activeSessions, requiresLogin },
      },
      timestamp: new Date().toISOString(),
    };
  }
}
