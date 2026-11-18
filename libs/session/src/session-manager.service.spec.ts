import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../database/src/prisma.service';
import type { SecretsCryptoService } from '../../security/src/secrets-crypto.service';
import { ShalomError, type ShalomDriver } from '../../shalom/src/types';
import { SessionManager } from './session-manager.service';

const STORAGE = '{"cookies":[],"origins":[]}';

function build(overrides: {
  session?: { status: string; encryptedStorageState: string } | null;
  login?: jest.Mock;
  cooldownSeconds?: number;
}) {
  let loggedIn = overrides.session?.status === 'ACTIVE';
  const initialSession = overrides.session ?? null;

  const prisma = {
    shalomSession: {
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve(
          loggedIn
            ? { status: 'ACTIVE', encryptedStorageState: 'v1.enc' }
            : initialSession,
        ),
      ),
      upsert: jest.fn().mockImplementation(() => {
        loggedIn = true;
        return Promise.resolve({
          tenantId: 'tenant-1',
          status: 'ACTIVE',
          lastLoginAt: new Date(),
          lastError: null,
          expiresAt: null,
        });
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'tenant-1',
        code: 'nobitex',
        credentials: { username: 'user@test.com', encryptedPassword: 'v1.enc' },
      }),
    },
  } as unknown as PrismaService;

  const crypto = {
    decrypt: jest.fn().mockReturnValue(STORAGE),
    encrypt: jest.fn().mockReturnValue('v1.encrypted-storage'),
  } as unknown as SecretsCryptoService;

  const login =
    overrides.login ??
    jest.fn().mockResolvedValue({ outcome: 'SUCCESS', message: null, storageState: STORAGE });

  const driver = { login } as unknown as ShalomDriver;

  const config = {
    get: (key: string) =>
      key === 'SHALOM_RELOGIN_COOLDOWN_SECONDS'
        ? String(overrides.cooldownSeconds ?? 30)
        : undefined,
  } as unknown as ConfigService;

  return {
    manager: new SessionManager(prisma, crypto, driver, config),
    prisma,
    login,
  };
}

describe('SessionManager', () => {
  it('reutiliza la sesion activa sin loguear', async () => {
    const { manager, login } = build({
      session: { status: 'ACTIVE', encryptedStorageState: 'v1.enc' },
    });

    const state = await manager.requireStorageState('tenant-1');

    expect(state).toBe(STORAGE);
    expect(login).not.toHaveBeenCalled();
  });

  it('re-loguea automaticamente si la sesion expiro', async () => {
    const { manager, login } = build({
      session: { status: 'EXPIRED', encryptedStorageState: 'v1.enc' },
    });

    const state = await manager.requireStorageState('tenant-1');

    expect(login).toHaveBeenCalledTimes(1);
    expect(state).toBe(STORAGE);
  });

  it('falla con SESSION_REQUIRED si el login no funciona', async () => {
    const { manager } = build({
      session: { status: 'EXPIRED', encryptedStorageState: 'v1.enc' },
      login: jest.fn().mockResolvedValue({
        outcome: 'CAPTCHA',
        message: 'reCAPTCHA rechazo el intento',
      }),
    });

    await expect(manager.requireStorageState('tenant-1')).rejects.toMatchObject({
      kind: 'SESSION_REQUIRED',
    });
  });

  it('marca REQUIERE_LOGIN_MANUAL cuando el login falla', async () => {
    const { manager, prisma } = build({
      session: { status: 'EXPIRED', encryptedStorageState: 'v1.enc' },
      login: jest.fn().mockResolvedValue({ outcome: 'BAD_CREDENTIALS', message: 'Credenciales' }),
    });

    await manager.login('tenant-1', { auto: true });

    const updateMany = (prisma as unknown as { shalomSession: { updateMany: jest.Mock } })
      .shalomSession.updateMany;
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REQUIERE_LOGIN_MANUAL' }),
      }),
    );
  });

  it('respeta el cooldown entre logins automaticos', async () => {
    const { manager, login } = build({
      session: { status: 'EXPIRED', encryptedStorageState: 'v1.enc' },
      cooldownSeconds: 300,
    });

    await manager.login('tenant-1', { auto: true });
    await manager.login('tenant-1', { auto: true });

    expect(login).toHaveBeenCalledTimes(1);
  });

  it('recover() fuerza un intento inmediato', async () => {
    const { manager, login } = build({
      session: { status: 'EXPIRED', encryptedStorageState: 'v1.enc' },
      cooldownSeconds: 300,
    });

    await manager.login('tenant-1', { auto: true });
    const recovered = await manager.recover('tenant-1');

    expect(login).toHaveBeenCalledTimes(2);
    expect(recovered).toBe(true);
  });
});
