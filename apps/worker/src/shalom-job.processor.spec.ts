import type { PrismaService } from '../../../libs/database/src/prisma.service';
import type { SessionManager } from '../../../libs/session/src/session-manager.service';
import { ShalomError, type ShalomDriver } from '../../../libs/shalom/src/types';
import type { ClaimedJob } from './job-queue.repository';
import { ShalomJobProcessor } from './shalom-job.processor';
import type { WebhooksService } from './webhooks.service';

function buildJob(payload: Record<string, unknown> = {}): ClaimedJob {
  return {
    id: 'job-1',
    tenant_id: 'tenant-1',
    type: 'REGISTER_ORDER',
    payload: {
      recipientDocument: '42309872',
      originAgency: 'AV TACNA',
      destinationAgency: 'ZAMACOLA',
      packageType: 'PAQUETE S',
      securityKey: '9872',
      externalRef: 'venta-1',
      ...payload,
    },
    attempts: 1,
    max_attempts: 3,
  };
}

function buildProcessor(options: {
  session?: { status: string; encryptedStorageState: string } | null;
  registerOrder?: jest.Mock;
}) {
  const prisma = {
    shalomSession: {
      findUnique: jest.fn().mockResolvedValue(options.session ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    shalomOrder: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({
        id: 'order-1',
        orden: '104168762',
        codigo: '739D',
      }),
    },
    shalomEvent: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;

  const sessions = {
    requireStorageState:
      options.session === null
        ? jest.fn().mockRejectedValue(new ShalomError('Sin sesion', 'SESSION_REQUIRED'))
        : jest.fn().mockResolvedValue('{"cookies":[]}'),
    recover: jest.fn().mockResolvedValue(true),
    markManual: jest.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager;

  const registerOrder =
    options.registerOrder ??
    jest.fn().mockResolvedValue({ orden: '104168762', codigo: '739D', monto: 12, reference: '' });

  const driver = { registerOrder } as unknown as ShalomDriver;
  const webhooks = { enqueue: jest.fn().mockResolvedValue(0) } as unknown as WebhooksService;

  return {
    processor: new ShalomJobProcessor(prisma, sessions, driver, webhooks),
    prisma,
    registerOrder,
    webhooks,
  };
}

describe('ShalomJobProcessor', () => {
  it('falla con SESSION_REQUIRED si el tenant no tiene sesion activa', async () => {
    const { processor, registerOrder } = buildProcessor({ session: null });

    await expect(processor.process(buildJob())).rejects.toMatchObject({
      kind: 'SESSION_REQUIRED',
    });
    expect(registerOrder).not.toHaveBeenCalled();
  });

  it('registra la orden y devuelve el resultado', async () => {
    const { processor, prisma, registerOrder } = buildProcessor({
      session: { status: 'ACTIVE', encryptedStorageState: 'v1.a.b.c' },
    });

    const result = await processor.process(buildJob());

    expect(registerOrder).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ orderId: 'order-1', orden: '104168762', codigo: '739D' });
    expect((prisma as unknown as { shalomEvent: { create: jest.Mock } }).shalomEvent.create).toHaveBeenCalled();
  });

  it('propaga los errores tipados del driver', async () => {
    const { processor } = buildProcessor({
      session: { status: 'ACTIVE', encryptedStorageState: 'v1.a.b.c' },
      registerOrder: jest
        .fn()
        .mockRejectedValue(new ShalomError('Shalom rechazo el registro', 'PERMANENT')),
    });

    await expect(processor.process(buildJob())).rejects.toMatchObject({ kind: 'PERMANENT' });
  });

  it('rechaza tipos de job no soportados', async () => {
    const { processor } = buildProcessor({ session: null });

    await expect(
      processor.process({ ...buildJob(), type: 'TRACKING' }),
    ).rejects.toMatchObject({ kind: 'PERMANENT' });
  });
});
