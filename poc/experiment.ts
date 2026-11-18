import "dotenv/config";

import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

async function snapshot(page: Page, label: string, runStamp: string) {
  const info = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".card-panel")).map((card, index) => ({
      index,
      text: (card as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 45),
      className: card.className,
      style: card.getAttribute("style"),
      childClass: (card.querySelector(".card-product")?.className ?? "").trim(),
      rect: (() => {
        const rect = card.getBoundingClientRect();
        return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
      })(),
    }));
    return cards;
  });

  const continuar = page.getByRole("button", { name: /continuar/i }).first();
  const disabled = await continuar.isDisabled().catch(() => null);

  console.log(`\n[${label}] Continuar disabled=${disabled}`);
  for (const card of info) {
    console.log(
      `  #${card.index} "${card.text}" class="${card.className}" style="${card.style ?? ""}" ` +
        `child="${card.childClass}" rect=${card.rect.x},${card.rect.y} ${card.rect.w}x${card.rect.h}`,
    );
  }

  await page.screenshot({ path: path.join(OUT_DIR, `experimento-${label}-${runStamp}.png`), fullPage: true });
  return { info, disabled };
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());
  const results: unknown[] = [];

  try {
    await page.goto(INDIVIDUAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);

    const close = page.locator(".loyalty-popup .popup-close").first();
    if ((await close.count()) > 0) await close.click().catch(() => undefined);
    await page.waitForTimeout(800);

    results.push(await snapshot(page, "inicial", runStamp));

    const target = page.locator(".card-panel").filter({ hasText: /Caja\s+Paquete\s+S/i }).first();

    console.log("\n>> click en .card-product interno");
    await target.locator(".card-product").first().click({ timeout: 8000, force: true }).catch((error) => console.log(`  fallo: ${error.message}`));
    await page.waitForTimeout(1200);
    results.push(await snapshot(page, "click-interno", runStamp));

    console.log("\n>> click en el titulo");
    await target.locator(".card-title").first().click({ timeout: 8000, force: true }).catch((error) => console.log(`  fallo: ${error.message}`));
    await page.waitForTimeout(1200);
    results.push(await snapshot(page, "click-titulo", runStamp));

    console.log("\n>> click con force en .card-panel");
    await target.click({ timeout: 8000, force: true }).catch((error) => console.log(`  fallo: ${error.message}`));
    await page.waitForTimeout(1200);
    results.push(await snapshot(page, "click-force", runStamp));

    console.log("\n>> click por coordenadas del centro del titulo");
    const box = await target.locator(".card-title").first().boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1200);
    }
    results.push(await snapshot(page, "click-coords", runStamp));

    console.log("\n>> doble click");
    await target.locator(".card-title").first().dblclick({ timeout: 8000, force: true }).catch(() => undefined);
    await page.waitForTimeout(1200);
    results.push(await snapshot(page, "dblclick", runStamp));

    await saveJson(`experimento-${runStamp}.json`, results);
    console.log(`\nJSON: poc/out/experimento-${runStamp}.json`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
