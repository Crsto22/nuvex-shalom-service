import type { PrismaService } from '../../../../libs/database/src/prisma.service';
import { AuditService } from './audit.service';

function build() {
  const prisma = {
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'log-1',
          tenantId: 'tenant-1',
          actor: 'admin-token',
          action: 'tenant.created',
          target: 'acme',
          metadata: {},
          createdAt: new Date('2026-11-18T12:00:00Z'),
        },
      ]),
    },
  } as unknown as PrismaService;

  return { service: new AuditService(prisma), prisma };
}

describe('AuditService', () => {
  it('registra la entrada con actor y accion', async () => {
    const { service, prisma } = build();

    await service.record({
      tenantId: 'tenant-1',
      actor: 'admin-token',
      action: 'credentials.updated',
      target: 'acme',
      metadata: { username: 'x@y.com' },
    });

    const create = (prisma as unknown as { auditLog: { create: jest.Mock } }).auditLog.create;
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        actor: 'admin-token',
        action: 'credentials.updated',
        target: 'acme',
      }),
    });
  });

  it('no rompe la operacion si falla el guardado', async () => {
    const { service, prisma } = build();
    (prisma as unknown as { auditLog: { create: jest.Mock } }).auditLog.create.mockRejectedValue(
      new Error('db down'),
    );

    await expect(
      service.record({ actor: 'admin-token', action: 'api_key.revoked' }),
    ).resolves.toBeUndefined();
  });

  it('lista con limite maximo de 200', async () => {
    const { service, prisma } = build();

    await service.list({ limit: 500 });

    const findMany = (prisma as unknown as { auditLog: { findMany: jest.Mock } }).auditLog.findMany;
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
  });
});
