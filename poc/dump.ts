import "dotenv/config";

import path from "node:path";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(INDIVIDUAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(3500);

    const info = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, a.btn, .btn")).map((element) => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          className: (node.className ?? "").toString().slice(0, 90),
          text: (node.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 50),
          visible: rect.width > 0 && rect.height > 0,
          y: Math.round(rect.y),
        };
      });

      const flicking = Array.from(document.querySelectorAll("[class*='flicking']")).map((element) => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          className: (node.className ?? "").toString().slice(0, 90),
          text: "",
          visible: rect.width > 0 && rect.height > 0,
          y: Math.round(rect.y),
        };
      });

      const tabs = Array.from(document.querySelectorAll(".tab-pane, .nav-tabs, [role='tab']")).map((element) => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          className: (node.className ?? "").toString().slice(0, 90),
          text: (node.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 50),
          visible: rect.width > 0 && rect.height > 0,
          y: Math.round(rect.y),
        };
      });

      const panels = Array.from(document.querySelectorAll(".card-panel")).map((element) => {
        const node = element as HTMLElement;
        const parent = node.parentElement as HTMLElement | null;
        return {
          className: node.className,
          parentClass: parent?.className?.toString().slice(0, 90) ?? null,
          text: node.innerText.replace(/\s+/g, " ").trim().slice(0, 30),
        };
      });

      return { buttons, flicking, tabs, panels };
    });

    console.log("== Botones / .btn ==");
    for (const button of info.buttons.filter((item) => item.visible)) {
      console.log(`  ${button.tag} "${button.text}" class="${button.className}" y=${button.y}`);
    }

    console.log("\n== Flicking ==");
    for (const item of info.flicking) {
      console.log(`  ${item.tag} class="${item.className}" visible=${item.visible}`);
    }

    console.log("\n== Tabs ==");
    for (const item of info.tabs.filter((tab) => tab.visible)) {
      console.log(`  ${item.tag} "${item.text}" class="${item.className}"`);
    }

    console.log("\n== Card panels (parent) ==");
    for (const panel of info.panels) {
      console.log(`  "${panel.text}" parent="${panel.parentClass}"`);
    }

    await page.screenshot({ path: path.join(OUT_DIR, `dump-${runStamp}.png`), fullPage: true });
    await saveJson(`dump-${runStamp}.json`, info);
    console.log(`\nJSON: poc/out/dump-${runStamp}.json`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
