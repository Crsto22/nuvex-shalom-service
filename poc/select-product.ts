import "dotenv/config";

import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

async function activeItems(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".active"))
      .map((node) => ({
        tag: (node as HTMLElement).tagName.toLowerCase(),
        className: node.className,
        text: (node as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 50),
      }))
      .filter((item) => item.text.length > 0),
  );
}

async function snapshot(page: Page, label: string, runStamp: string) {
  const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  console.log(`\n[${label}] url=${page.url()}`);
  console.log(`  texto: ${text.slice(0, 300)}`);
  const active = await activeItems(page);
  console.log(`  activos: ${JSON.stringify(active)}`);
  await page.screenshot({ path: path.join(OUT_DIR, `sel-${label}-${runStamp}.png`), fullPage: true });
  return { label, text: text.slice(0, 900), active };
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());
  const log: unknown[] = [];

  try {
    await page.goto(INDIVIDUAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const close = page.locator(".loyalty-popup .popup-close").first();
    if ((await close.count()) > 0) await close.click().catch(() => undefined);
    await page.waitForTimeout(800);

    log.push(await snapshot(page, "inicial", runStamp));

    const card = page.locator(".card-panel").filter({ hasText: /Caja\s+Paquete\s+S\b/i }).first();
    console.log("\n>> click para centrar 'Caja Paquete S'");
    await card.locator(".card-title").click({ timeout: 8000 }).catch((error) => console.log(`  ${error.message}`));
    await page.waitForTimeout(2000);
    log.push(await snapshot(page, "centrado", runStamp));

    console.log("\n>> click en button.btn-continuar");
    const continuar = page.locator("button.btn-continuar").first();
    console.log(`  encontrados: ${await continuar.count()}`);
    await continuar.click({ timeout: 10_000 }).catch((error) => console.log(`  ${error.message}`));
    await page.waitForTimeout(4000);
    log.push(await snapshot(page, "tras-continuar", runStamp));

    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input, select, textarea"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((element) => {
          const input = element as HTMLInputElement;
          return {
            tag: element.tagName.toLowerCase(),
            type: input.type ?? null,
            name: input.name ?? null,
            id: element.id || null,
            placeholder: input.placeholder ?? null,
            value: String(input.value ?? ""),
          };
        }),
    );
    console.log("\n== Inputs visibles tras paso 1 ==");
    for (const input of inputs) console.log(`  ${JSON.stringify(input)}`);

    await saveJson(`sel-${runStamp}.json`, { log, inputs });
    console.log(`\nJSON: poc/out/sel-${runStamp}.json`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
