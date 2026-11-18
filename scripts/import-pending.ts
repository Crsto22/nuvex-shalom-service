import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { SecretsCryptoService } from '../libs/security/src/secrets-crypto.service';
import { BrowserPool } from '../libs/shalom/src/browser.pool';
import { PlaywrightShalomDriver } from '../libs/shalom/src/playwright.driver';

/**
 * Reconciliacion: importa a la base las guias que existen en Shalom y no
 * estan registradas (por ejemplo, si un job fallo despues de crearlas).
 *
 * Uso: node --env-file=.env -r ts-node/register/transpile-only scripts/import-pending.ts
 */
async function main() {
  const prisma = new PrismaClient();
  const config = new ConfigService(process.env);
  const crypto = new SecretsCryptoService(config);
  const pool = new BrowserPool(config);
  const driver = new PlaywrightShalomDriver(pool, config);

  try {
    const session = await prisma.shalomSession.findFirst({ where: { status: 'ACTIVE' } });
    if (!session) throw new Error('No hay sesion activa: inicia sesion desde la consola primero');

    const storageState = crypto.decrypt(
      session.encryptedStorageState,
      `tenant:${session.tenantId}:shalom-session`,
    );

    const pending = await driver.listPending(storageState);
    console.log(`Guias en Shalom: ${pending.length}`);

    let imported = 0;
    for (const item of pending) {
      if (!item.orden) continue;

      const existing = await prisma.shalomOrder.findUnique({
        where: { tenantId_orden: { tenantId: session.tenantId, orden: item.orden } },
      });
      if (existing) {
        console.log(`  ${item.orden}: ya registrada`);
        continue;
      }

      await prisma.shalomOrder.create({
        data: {
          tenantId: session.tenantId,
          orden: item.orden,
          codigo: item.codigo,
          monto: item.monto,
          status: 'REGISTRADO',
          destinatarioDoc: item.documento || '00000000',
          origen: 'IMPORTADO',
          destino: 'IMPORTADO',
          paquete: item.contenido || 'PAQUETE',
        },
      });

      await prisma.shalomEvent.create({
        data: {
          orderId: (
            await prisma.shalomOrder.findUniqueOrThrow({
              where: { tenantId_orden: { tenantId: session.tenantId, orden: item.orden } },
              select: { id: true },
            })
          ).id,
          status: 'REGISTRADO',
          progress: 0,
          description: `Importada desde Shalom (${item.orden})`,
        },
      });

      imported += 1;
      console.log(`  ${item.orden}: importada (${item.codigo ?? '-'} · S/ ${item.monto ?? '-'})`);
    }

    console.log(`\nImportadas: ${imported} de ${pending.length}`);
  } finally {
    await pool.onModuleDestroy();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
