import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { SecretsCryptoService } from '../libs/security/src/secrets-crypto.service';
import { BrowserPool } from '../libs/shalom/src/browser.pool';
import { PlaywrightShalomDriver } from '../libs/shalom/src/playwright.driver';

/** Uso: node -r ts-node/register/transpile-only scripts/check-order.ts --orden 104386827 */
async function main() {
  const index = process.argv.indexOf('--orden');
  const orden = index === -1 ? '104386827' : (process.argv[index + 1] ?? '');

  const prisma = new PrismaClient();
  const config = new ConfigService(process.env);
  const crypto = new SecretsCryptoService(config);
  const pool = new BrowserPool(config);
  const driver = new PlaywrightShalomDriver(pool, config);

  try {
    const session = await prisma.shalomSession.findFirst({ where: { status: 'ACTIVE' } });
    if (!session) throw new Error('sin sesion activa');

    const storageState = crypto.decrypt(
      session.encryptedStorageState,
      `tenant:${session.tenantId}:shalom-session`,
    );

    const codigo = await driver.getOrderCode(orden, storageState);
    console.log(`orden ${orden}: ${codigo ? `existe en pendientes (codigo ${codigo})` : 'NO aparece en pendientes'}`);
  } finally {
    await pool.onModuleDestroy();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
