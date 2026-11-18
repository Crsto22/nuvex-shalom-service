import "dotenv/config";

import path from "node:path";

import type { Page } from "playwright";

import { BASE_URL, OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";
import { readState } from "./lib/detect.js";

type MenuItem = { menu: string; index: number; text: string };

const MENUS = ["Registra", "Operaciones", "Mantenimiento", "Centro de ayuda"];

async function dismissModals(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const modal = page.locator(".modal.show, .swal2-container").first();
    if ((await modal.count()) === 0) return;

    const close = modal
      .locator(
        "button.close, .btn-close, .swal2-close, button[aria-label='Close'], button[aria-label='Cerrar']",
      )
      .first();

    if ((await close.count()) > 0) {
      await close.click({ timeout: 3000 }).catch(() => undefined);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.mouse.click(5, 5).catch(() => undefined);
    }
    await page.waitForTimeout(700);
  }
}

async function readOpenMenu(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".dropdown-menu"));
    const result: string[] = [];
    for (const menu of items) {
      const style = window.getComputedStyle(menu as HTMLElement);
      if (style.display === "none" || style.visibility === "hidden") continue;
      for (const item of Array.from(menu.querySelectorAll("a, button"))) {
        const text = (item as HTMLElement).innerText.replace(/\s+/g, " ").trim();
        if (text) result.push(text);
      }
    }
    return [...new Set(result)];
  });
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    const state = await readState(page);
    if (state.outcome !== "SUCCESS") {
      console.error(`No hay sesion activa (${state.outcome}). Ejecuta "npm run login" primero.`);
      process.exitCode = 1;
      return;
    }

    await dismissModals(page);

    const menus: Record<string, string[]> = {};
    const allItems: MenuItem[] = [];

    for (const menu of MENUS) {
      const toggle = page.locator(".navbar-nav a, .navbar-nav button").filter({ hasText: menu }).first();
      if ((await toggle.count()) === 0) {
        console.log(`(menu no encontrado: ${menu})`);
        continue;
      }

      await toggle.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(700);

      const items = await readOpenMenu(page);
      menus[menu] = items;
      items.forEach((text, index) => allItems.push({ menu, index, text }));

      console.log(`\n== ${menu} (${items.length}) ==`);
      for (const item of items) console.log(`  - ${item}`);

      await page.screenshot({
        path: path.join(OUT_DIR, `menu-${menu.replace(/\s+/g, "-").toLowerCase()}-${runStamp}.png`),
      }).catch(() => undefined);

      await page.keyboard.press("Escape").catch(() => undefined);
      await page.mouse.click(5, 400).catch(() => undefined);
      await page.waitForTimeout(400);
    }

    await saveJson(`menus-${runStamp}.json`, { url: page.url(), menus, allItems });
    console.log(`\nJSON: poc/out/menus-${runStamp}.json`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
