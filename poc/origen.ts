import "dotenv/config";

import path from "node:path";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(INDIVIDUAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const close = page.locator(".loyalty-popup .popup-close").first();
    if ((await close.count()) > 0) await close.click().catch(() => undefined);
    await page.waitForTimeout(600);

    // Paso 1: elegir "Caja Paquete S" haciendo click en su tarjeta (la centra)
    const card = page.locator(".card-panel").filter({ hasText: /Caja\s+Paquete\s+S\b/i }).first();
    await card.locator(".card-title").click({ timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(2500);

    const centered = await page.evaluate(() => {
      const camera = document.querySelector(".flicking-camera");
      if (!camera) return null;
      const rect = camera.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      let best: { text: string; distance: number } | null = null;
      for (const panel of Array.from(document.querySelectorAll(".card-panel"))) {
        const panelRect = panel.getBoundingClientRect();
        const distance = Math.abs(panelRect.left + panelRect.width / 2 - centerX);
        const text = (panel as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 40);
        if (!best || distance < best.distance) best = { text, distance: Math.round(distance) };
      }
      return best;
    });
    console.log(`centrado tras click: ${JSON.stringify(centered)}`);

    await page.getByRole("button", { name: /^continuar$/i }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(3000);

    const origin = page.locator(".multiselect").first();
    console.log("\nClick en Origen ...");
    await origin.click({ timeout: 8000 }).catch((error) => console.log(`  ${error.message}`));
    await page.waitForTimeout(1200);

    const searchInput = page.locator(".multiselect__input").first();
    const hasInput = await searchInput.count();
    console.log(`  input de busqueda: ${hasInput}`);

    if (hasInput > 0) {
      await searchInput.fill("TACNA");
      await page.waitForTimeout(2000);

      const options = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".multiselect__element")).map((element) =>
          (element as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 70),
        ),
      );
      console.log(`  opciones (${options.length}):`);
      for (const option of options.slice(0, 10)) console.log(`    - ${option}`);

      await page.screenshot({ path: path.join(OUT_DIR, `origen-opciones-${runStamp}.png`), fullPage: true });
      await saveJson(`origen-${runStamp}.json`, { centered, options });
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
