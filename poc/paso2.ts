import "dotenv/config";

import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

async function state(page: Page) {
  const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  const activePanel = await page.evaluate(() => {
    const camera = document.querySelector(".flicking-camera");
    if (!camera) return null;
    const cameraRect = camera.getBoundingClientRect();
    const centerX = cameraRect.left + cameraRect.width / 2;
    let best: { text: string; distance: number } | null = null;
    for (const panel of Array.from(document.querySelectorAll(".card-panel"))) {
      const rect = panel.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - centerX);
      const label = (panel as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 30);
      if (!best || distance < best.distance) best = { text: label, distance: Math.round(distance) };
    }
    return best;
  });
  return { text: text.slice(0, 400), activePanel };
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

    log.push({ step: "inicial", ...(await state(page)) });
    console.log(`inicial: centrado=${JSON.stringify((log[0] as { activePanel: unknown }).activePanel)}`);

    console.log("\n>> flecha siguiente x4");
    for (let i = 0; i < 4; i += 1) {
      await page.locator(".flicking-arrow-next").click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1500);
    const afterArrows = await state(page);
    log.push({ step: "flechas", ...afterArrows });
    console.log(`tras flechas: centrado=${JSON.stringify(afterArrows.activePanel)}`);

    console.log("\n>> click en boton Continuar (por texto)");
    await page.getByRole("button", { name: /^continuar$/i }).first().click({ timeout: 10_000 }).catch((error) => console.log(`  ${error.message}`));
    await page.waitForTimeout(4000);

    const afterContinue = await state(page);
    log.push({ step: "continuar", ...afterContinue });
    console.log(`tras Continuar: centrado=${JSON.stringify(afterContinue.activePanel)}`);
    console.log(`texto: ${afterContinue.text}`);

    const visibleInputs = await page.evaluate(() =>
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
          };
        }),
    );
    console.log(`\ninputs visibles: ${JSON.stringify(visibleInputs)}`);

    await page.screenshot({ path: path.join(OUT_DIR, `paso2-${runStamp}.png`), fullPage: true });
    await saveJson(`paso2-${runStamp}.json`, { log, visibleInputs });
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
