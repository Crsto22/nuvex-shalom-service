import "dotenv/config";

import path from "node:path";

import type { Page } from "playwright";

import { BASE_URL, OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";
import { readState } from "./lib/detect.js";

type Control = {
  tag: string;
  type: string | null;
  name: string | null;
  id: string | null;
  accept: string | null;
  placeholder: string | null;
  text: string | null;
  visible: boolean;
};

async function dismissPopups(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const close = page
      .locator(
        ".loyalty-popup-overlay button.popup-close, .loyalty-popup .popup-close, .modal.show .close, .swal2-close",
      )
      .first();

    if ((await close.count()) > 0) {
      await close.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      continue;
    }

    const overlay = page.locator(".loyalty-popup-overlay, .modal-backdrop").first();
    if ((await overlay.count()) === 0) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

async function dumpControls(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll("input, select, textarea, button, label[for], table th"),
    );

    return nodes.map((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const input = element as HTMLInputElement;
      return {
        tag: element.tagName.toLowerCase(),
        type: input.type ?? null,
        name: input.name ?? null,
        id: element.id || null,
        accept: input.accept ?? null,
        placeholder: input.placeholder ?? null,
        text: (element.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null,
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      };
    });
  });
}

async function openMasivo(page: Page) {
  const toggle = page.locator("#navbarDropdown-registra");
  await toggle.click({ timeout: 10_000 });
  await page.waitForTimeout(800);

  const item = page.locator(".dropdown-menu.show .figma-dropdown-item, .dropdown-menu .figma-dropdown-item")
    .filter({ hasText: "Registro masivo" })
    .first();

  await item.waitFor({ state: "visible", timeout: 10_000 });
  await item.click({ timeout: 10_000 });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(2500);
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
    await page.waitForTimeout(1500);

    const state = await readState(page);
    if (state.outcome !== "SUCCESS") {
      console.error(`No hay sesion activa (${state.outcome}). Ejecuta "npm run login" primero.`);
      process.exitCode = 1;
      return;
    }

    await dismissPopups(page);

    console.log("Abriendo Registra > Registro masivo ...");
    await openMasivo(page);

    const url = page.url();
    const title = await page.title();
    const controls = await dumpControls(page);
    const body = await page.locator("body").innerText().catch(() => "");

    console.log(`\nURL   : ${url}`);
    console.log(`Titulo: ${title}`);

    console.log("\n== Controles detectados ==");
    for (const control of controls.filter((item) => item.visible)) {
      const parts = [
        control.tag,
        control.type ? `type=${control.type}` : null,
        control.name ? `name=${control.name}` : null,
        control.id ? `id=${control.id}` : null,
        control.accept ? `accept=${control.accept}` : null,
        control.placeholder ? `ph="${control.placeholder}"` : null,
        control.text ? `"${control.text.slice(0, 45)}"` : null,
      ].filter(Boolean);
      console.log(`  ${parts.join(" ")}`);
    }

    console.log("\n== Encabezados de tabla ==");
    const headers = controls.filter((item) => item.tag === "th" && item.text);
    for (const header of headers) console.log(`  - ${header.text}`);

    console.log("\n== Texto de la pagina (primeras 900 letras) ==");
    console.log(body.replace(/\s+/g, " ").slice(0, 900));

    await page.screenshot({ path: path.join(OUT_DIR, `masivo-${runStamp}.png`), fullPage: true });
    const html = await page.content();
    await saveJson(`masivo-${runStamp}.json`, { url, title, controls, body: body.slice(0, 6000) });
    await page.screenshot({ path: path.join(OUT_DIR, `masivo-${runStamp}.png`), fullPage: true });
    const fs = await import("node:fs");
    fs.writeFileSync(path.join(OUT_DIR, `masivo-${runStamp}.html`), html, "utf8");

    console.log(`\nArtefactos en poc/out/masivo-${runStamp}.*`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
