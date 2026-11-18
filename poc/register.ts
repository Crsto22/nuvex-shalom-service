import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const REVIEW_URL = "https://pro.shalom.pe/registromasivo/review";

type StepLog = { kind: "swal" | "action" | "info"; text: string };

async function readSwal(page: Page) {
  const container = page.locator(".swal2-container.swal2-shown").first();
  if ((await container.count()) === 0) return null;

  return container.evaluate((node) => ({
    title: (node.querySelector(".swal2-title") as HTMLElement | null)?.innerText.trim() ?? "",
    content: (node.querySelector("#swal2-content") as HTMLElement | null)?.innerText.trim() ?? "",
    buttons: Array.from(node.querySelectorAll("button"))
      .filter((button) => (button.className || "").includes("swal2-"))
      .map((button) => (button as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  }));
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const steps: StepLog[] = [];
  const downloads: string[] = [];

  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  page.on("download", (download) => {
    void (async () => {
      const name = `${runStamp}-${download.suggestedFilename()}`.replace(/[\\/:*?"<>|]/g, "_");
      const target = path.join(OUT_DIR, "downloads", name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await download.saveAs(target);
      downloads.push(target);
      console.log(`  descarga: ${name}`);
    })();
  });

  try {
    await page.goto(REVIEW_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);

    const before = await page.locator(".shipment-card").count();
    console.log(`Filas en revision antes de registrar: ${before}`);
    if (before === 0) {
      console.log("No hay envios en revision. Nada que registrar.");
      process.exitCode = 1;
      return;
    }

    const beforeText = await page
      .locator(".shipment-card")
      .first()
      .innerText()
      .catch(() => "");
    console.log(`Fila: ${beforeText.replace(/\s+/g, " ").trim()}`);

    console.log("\nPulsando 'Registrar envíos' ...");
    steps.push({ kind: "action", text: "click Registrar envíos" });
    await page.getByRole("button", { name: /registrar env[ií]os/i }).first().click({ timeout: 15_000 });

    for (let step = 0; step < 6; step += 1) {
      await page.waitForTimeout(3000);

      const modal = await readSwal(page);
      if (modal) {
        steps.push({ kind: "swal", text: `${modal.title} — ${modal.content} · [${modal.buttons.join(" | ")}]` });
        console.log(`Modal: ${modal.title} — ${modal.content} · [${modal.buttons.join(" | ")}]`);

        const isQuestion = /clave|seguridad/i.test(modal.title);
        if (isQuestion) {
          const cancel = page.locator(".swal2-container.swal2-shown .swal2-cancel").first();
          if ((await cancel.count()) > 0) {
            await cancel.click({ timeout: 8000 }).catch(() => undefined);
          } else {
            await page.keyboard.press("Escape").catch(() => undefined);
          }
        } else {
          await page
            .locator(".swal2-container.swal2-shown .swal2-confirm")
            .first()
            .click({ timeout: 10_000 })
            .catch(() => undefined);
        }
        continue;
      }

      if (page.url() !== REVIEW_URL) {
        steps.push({ kind: "info", text: `navego a ${page.url()}` });
        console.log(`Navego a: ${page.url()}`);
        break;
      }

      break;
    }

    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const buttons = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button, a.btn, a"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((element) => (element as HTMLElement).innerText.replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0)
        .slice(0, 40),
    );

    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    const cards = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".shipment-card, table tbody tr")).map((card) =>
        (card as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      ),
    );

    console.log(`\nURL final: ${page.url()}`);
    console.log(`Botones: ${buttons.join(" | ") || "(ninguno)"}`);
    if (cards.length) {
      console.log("\nFilas:");
      for (const card of cards.slice(0, 8)) console.log(`  - ${card}`);
    }
    console.log(`\nTexto:\n${body.slice(0, 1600)}`);

    await page.screenshot({ path: path.join(OUT_DIR, `registro-${runStamp}.png`), fullPage: true });
    fs.writeFileSync(path.join(OUT_DIR, `registro-${runStamp}.html`), await page.content(), "utf8");
    await saveJson(`registro-${runStamp}.json`, {
      beforeText,
      steps,
      url: page.url(),
      buttons,
      cards,
      body: body.slice(0, 6000),
      downloads,
    });

    console.log(`\nArtefactos: poc/out/registro-${runStamp}.*`);
    for (const file of downloads) console.log(`Descarga: ${file}`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
