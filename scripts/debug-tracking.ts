import 'reflect-metadata';

import { chromium } from 'playwright';

/**
 * Diagnostico del rastreo publico: captura dialogs, red y estado de la pagina.
 * Uso: node -r ts-node/register/transpile-only scripts/debug-tracking.ts --orden 104168762 --codigo 739D
 */
function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main() {
  const orden = arg('--orden') ?? '104168762';
  const codigo = arg('--codigo') ?? '739D';

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.HEADFUL !== '1',
  });
  const page = await browser.newPage({
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    userAgent:
      process.env.SHALOM_USER_AGENT ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  });

  page.on('dialog', (dialog) => {
    console.log(`[dialog:${dialog.type()}] ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[console] ${message.text().slice(0, 200)}`);
  });
  page.on('response', (response) => {
    if (/rastrea|api\/v1\/web/i.test(response.url())) {
      console.log(`[net] ${response.status()} ${response.request().method()} ${response.url()}`);
      if (/rastrea\/(buscar|estados)/i.test(response.url())) {
        void response
          .text()
          .then((text) => console.log(`[body] ${text.slice(0, 300)}`))
          .catch(() => undefined);
      }
    }
  });

  await page.goto('https://shalom.com.pe/rastrea/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const orderInput = page.locator('input[placeholder*="Orden" i]').first();
  const codeInput = page.locator('input[placeholder*="Código de Orden" i]').first();
  await orderInput.click();
  await orderInput.pressSequentially(orden, { delay: 60 });
  await codeInput.click();
  await codeInput.pressSequentially(codigo, { delay: 60 });
  await page.waitForTimeout(500);

  console.log(`url antes: ${page.url()}`);
  await page.locator("form button[type='submit']").first().click();

  await page.waitForTimeout(8000);
  console.log(`url despues: ${page.url()}`);
  console.log(`texto: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);

  await page.screenshot({ path: 'tmp/debug-tracking.png', fullPage: true });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
