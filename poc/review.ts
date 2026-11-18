import "dotenv/config";

import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const REVIEW_URL = "https://pro.shalom.pe/registromasivo/review";

async function readSwal(page: Page) {
  const container = page.locator(".swal2-container.swal2-shown").first();
  if ((await container.count()) === 0) return null;

  return container.evaluate((node) => ({
    title: (node.querySelector(".swal2-title") as HTMLElement | null)?.innerText.trim() ?? "",
    content: (node.querySelector("#swal2-content") as HTMLElement | null)?.innerText.trim() ?? "",
    inputs: Array.from(node.querySelectorAll("input")).map((input) => ({
      type: input.getAttribute("type"),
      placeholder: input.getAttribute("placeholder"),
      id: input.id || null,
    })),
    buttons: Array.from(node.querySelectorAll("button"))
      .filter((button) => (button.className || "").includes("swal2-"))
      .map((button) => (button as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  }));
}

async function readRows(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("table tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) =>
        (td as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      ),
    ),
  );
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(REVIEW_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);

    const summary = await page.evaluate(() => {
      const match = /(\d+)\s*env[ií]os registrados/i.exec(document.body.innerText);
      return {
        url: location.href,
        count: match ? Number(match[1]) : null,
        rows: Array.from(document.querySelectorAll("table tbody tr")).length,
      };
    });
    console.log(`Review: ${summary.url} · ${summary.count ?? "?"} envios · ${summary.rows} filas`);

    if (process.argv.includes("--clave")) {
      console.log("\nAbriendo modal CLAVE MASIVA ...");
      await page.getByRole("button", { name: /clave masiva/i }).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      const modal = await readSwal(page);
      console.log(JSON.stringify(modal, null, 2));
      await page.screenshot({ path: path.join(OUT_DIR, `clave-masiva-${runStamp}.png`) });
      await page.locator(".swal2-container.swal2-shown .swal2-cancel").first().click().catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
      await saveJson(`clave-masiva-${runStamp}.json`, modal);
    }

    if (process.argv.includes("--clear-all")) {
      console.log("\nLimpiando todos los envios en revision ...");
      await page.locator("button.btn-basurero").first().click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      const modal = await readSwal(page);
      if (modal) console.log(`  ${modal.title} — ${modal.content} · [${modal.buttons.join(" | ")}]`);
      await page.locator(".swal2-container.swal2-shown .swal2-confirm").first().click().catch(() => undefined);
      await page.waitForTimeout(2500);
      const after = await page.evaluate(() => {
        const match = /(\d+)\s*env[ií]os registrados/i.exec(document.body.innerText);
        return match ? Number(match[1]) : 0;
      });
      console.log(`Envios registrados tras limpiar: ${after}`);
      await saveJson(`clean-${runStamp}.json`, { remaining: after, modal });
    }

    const cards = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".shipment-card")).map((card) =>
        (card as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      ),
    );
    for (const card of cards.slice(0, 10)) console.log(`  - ${card}`);

    await page.screenshot({ path: path.join(OUT_DIR, `review-${runStamp}.png`), fullPage: true });
    const fs = await import("node:fs");
    fs.writeFileSync(path.join(OUT_DIR, `review-${runStamp}.html`), await page.content(), "utf8");
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
