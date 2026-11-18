import "dotenv/config";

import path from "node:path";

import type { Page } from "playwright";

import { BASE_URL, OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function dismissPopups(page: Page) {
  const close = page.locator(".loyalty-popup .popup-close, .loyalty-popup-overlay button.popup-close").first();
  if ((await close.count()) > 0) {
    await close.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
}

async function navigateMenu(page: Page, menuPath: string[]) {
  if (menuPath.length === 0) return;

  const toggleLabel = menuPath[0] ?? "";
  const itemLabel = menuPath[1] ?? null;

  const toggle = page.locator(".navbar-nav a, .navbar-nav button").filter({ hasText: toggleLabel }).first();
  if ((await toggle.count()) === 0) {
    console.log(`(no encontre el menu "${toggleLabel}")`);
    return;
  }
  await toggle.click({ timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  if (!itemLabel) return;

  const item = page.locator(".dropdown-menu .figma-dropdown-item").filter({ hasText: itemLabel }).first();
  if ((await item.count()) === 0) {
    console.log(`(no encontre la opcion "${itemLabel}")`);
    return;
  }
  await item.click({ timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
}

async function dumpTables(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("table")).map((table) => ({
      headers: Array.from(table.querySelectorAll("thead th")).map((th) =>
        (th as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      ),
      rows: Array.from(table.querySelectorAll("tbody tr")).slice(0, 10).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) =>
          (td as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        ),
      ),
      totalRows: table.querySelectorAll("tbody tr").length,
    })),
  );
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const targetUrl = argValue("--url") ?? BASE_URL;
  const menuArg = argValue("--menu");
  const menuPath = menuArg ? menuArg.split(">").map((part) => part.trim()) : [];

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    await dismissPopups(page);

    if (menuPath.length) {
      console.log(`Navegando menu: ${menuPath.join(" > ")}`);
      await navigateMenu(page, menuPath);
    }

    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button, a.btn"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((element) => (element as HTMLElement).innerText.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );

    const tables = await dumpTables(page);
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");

    console.log(`\nURL: ${page.url()}`);
    console.log(`Botones: ${buttons.join(" | ") || "(ninguno)"}`);
    for (const table of tables) {
      console.log(`\nTabla: ${table.headers.join(" | ") || "(sin headers)"} · filas=${table.totalRows}`);
      for (const row of table.rows.slice(0, 6)) console.log(`  - ${row.join(" || ")}`);
    }
    console.log(`\nTexto:\n${body.slice(0, 1500)}`);

    await page.screenshot({ path: path.join(OUT_DIR, `inspect-${runStamp}.png`), fullPage: true });
    const fs = await import("node:fs");
    fs.writeFileSync(path.join(OUT_DIR, `inspect-${runStamp}.html`), await page.content(), "utf8");
    await saveJson(`inspect-${runStamp}.json`, {
      url: page.url(),
      buttons,
      tables,
      body: body.slice(0, 8000),
    });
    console.log(`\nArtefactos: poc/out/inspect-${runStamp}.*`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
