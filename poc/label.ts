import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import type { Download, Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const PENDING_URL = "https://pro.shalom.pe/enviospendientes/list";

type Row = {
  order: string | null;
  code: string | null;
  text: string;
};

async function readRows(page: Page): Promise<Row[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".shipment-row")).map((row) => {
      const text = (row as HTMLElement).innerText.replace(/\s+/g, " ").trim();
      return {
        order: (row.querySelector(".order-number") as HTMLElement | null)?.innerText.trim() ?? null,
        code: (row.querySelector(".code-value") as HTMLElement | null)?.innerText.trim() ?? null,
        text,
      };
    }),
  );
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const wantedOrder = process.argv.find((arg) => /^\d{6,}$/.test(arg)) ?? null;
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const saved: string[] = [];

  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  const saveDownload = async (download: Download) => {
    const base = `${runStamp}-${download.suggestedFilename()}`.replace(/[\\/:*?"<>|]/g, "_");
    const target = path.join(OUT_DIR, "downloads", base);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await download.saveAs(target);
    saved.push(target);
    console.log(`  guardado: ${path.relative(process.cwd(), target)}`);
  };

  page.on("download", (download) => {
    void saveDownload(download).catch((error) => console.log(`  error guardando descarga: ${error}`));
  });

  // El rotulo se sirve como respuesta HTTP (application/pdf) dentro de una pestaña.
  // Se intercepta la respuesta con las cookies de la sesion y se guarda tal cual.
  // El rotulo se abre en una pestaña con el visor PDF de Chrome, que envuelve el
  // documento real. Interceptando la peticion se obtienen los bytes originales.
  await context.route("**/rotulo/pdf/**", async (route) => {
    const response = await route.fetch().catch(() => null);
    if (!response) {
      await route.abort().catch(() => undefined);
      return;
    }

    const body = await response.body().catch(() => null);
    const buffer = body ? Buffer.from(body) : null;
    const isPdf = buffer ? buffer.subarray(0, 4).toString("latin1") === "%PDF" : false;
    console.log(
      `  intercepcion rotulo: ${response.status()} ${response.headers()["content-type"] ?? ""} ` +
        `(${buffer?.length ?? 0} bytes, pdf=${isPdf})`,
    );

    if (buffer && isPdf) {
      const target = path.join(OUT_DIR, "downloads", `${runStamp}-rotulo-${wantedOrder ?? "orden"}.pdf`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
      saved.push(target);
      console.log(`  guardado: ${path.relative(process.cwd(), target)}`);
    }

    await route.fulfill({ response, body: buffer ?? undefined }).catch(() => undefined);
  });

  try {
    await page.goto(PENDING_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const rows = await readRows(page);
    console.log(`Filas en enviospendientes: ${rows.length}`);
    for (const row of rows) {
      console.log(`  - orden=${row.order ?? "?"} cod=${row.code ?? "?"} | ${row.text.slice(0, 150)}`);
    }

    const targetIndex = wantedOrder ? rows.findIndex((row) => row.order === wantedOrder) : 0;
    if (targetIndex < 0) {
      console.error(`No encontre la orden ${wantedOrder}`);
      process.exitCode = 1;
      return;
    }

    console.log(`\nDescargando rotulo de la orden ${rows[targetIndex]?.order} ...`);
    const popupPromise = page.waitForEvent("popup", { timeout: 20_000 }).catch(() => null);

    await page
      .locator(".shipment-row .btn-download-label")
      .nth(targetIndex)
      .click({ timeout: 15_000 })
      .catch((error) => console.log(`  no se pudo clickear: ${error instanceof Error ? error.message : error}`));

    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
      const url = popup.url();
      console.log(`  se abrio una pestaña: ${url}`);

      if (/^https?:/i.test(url) && !/blob:/i.test(url)) {
        const fileTarget = path.join(OUT_DIR, "downloads", `${runStamp}-rotulo-${rows[targetIndex]?.order}.pdf`);
        fs.mkdirSync(path.dirname(fileTarget), { recursive: true });
        const response = await context.request.get(url).catch(() => null);
        if (response?.ok()) {
          fs.writeFileSync(fileTarget, Buffer.from(await response.body()));
          saved.push(fileTarget);
          console.log(`  guardado desde URL: ${path.relative(process.cwd(), fileTarget)}`);
        }
      }

      await popup.screenshot({ path: path.join(OUT_DIR, `rotulo-${runStamp}.png`), fullPage: true }).catch(() => undefined);
      await popup.close().catch(() => undefined);
    }

    await page.waitForTimeout(5000);

    console.log("\nAbriendo 'Ver detalle' ...");
    await page.locator(".shipment-row .link-detail").nth(targetIndex).click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(3500);

    const detailText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    console.log(`URL detalle: ${page.url()}`);
    console.log(`Detalle: ${detailText.slice(0, 1200)}`);

    await page.screenshot({ path: path.join(OUT_DIR, `detalle-${runStamp}.png`), fullPage: true });
    fs.writeFileSync(path.join(OUT_DIR, `detalle-${runStamp}.html`), await page.content(), "utf8");

    await saveJson(`label-${runStamp}.json`, {
      rows,
      targetIndex,
      detailUrl: page.url(),
      detailText: detailText.slice(0, 4000),
      saved,
    });

    console.log(`\nDescargas: ${saved.length}`);
    for (const file of saved) console.log(`  - ${file}`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
