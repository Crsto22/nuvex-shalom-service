import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

type Step = {
  step: number;
  url: string;
  text: string;
  controls: Array<{
    tag: string;
    type: string | null;
    name: string | null;
    id: string | null;
    placeholder: string | null;
    value: string;
    disabled: boolean;
    visible: boolean;
  }>;
  buttons: string[];
};

async function dismissPopups(page: Page) {
  const close = page.locator(".loyalty-popup .popup-close, .loyalty-popup-overlay button.popup-close").first();
  if ((await close.count()) > 0) {
    await close.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
}

async function capture(page: Page, step: number): Promise<Step> {
  return page.evaluate((stepNumber) => {
    const controls = Array.from(document.querySelectorAll("input, select, textarea")).map((node) => {
      const element = node as HTMLElement;
      const input = element as HTMLInputElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        type: input.type ?? null,
        name: input.name ?? null,
        id: element.id || null,
        placeholder: input.placeholder ?? null,
        value: String(input.value ?? "").slice(0, 40),
        disabled: Boolean(input.disabled),
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      };
    });

    const buttons = Array.from(document.querySelectorAll("button"))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((button) => (button as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 0);

    return {
      step: stepNumber,
      url: location.href,
      text: (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 1500),
      controls,
      buttons,
    };
  }, step);
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const steps: Step[] = [];
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(INDIVIDUAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await dismissPopups(page);

    const selectPackage = process.env.PACKAGE ?? "PAQUETE S";
    console.log(`Paso 1: seleccionando "${selectPackage}" ...`);

    const card = page
      .locator(".card-panel")
      .filter({ hasText: new RegExp(`Caja\\s+${selectPackage}`, "i") })
      .first();

    if ((await card.count()) > 0) {
      console.log("  click en .card-panel");
      await card.click({ timeout: 8000 });
    } else {
      console.log("  no encontre .card-panel; pruebo por texto");
      await page.getByText(`Caja ${selectPackage}`, { exact: true }).first().click({ timeout: 8000 });
    }

    await page.waitForTimeout(1500);

    const selected = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".card-panel"));
      return cards
        .map((card) => ({
          text: (card as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 40),
          className: card.className,
          selected:
            card.classList.contains("selected") ||
            (card.querySelector(".card-product")?.className ?? "").includes("selected"),
        }))
        .filter((item) => /paquete s/i.test(item.text));
    });
    console.log(`  estado tras click: ${JSON.stringify(selected)}`);

    for (let step = 1; step <= 6; step += 1) {
      const snapshot = await capture(page, step);
      steps.push(snapshot);

      console.log(`\n===== PASO ${step} · ${snapshot.url}`);
      console.log(snapshot.text.slice(0, 700));
      console.log(`Botones: ${snapshot.buttons.join(" | ")}`);
      const visibleControls = snapshot.controls.filter((control) => control.visible);
      for (const control of visibleControls) {
        console.log(
          `  ${control.tag}${control.type ? `[${control.type}]` : ""} ${control.name ?? control.id ?? ""}` +
            `${control.placeholder ? ` ph="${control.placeholder}"` : ""}` +
            `${control.value ? ` value="${control.value}"` : ""}` +
            `${control.disabled ? " (disabled)" : ""}`,
        );
      }

      await page.screenshot({ path: path.join(OUT_DIR, `individual-paso${step}-${runStamp}.png`), fullPage: true });

      if (snapshot.buttons.some((button) => /registrar env|pagar|confirmar/i.test(button))) {
        console.log("\n[!] Paso final detectado (Registrar/Pagar): se detiene sin pulsarlo.");
        break;
      }

      const continuar = page.getByRole("button", { name: /continuar|siguiente|next/i }).first();
      if ((await continuar.count()) === 0) {
        console.log("\nNo hay boton Continuar: fin del recorrido automatico.");
        break;
      }

      const disabled = await continuar.isDisabled().catch(() => false);
      if (disabled) {
        console.log("\nContinuar esta deshabilitado: hace falta completar campos en este paso.");
        break;
      }

      await continuar.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(3500);
      await dismissPopups(page);
    }

    await saveJson(`individual-wizard-${runStamp}.json`, steps);
    fs.writeFileSync(path.join(OUT_DIR, `individual-wizard-${runStamp}.html`), await page.content(), "utf8");
    console.log(`\nArtefactos: poc/out/individual-wizard-${runStamp}.*`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
