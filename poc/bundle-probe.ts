import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { OUT_DIR, ensureDirs, launchContext, readEnv } from "./lib/browser.js";

const URL_TARGET = "https://pro.shalom.pe/registroindividual";

async function main() {
  const env = readEnv();
  ensureDirs();

  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(URL_TARGET, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);

    const result = await page.evaluate(async () => {
      const response = await fetch("/js/app.js");
      const text = await response.text();

      const needles = ["service_order/save", "declaracion_jurada_tipo", "showMessageError", "clave_seguridad"];
      const found: Array<{ needle: string; index: number; snippet: string }> = [];

      for (const needle of needles) {
        let index = text.indexOf(needle);
        let guard = 0;
        while (index !== -1 && guard < 3) {
          found.push({
            needle,
            index,
            snippet: text.slice(Math.max(0, index - 900), index + 900),
          });
          index = text.indexOf(needle, index + 1);
          guard += 1;
        }
      }

      return { size: text.length, status: response.status, found };
    });

    console.log(`app.js: ${result.status} · ${result.size} bytes`);
    for (const item of result.found) {
      console.log(`\n--- ${item.needle} @ ${item.index} ---`);
      console.log(item.snippet);
    }

    fs.writeFileSync(path.join(OUT_DIR, "app-js-probe.json"), JSON.stringify(result, null, 2), "utf8");
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
