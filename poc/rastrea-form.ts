import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { OUT_DIR, ensureDirs, launchContext, readEnv } from "./lib/browser.js";

const URL_TARGET = "https://shalom.com.pe/rastrea/";

async function main() {
  const env = readEnv();
  ensureDirs();

  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(URL_TARGET, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3500);

    const info = await page.evaluate(() => {
      const input = document.querySelector("input[placeholder*='Orden']") as HTMLInputElement | null;
      const form = input?.closest("form") ?? null;
      const container = input?.closest("div")?.parentElement ?? null;

      const listButtons = Array.from(document.querySelectorAll("button")).map((button) => {
        const element = button as HTMLElement;
        const rect = element.getBoundingClientRect();
        return {
          text: element.innerText.replace(/\s+/g, " ").trim(),
          type: button.type,
          className: (element.className ?? "").toString().slice(0, 120),
          visible: rect.width > 0 && rect.height > 0,
          inForm: Boolean(button.closest("form")),
        };
      });

      return {
        hasInput: Boolean(input),
        formHtml: form ? form.outerHTML.slice(0, 3000) : null,
        containerHtml: container ? container.outerHTML.slice(0, 2000) : null,
        buttons: listButtons,
      };
    });

    console.log(`input encontrado: ${info.hasInput}`);
    console.log(`\n== form ==\n${info.formHtml ?? "(no hay form)"}`);
    console.log(`\n== contenedor ==\n${info.containerHtml ?? "(sin contenedor)"}`);
    console.log("\n== botones ==");
    for (const button of info.buttons.filter((item) => item.visible)) {
      console.log(`  "${button.text}" type=${button.type} inForm=${button.inForm} class="${button.className}"`);
    }

    fs.writeFileSync(path.join(OUT_DIR, "rastrea-form.html"), info.formHtml ?? "", "utf8");
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
