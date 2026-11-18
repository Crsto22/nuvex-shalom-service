import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { OUT_DIR, ensureDirs, launchContext, readEnv } from "./lib/browser.js";

const URL_TARGET = "https://shalom.com.pe/rastrea/";

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const needles = (argValue("--needles") ?? "rastre,orden,codigo,seguimiento")
    .split(",")
    .map((needle) => needle.trim())
    .filter(Boolean);

  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(URL_TARGET, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    const result = await page.evaluate(async (terms: string[]) => {
      const script = document.querySelector("script[src*='/assets/index-']") as HTMLScriptElement | null;
      const src = script?.src ?? "/assets/index-957a76bb.js";
      const response = await fetch(src);
      const text = await response.text();

      const found: Array<{ needle: string; index: number; snippet: string }> = [];
      for (const needle of terms) {
        let index = text.indexOf(needle);
        let guard = 0;
        while (index !== -1 && guard < 3) {
          found.push({ needle, index, snippet: text.slice(Math.max(0, index - 500), index + 700) });
          index = text.indexOf(needle, index + 1);
          guard += 1;
        }
      }

      return { src, size: text.length, status: response.status, found };
    }, needles);

    console.log(`${result.src} · ${result.status} · ${result.size} bytes`);
    for (const item of result.found) {
      console.log(`\n--- ${item.needle} @ ${item.index} ---`);
      console.log(item.snippet);
    }

    fs.writeFileSync(
      path.join(OUT_DIR, "tracking-bundle-probe.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
