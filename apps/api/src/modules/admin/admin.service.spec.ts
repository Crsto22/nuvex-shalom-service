import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../../../../libs/database/src/prisma.service';
import type { SecretsCryptoService } from '../../../../../libs/security/src/secrets-crypto.service';
import type { SessionManager } from '../../../../../libs/session/src/session-manager.service';
import type { AuditService } from '../../common/audit.service';
import { AdminService } from './admin.service';

function build() {
  const prisma = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'tenant-1', code: 'acme', name: 'ACME' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    application: {
      create: jest.fn().mockResolvedValue({ id: 'app-1', code: 'nuvex' }),
      findUnique: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', code: 'nuvex' }),
    },
    apiKey: {
      create: jest.fn().mockResolvedValue({ id: 'key-1', prefix: 'shm_live_abcdefgh' }),
      update: jest.fn().mockResolvedValue({ id: 'key-1', prefix: 'shm_live_abcdefgh', revokedAt: new Date() }),
      findUnique: jest.fn().mockResolvedValue({ id: 'key-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    shalomCredential: { create: jest.fn().mockResolvedValue({}), upsert: jest.fn().mockResolvedValue({}) },
    webhookEndpoint: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

  const crypto = { encrypt: jest.fn().mockReturnValue('v1.enc') } as unknown as SecretsCryptoService;
  const audit = { record: jest.fn().mockResolvedValue(undefined), list: jest.fn().mockResolvedValue([]) } as unknown as AuditService;
  const sessions = {
    login: jest.fn().mockResolvedValue({ status: 'ACTIVE', outcome: 'SUCCESS', message: null }),
  } as unknown as SessionManager;

  const config = {
    get: (key: string) => (key === 'API_KEY_PEPPER' ? 'p'.repeat(40) : undefined),
  } as unknown as ConfigService;

  return {
    service: new AdminService(prisma, crypto, audit, sessions, config),
    prisma,
    audit,
    sessions,
  };
}

describe('AdminService.createTenant', () => {
  it('crea empresa, aplicacion y API key auditando el alta', async () => {
    const { service, audit } = build();

    const result = await service.createTenant({
      code: 'acme',
      name: 'ACME',
      username: 'dueno@acme.com',
      password: 'secreto-123',
    });

    expect(result.tenantId).toBe('tenant-1');
    expect(result.applicationId).toBe('app-1');
    expect(result.apiKey.startsWith('shm_live_')).toBe(true);
    expect(result.credentialsConfigured).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.created', actor: 'admin-token' }),
    );
  });

  it('rechaza un code duplicado', async () => {
    const { service, prisma } = build();
    (prisma as unknown as { tenant: { findUnique: jest.Mock } }).tenant.findUnique.mockResolvedValue({
      id: 'otro',
    });

    await expect(service.createTenant({ code: 'acme', name: 'ACME' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('exige username y password juntos', async () => {
    const { service } = build();

    await expect(
      service.createTenant({ code: 'acme', name: 'ACME', username: 'dueno@acme.com' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('valida credenciales y audita el intento', async () => {
    const { service, audit, sessions } = build();
    (service as unknown as { prisma: { tenant: { findUnique: jest.Mock } } }).prisma.tenant.findUnique =
      jest.fn().mockResolvedValue({ id: 'tenant-1', code: 'acme' });

    const result = await service.validateCredentials('tenant-1');

    expect(sessions.login).toHaveBeenCalledWith('tenant-1');
    expect(result.valid).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'credentials.validated' }),
    );
  });
});
