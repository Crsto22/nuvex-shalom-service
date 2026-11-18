import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';

import { BrowserPool } from '../libs/shalom/src/browser.pool';
import { PlaywrightShalomDriver } from '../libs/shalom/src/playwright.driver';
import { mapTracking } from '../libs/shalom/src/tracking-status';

/**
 * Prueba el driver contra Shalom sin base de datos.
 *
 * Uso:
 *   node --env-file=.env --env-file=poc/.env -r ts-node/register scripts/smoke-driver.ts
 *   ... --register   (ademas registra un envio real: cuesta dinero)
 */
function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const config = new ConfigService(process.env);
  const pool = new BrowserPool(config);
  const driver = new PlaywrightShalomDriver(pool, config);

  const email = arg('--email') ?? process.env.SHALOM_EMAIL ?? '';
  const password = arg('--password') ?? process.env.SHALOM_PASSWORD ?? '';

  if (process.argv.includes('--track')) {
    const orden = arg('--orden') ?? '104168762';
    const codigo = arg('--codigo') ?? '739D';
    try {
      const tracking = await driver.tracking(orden, codigo);
      const mapped = mapTracking(tracking);
      console.log(`\norden=${tracking.orden} codigo=${tracking.codigo}`);
      console.log(`estado="${tracking.estado}" progreso=${tracking.progreso}`);
      console.log(`mapeo -> ${mapped.status} (progress ${mapped.progress})`);
      for (const paso of tracking.pasos) console.log(`  ${paso.activo ? '[x]' : '[ ]'} ${paso.nombre}`);
    } finally {
      await pool.onModuleDestroy();
    }
    return;
  }

  if (!email || !password) {
    console.error('Faltan credenciales: use --email/--password o SHALOM_EMAIL/SHALOM_PASSWORD');
    process.exitCode = 2;
    return;
  }

  try {
    const startedAt = Date.now();
    const result = await driver.login(email, password);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

    console.log(`\nlogin: ${result.outcome} en ${seconds}s${result.message ? ` (${result.message})` : ''}`);

    if (result.outcome !== 'SUCCESS' || !result.storageState) {
      process.exitCode = 1;
      return;
    }

    const state = JSON.parse(result.storageState) as { cookies?: unknown[]; origins?: unknown[] };
    console.log(
      `storageState: ${state.cookies?.length ?? 0} cookies, ${state.origins?.length ?? 0} origenes con localStorage`,
    );

    if (process.argv.includes('--register')) {
      const documento = arg('--documento') ?? '42309872';
      const clave = arg('--clave') ?? '9872';
      const origen = arg('--origen') ?? 'AV TACNA';
      const destino = arg('--destino') ?? 'ZAMACOLA';
      const paquete = arg('--paquete') ?? 'PAQUETE S';

      console.log(`\nregistrando envio (${documento} · ${origen} -> ${destino} · ${paquete}) ...`);
      const order = await driver.registerOrder(
        {
          recipientDocument: documento,
          originAgency: origen,
          destinationAgency: destino,
          packageType: paquete,
          securityKey: clave,
        },
        result.storageState,
      );

      console.log(`orden: ${order.orden} · codigo: ${order.codigo ?? '-'} · monto: ${order.monto ?? '-'}`);
    }
  } finally {
    await pool.onModuleDestroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
