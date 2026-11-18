import type { PrismaService } from '../../../libs/database/src/prisma.service';
import { TrackingScheduler } from './tracking.scheduler';

type PrismaLike = {
  shalomOrder: { findMany: jest.Mock };
  shalomJob: { create: jest.Mock };
};

function buildScheduler(overrides: Partial<PrismaLike> = {}) {
  const prisma: PrismaLike = {
    shalomOrder: { findMany: jest.fn().mockResolvedValue([]) },
    shalomJob: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };

  const config = {
    get: (key: string) => {
      const values: Record<string, string> = {
        SHALOM_TRACKING_ENABLED: 'true',
        SHALOM_TRACKING_INTERVAL_MINUTES: '15',
        SHALOM_TRACKING_BATCH: '20',
      };
      return values[key];
    },
  };

  const scheduler = new TrackingScheduler(
    prisma as unknown as PrismaService,
    config as never,
  );

  return { scheduler, prisma };
}

describe('TrackingScheduler', () => {
  it('no encola nada si no hay ordenes activas', async () => {
    const { scheduler, prisma } = buildScheduler();

    const enqueued = await scheduler.sweep();

    expect(enqueued).toBe(0);
    expect(prisma.shalomJob.create).not.toHaveBeenCalled();
  });

  it('encola una job de rastreo por cada orden activa', async () => {
    const { scheduler, prisma } = buildScheduler();
    prisma.shalomOrder.findMany.mockResolvedValue([
      { id: 'order-1', tenantId: 'tenant-1' },
      { id: 'order-2', tenantId: 'tenant-1' },
    ]);

    const enqueued = await scheduler.sweep();

    expect(enqueued).toBe(2);
    expect(prisma.shalomJob.create).toHaveBeenCalledTimes(2);
    expect(prisma.shalomJob.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-1', type: 'TRACKING', payload: { orderId: 'order-1' } },
    });
  });

  it('ignora duplicados (indice unico parcial)', async () => {
    const { scheduler, prisma } = buildScheduler();
    prisma.shalomOrder.findMany.mockResolvedValue([
      { id: 'order-1', tenantId: 'tenant-1' },
      { id: 'order-2', tenantId: 'tenant-1' },
    ]);
    const uniqueError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    prisma.shalomJob.create
      .mockRejectedValueOnce(uniqueError)
      .mockResolvedValueOnce({});

    const enqueued = await scheduler.sweep();

    expect(enqueued).toBe(1);
  });
});
