import type { PrismaService } from '../../../libs/database/src/prisma.service';
import { TrackingScheduler } from './tracking.scheduler';
import type { WebhooksService } from './webhooks.service';

type TrackedOrder = { id: string; tenantId: string };
type ExpiredOrder = {
  id: string;
  tenantId: string;
  orden: string;
  codigo: string | null;
};

type PrismaLike = {
  shalomOrder: { findMany: jest.Mock; update: jest.Mock };
  shalomJob: { create: jest.Mock };
  shalomEvent: { create: jest.Mock };
};

function buildScheduler(orders: TrackedOrder[] = []) {
  const prisma: PrismaLike = {
    shalomOrder: {
      findMany: jest.fn((args: { where?: { status?: unknown } }) =>
        Promise.resolve(args?.where?.status === 'REGISTRADO' ? [] : orders),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    shalomJob: { create: jest.fn().mockResolvedValue({}) },
    shalomEvent: { create: jest.fn().mockResolvedValue({}) },
  };

  const webhooks = { enqueue: jest.fn().mockResolvedValue({}) };

  const config = {
    get: (key: string) => {
      const values: Record<string, string> = {
        SHALOM_TRACKING_ENABLED: 'true',
        SHALOM_TRACKING_INTERVAL_MINUTES: '15',
        SHALOM_TRACKING_BATCH: '20',
        SHALOM_ORDER_EXPIRY_HOURS: '24',
      };
      return values[key];
    },
  };

  const scheduler = new TrackingScheduler(
    prisma as unknown as PrismaService,
    webhooks as unknown as WebhooksService,
    config as never,
  );

  return { scheduler, prisma, webhooks };
}

describe('TrackingScheduler', () => {
  it('no encola nada si no hay ordenes activas', async () => {
    const { scheduler, prisma } = buildScheduler();

    const enqueued = await scheduler.sweep();

    expect(enqueued).toBe(0);
    expect(prisma.shalomJob.create).not.toHaveBeenCalled();
  });

  it('encola una job de rastreo por cada orden activa', async () => {
    const { scheduler, prisma } = buildScheduler([
      { id: 'order-1', tenantId: 'tenant-1' },
      { id: 'order-2', tenantId: 'tenant-1' },
    ]);

    const enqueued = await scheduler.sweep();

    expect(enqueued).toBe(2);
    expect(prisma.shalomJob.create).toHaveBeenCalledTimes(2);
    expect(prisma.shalomJob.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        type: 'TRACKING',
        payload: { orderId: 'order-1' },
      },
    });
  });

  it('ignora duplicados (indice unico parcial)', async () => {
    const { scheduler, prisma } = buildScheduler([
      { id: 'order-1', tenantId: 'tenant-1' },
      { id: 'order-2', tenantId: 'tenant-1' },
    ]);
    const uniqueError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    prisma.shalomJob.create
      .mockRejectedValueOnce(uniqueError)
      .mockResolvedValueOnce({});

    const enqueued = await scheduler.sweep();

    expect(enqueued).toBe(1);
  });

  it('marca vencidas las guias sin recepcion y emite el webhook', async () => {
    const { scheduler, prisma, webhooks } = buildScheduler();
    const expired: ExpiredOrder[] = [
      { id: 'order-9', tenantId: 'tenant-1', orden: 'V391-1', codigo: '9DPK' },
    ];
    prisma.shalomOrder.findMany.mockImplementation(
      (args: { where?: { status?: unknown } }) =>
        Promise.resolve(args?.where?.status === 'REGISTRADO' ? expired : []),
    );

    await scheduler.sweep();

    expect(prisma.shalomOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-9' },
      data: {
        status: 'ANULADO',
        trackingStatus: 'Guía vencida',
        trackingProgress: 0,
      },
    });
    expect(prisma.shalomEvent.create).toHaveBeenCalled();
    expect(webhooks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        event: 'order.status_changed',
        data: expect.objectContaining({
          status: 'ANULADO',
          label: 'Guía vencida',
        }),
      }),
    );
    expect(prisma.shalomJob.create).not.toHaveBeenCalled();
  });
});
