import 'reflect-metadata';

import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Page } from 'playwright';

function readEnv(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match?.[1]) values[match[1]] = match[2] ?? '';
  }
  return values;
}

async function dismissPopups(page: Page) {
  const close = page.locator('.loyalty-popup .popup-close').first();
  if ((await close.count()) > 0) await close.click().catch(() => undefined);
}

async function clickContinue(page: Page) {
  const candidates = page.locator('button.btn.btn-redshalom').filter({ hasText: /continuar/i });
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click();
      await page.waitForTimeout(2500);
      return;
    }
  }
  throw new Error('No hay Continuar visible');
}

async function centerProduct(page: Page, title: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await page.evaluate(() => {
      const viewport = document.querySelector('.flicking-viewport');
      if (!viewport) return null;
      const rect = viewport.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const panels = Array.from(document.querySelectorAll('.card-panel')).map((panel) => {
        const panelRect = panel.getBoundingClientRect();
        return {
          text: (panel as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
          distance: Math.abs(panelRect.left + panelRect.width / 2 - centerX),
        };
      });
      panels.sort((a, b) => a.distance - b.distance);
      return panels[0] ? { text: panels[0].text, distance: panels[0].distance } : null;
    });
    if (!current) throw new Error('sin carrusel');
    if (current.text.toLowerCase().includes(title.toLowerCase()) && current.distance < 80) return;
    await page.locator('.flicking-arrow-next').click();
    await page.waitForTimeout(900);
  }
  throw new Error('no se centro el producto');
}

async function pick(page: Page, label: string, search: string) {
  const boxes = page.locator('.multiselect');
  const count = await boxes.count();
  for (let index = 0; index < count; index += 1) {
    const box = boxes.nth(index);
    if (!(await box.isVisible().catch(() => false))) continue;
    const text = (await box.innerText()).replace(/\s+/g, ' ');
    if (!text.toLowerCase().includes(label.toLowerCase())) continue;
    await box.click();
    await page.waitForTimeout(600);
    await box.locator('input.multiselect__input').fill(search);
    await page.waitForTimeout(1600);
    const option = box.locator('.multiselect__element').filter({ hasText: search }).first();
    await option.click();
    await page.waitForTimeout(1600);
    return;
  }
  throw new Error(`no se encontro ${label}`);
}

async function main() {
  const env = readEnv('poc/.env');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  });

  await page.goto('https://pro.shalom.pe/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"]').fill(env.SHALOM_EMAIL ?? '');
  await page.locator('input[name="password"]').fill(env.SHALOM_PASSWORD ?? '');
  await page.locator('#formLogin button[type="submit"]').click();
  await page.waitForURL(/\/home/, { timeout: 60_000 });

  await page.goto('https://pro.shalom.pe/registroindividual', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await dismissPopups(page);

  await centerProduct(page, 'Caja Paquete S');
  await clickContinue(page);
  await pick(page, 'Origen', 'AV TACNA');
  await pick(page, 'Destino', 'ZAMACOLA');
  await clickContinue(page);
  await page.waitForTimeout(1500);
  await clickContinue(page);

  await page.locator('input[placeholder="DNI"]').first().waitFor({ timeout: 25_000 });

  const dom = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="DNI"]');
    const scope = input?.closest('.card') ?? input?.parentElement?.parentElement?.parentElement;
    return scope ? (scope as HTMLElement).outerHTML : 'sin contenedor';
  });

  fs.writeFileSync(path.join('tmp', 'recipient-step.html'), dom, 'utf8');

  const summary = await page.evaluate(() => ({
    inputs: Array.from(document.querySelectorAll('input')).map((input) => ({
      placeholder: (input as HTMLInputElement).placeholder,
      id: input.id,
      type: (input as HTMLInputElement).type,
      visible: input.getBoundingClientRect().width > 0,
    })),
    tabs: Array.from(document.querySelectorAll('button, div, span'))
      .map((node) => (node as HTMLElement).innerText?.trim())
      .filter((text) => text === 'DNI' || text === 'RUC' || text === 'CE'),
  }));

  console.log(JSON.stringify(summary, null, 2));
  console.log('DOM guardado en tmp/recipient-step.html');

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
