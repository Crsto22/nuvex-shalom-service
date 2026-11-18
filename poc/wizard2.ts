import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

async function centerProduct(page: Page, label: string) {
  const camera = await page.evaluate(() => {
    const element = document.querySelector(".flicking-camera");
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  if (!camera) return false;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await page.evaluate(() => {
      const element = document.querySelector(".flicking-camera");
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      let best: { text: string; distance: number } | null = null;
      for (const panel of Array.from(document.querySelectorAll(".card-panel"))) {
        const panelRect = panel.getBoundingClientRect();
        const distance = Math.abs(panelRect.left + panelRect.width / 2 - centerX);
        const text = (panel as HTMLElement).innerText.replace(/\s+/g, " ").trim();
        if (!best || distance < best.distance) best = { text, distance };
      }
      return best;
    });

    if (current && current.text.toLowerCase().includes(label.toLowerCase()) && current.distance < 40) {
      console.log(`  centrado: "${current.text.slice(0, 40)}" (d=${current.distance})`);
      return true;
    }

    const direction = attempt % 2 === 0 ? ".flicking-arrow-next" : ".flicking-arrow-prev";
    console.log(`  moviendo con ${direction} ...`);
    await page.locator(direction).click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(900);
  }

  return false;
}

async function dumpSelects(page: Page, tag: string) {
  const data = await page.evaluate(() => {
    const boxes = Array.from(
      document.querySelectorAll(
        ".select-route, .select-origin, .select-destination, .multiselect, .vs__dropdown-toggle, .dropdown, .input-select",
      ),
    ).map((element) => {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      return {
        className: (node.className ?? "").toString().slice(0, 90),
        text: (node.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        visible: rect.width > 0 && rect.height > 0,
      };
    });

    const inputs = Array.from(document.querySelectorAll("input")).map((element) => {
      const input = element as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      return {
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        className: (input.className ?? "").toString().slice(0, 70),
        visible: rect.width > 0 && rect.height > 0,
      };
    });

    return { boxes, inputs };
  });

  console.log(`\n== ${tag} ==`);
  for (const box of data.boxes.filter((item) => item.visible)) {
    console.log(`  BOX class="${box.className}" text="${box.text}"`);
  }
  for (const input of data.inputs.filter((item) => item.visible)) {
    console.log(`  INPUT type=${input.type} name=${input.name} id=${input.id} ph="${input.placeholder}" class="${input.className}"`);
  }

  return data;
}

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

    console.log("Centrando Caja Paquete S ...");
    const ok = await centerProduct(page, "Caja Paquete S");
    if (!ok) console.log("  no logre centrarla");

    console.log("Continuar ...");
    await page.getByRole("button", { name: /^continuar$/i }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(3500);
    await dumpSelects(page, "PASO 2 (origen/destino)");

    const html = await page.evaluate(() => {
      const container = document.querySelector(".container-envia");
      const source = container ? container.innerHTML : document.body.innerHTML;
      return source.slice(0, 12000);
    });
    fs.writeFileSync(path.join(OUT_DIR, `paso2-dom-${runStamp}.html`), html, "utf8");

    await page.screenshot({ path: path.join(OUT_DIR, `paso2b-${runStamp}.png`), fullPage: true });
    await saveJson(`paso2b-${runStamp}.json`, { url: page.url() });
    console.log(`\nDOM: poc/out/paso2-dom-${runStamp}.html`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
