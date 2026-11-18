import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const TRACK_URL = "https://shalom.com.pe/rastrea/";

type TrackingResult = {
  orden: string | null;
  codigo: string | null;
  estado: string | null;
  mensaje: string | null;
  fecha: string | null;
  pasos: Array<{ nombre: string; activo: boolean }>;
  progreso: number;
  url: string;
  texto: string;
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function dismissOverlays(page: Page) {
  for (const label of ["Aceptar", "Acepto", "Entendido"]) {
    const button = page.getByRole("button", { name: label }).first();
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
      await button.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
}

async function readTracking(page: Page, orden: string, codigo: string | null): Promise<TrackingResult> {
  return page.evaluate(
    ({ orden, codigo }) => {
      const heading = document.querySelector(".text-4xl.font-bold.text-red-color-sidebar");
      const mensaje = document.querySelector("p.font-normal.text-silver-title");
      const orderLine = Array.from(document.querySelectorAll("p")).find((node) =>
        /N[°º]\s*DE ORDEN/i.test((node as HTMLElement).innerText),
      );
      const dateLine = document.querySelector("p.text-placeholder-rastrea");

      const pasos = Array.from(
        document.querySelectorAll("p.text-md.font-bold.text-color-card-terrestre, div.text-md.font-bold.text-color-card-terrestre"),
      ).map((node) => {
        const block = node.parentElement;
        const circle = block?.querySelector("div.rounded-full div") ?? null;
        const className = (circle?.className ?? "").toString();
        return {
          nombre: (node as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
          activo: /bg-red-600/.test(className) && !/bg-white/.test(className),
        };
      });

      const bars = Array.from(document.querySelectorAll("div.h-2.w-1\\/3"));
      const progreso = bars.filter((bar) => {
        const style = window.getComputedStyle(bar as HTMLElement);
        return Number(style.opacity) > 0.5;
      }).length;

      return {
        orden,
        codigo,
        estado: heading ? (heading as HTMLElement).innerText.replace(/\s+/g, " ").trim() : null,
        mensaje: mensaje ? (mensaje as HTMLElement).innerText.replace(/\s+/g, " ").trim() : null,
        fecha: dateLine ? (dateLine as HTMLElement).innerText.replace(/\s+/g, " ").trim() : null,
        pasos,
        progreso,
        url: location.href,
        texto: (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 1500),
      };
    },
    { orden, codigo },
  );
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const order = argValue("--order") ?? "104167642";
  const code = argValue("--code") ?? "9DPK";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(TRACK_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await dismissOverlays(page);

    const orderInput = page.locator("input[placeholder*='Orden' i]").first();
    if ((await orderInput.count()) === 0) {
      console.error("No encontre el formulario de rastreo.");
      process.exitCode = 1;
      return;
    }

    await orderInput.click();
    await orderInput.pressSequentially(order, { delay: 60 });

    const codeInput = page.locator("input[placeholder*='Código de Orden' i]").first();
    if ((await codeInput.count()) > 0) {
      await codeInput.click();
      await codeInput.pressSequentially(code, { delay: 60 });
    }
    await page.waitForTimeout(400);

    console.log(`Consultando ${order} / ${code} ...`);
    await page.locator("form button[type='submit']").first().click({ timeout: 10_000 });

    await page
      .waitForURL(/rastrea\/information/i, { timeout: 30_000 })
      .catch(() => console.log("  (no cambio la URL a /rastrea/information)"));
    await page.waitForTimeout(3000);

    const result = await readTracking(page, order, code);

    console.log("\n================================================");
    console.log(`Estado   : ${result.estado ?? "-"}`);
    console.log(`Mensaje  : ${result.mensaje ?? "-"}`);
    console.log(`Orden    : ${result.orden ?? "-"}   Código: ${result.codigo ?? "-"}`);
    console.log(`Fecha    : ${result.fecha ?? "-"}`);
    console.log(`Progreso : ${result.progreso}/3`);
    for (const paso of result.pasos) console.log(`  ${paso.activo ? "[x]" : "[ ]"} ${paso.nombre}`);
    console.log("================================================\n");
    console.log(result.texto);

    await page.screenshot({ path: path.join(OUT_DIR, `rastreo-${stamp}.png`), fullPage: true });
    await saveJson(`rastreo-${stamp}.json`, result);
    fs.writeFileSync(path.join(OUT_DIR, `rastreo-${stamp}.html`), await page.content(), "utf8");
    console.log(`\nArtefactos: poc/out/rastreo-${stamp}.*`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
