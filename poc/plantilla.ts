import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const MASIVO_URL = "https://pro.shalom.pe/registromasivo";

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(MASIVO_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    if (!page.url().includes("registromasivo")) {
      console.error(`Sesion no valida (redirigido a ${page.url()}). Ejecuta "npm run login".`);
      process.exitCode = 1;
      return;
    }

    const input = page.locator("input[type='file']").first();
    const fileInputInfo = {
      count: await page.locator("input[type='file']").count(),
      accept: await input.getAttribute("accept").catch(() => null),
      multiple: await input.getAttribute("multiple").catch(() => null),
    };

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: /descargar plantilla/i }).first().click();
    const download = await downloadPromise;

    const target = path.join(OUT_DIR, "plantilla-shalom.xlsx");
    await download.saveAs(target);

    const size = fs.statSync(target).size;
    console.log(`Plantilla guardada: ${target} (${(size / 1024).toFixed(1)} KB)`);
    console.log(`Nombre original : ${download.suggestedFilename()}`);
    console.log(`Input file      : ${JSON.stringify(fileInputInfo)}`);

    await saveJson(`plantilla-${runStamp}.json`, {
      suggestedFilename: download.suggestedFilename(),
      size,
      fileInputInfo,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
