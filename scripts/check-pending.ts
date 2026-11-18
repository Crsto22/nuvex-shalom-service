import 'reflect-metadata';

import { chromium } from 'playwright';

function readEnv(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of require('node:fs').readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match?.[1]) values[match[1]] = match[2] ?? '';
  }
  return values;
}

/** Login + revision de una guia en la lista de pendientes (misma sesion). */
async function main() {
  const index = process.argv.indexOf('--orden');
  const orden = index === -1 ? '104386827' : (process.argv[index + 1] ?? '');
  const env = readEnv('poc/.env');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  });

  await page.goto('https://pro.shalom.pe/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"]').fill(env.SHALOM_EMAIL ?? '');
  await page.locator('input[name="password"]').fill(env.SHALOM_PASSWORD ?? '');
  await page.locator('#formLogin button[type="submit"]').click();
  await page.waitForURL(/\/home/, { timeout: 60_000 });

  await page.goto('https://pro.shalom.pe/enviospendientes/list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.shipment-row')).map((row) => ({
      orden: (row.querySelector('.order-number') as HTMLElement | null)?.innerText.trim() ?? null,
      codigo: (row.querySelector('.code-value') as HTMLElement | null)?.innerText.trim() ?? null,
      texto: (row as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 140),
    })),
  );

  console.log(`url: ${page.url()}`);
  console.log(`filas en pendientes: ${rows.length}`);
  for (const row of rows) console.log(`  ${row.orden} / ${row.codigo} · ${row.texto}`);

  const found = rows.find((row) => row.orden === orden);
  console.log(found ? `-> ${orden} EXISTE` : `-> ${orden} NO aparece`);

  await page.screenshot({ path: 'tmp/pendientes.png', fullPage: true });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
