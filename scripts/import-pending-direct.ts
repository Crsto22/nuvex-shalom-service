import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import { chromium } from 'playwright';

/**
 * Reconcilia las guias pendientes de Shalom con la base.
 * Hace el login dentro del mismo navegador (evita el handoff de storageState).
 *
 * Uso: node --env-file=.env -r ts-node/register/transpile-only scripts/import-pending-direct.ts
 */
function readEnv(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match?.[1]) values[match[1]] = match[2] ?? '';
  }
  return values;
}

async function main() {
  const env = readEnv('.env');
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUnique({ where: { code: 'nobitex' } });
  if (!tenant) throw new Error('tenant nobitex no existe');

  const email = env.SHALOM_EMAIL ?? process.env.SHALOM_EMAIL ?? '';
  const password = env.SHALOM_PASSWORD ?? process.env.SHALOM_PASSWORD ?? '';
  if (!email || !password) throw new Error('faltan SHALOM_EMAIL/SHALOM_PASSWORD en .env');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  });

  try {
    await page.goto('https://pro.shalom.pe/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.locator('#formLogin button[type="submit"]').click();
    await page.waitForURL(/\/home/, { timeout: 90_000 });

    await page.goto('https://pro.shalom.pe/enviospendientes/list', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.shipment-row')).map((row) => {
        const text = (row as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
        const amount = /S\/\s*([\d.,]+)/.exec(text)?.[1];
        const document = /DNI:\s*(\d{6,12})/.exec(text)?.[1];
        const content = /(\d+\s+[A-Za-z ]+?)\s+\d{2}-\d{2}-\d{4}/.exec(text)?.[1];
        return {
          orden: (row.querySelector('.order-number') as HTMLElement | null)?.innerText.trim() ?? '',
          codigo: (row.querySelector('.code-value') as HTMLElement | null)?.innerText.trim() ?? null,
          monto: amount ? Number(amount.replace(',', '')) : null,
          contenido: content?.trim() ?? '',
          documento: document ?? '',
        };
      }),
    );

    console.log(`Guias en Shalom: ${rows.length}`);
    let imported = 0;

    for (const row of rows) {
      if (!row.orden) continue;

      const existing = await prisma.shalomOrder.findUnique({
        where: { tenantId_orden: { tenantId: tenant.id, orden: row.orden } },
      });
      if (existing) {
        console.log(`  ${row.orden}: ya registrada`);
        continue;
      }

      const created = await prisma.shalomOrder.create({
        data: {
          tenantId: tenant.id,
          orden: row.orden,
          codigo: row.codigo,
          monto: row.monto,
          status: 'REGISTRADO',
          destinatarioDoc: row.documento || '00000000',
          origen: 'IMPORTADO',
          destino: 'IMPORTADO',
          paquete: row.contenido || 'PAQUETE',
        },
      });

      await prisma.shalomEvent.create({
        data: {
          orderId: created.id,
          status: 'REGISTRADO',
          progress: 0,
          description: `Importada desde Shalom (${row.orden})`,
        },
      });

      imported += 1;
      console.log(`  ${row.orden}: importada (${row.codigo ?? '-'} · S/ ${row.monto ?? '-'} · ${row.documento || 'sin dni'})`);
    }

    console.log(`\nImportadas: ${imported} de ${rows.length}`);

    // Guarda la sesion fresca para que el worker la use.
    const state = JSON.stringify(await page.context().storageState());
    const { SecretsCryptoService } = await import('../libs/security/src/secrets-crypto.service');
    const crypto = new SecretsCryptoService(new ConfigService(process.env));

    await prisma.shalomSession.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        encryptedStorageState: crypto.encrypt(state, `tenant:${tenant.id}:shalom-session`),
        status: 'ACTIVE',
        lastLoginAt: new Date(),
      },
      update: {
        encryptedStorageState: crypto.encrypt(state, `tenant:${tenant.id}:shalom-session`),
        status: 'ACTIVE',
        lastLoginAt: new Date(),
        lastError: null,
      },
    });
    console.log('Sesion actualizada para el worker');
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
