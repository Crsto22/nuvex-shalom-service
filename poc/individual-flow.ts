import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

type StepShot = { step: number; url: string; text: string; buttons: string[] };

async function dismissPopups(page: Page) {
  const close = page.locator(".loyalty-popup .popup-close").first();
  if ((await close.count()) > 0) {
    await close.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
}

/** Devuelve el texto de la tarjeta centrada del carrusel Flicking. */
async function centeredPanel(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".flicking-viewport");
    if (!viewport) return null;

    const viewportRect = viewport.getBoundingClientRect();
    const centerX = viewportRect.left + viewportRect.width / 2;

    const panels = Array.from(document.querySelectorAll(".card-panel")).map((panel, index) => {
      const rect = panel.getBoundingClientRect();
      return {
        index,
        distance: Math.abs(rect.left + rect.width / 2 - centerX),
        text: (panel as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      };
    });

    panels.sort((a, b) => a.distance - b.distance);
    const best = panels[0];
    return best
      ? { index: best.index, text: best.text, distance: Math.round(best.distance), total: panels.length }
      : null;
  });
}

async function selectProduct(page: Page, target: string) {
  const normalized = target.toLowerCase().replace(/\s+/g, " ");

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await centeredPanel(page);
    if (!current) return false;

    console.log(`  intento ${attempt + 1}: "${current.text.slice(0, 35)}" (d=${current.distance}, idx=${current.index}/${current.total})`);

    if (current.text.toLowerCase().includes(normalized)) {
      console.log(`  centrado OK: "${current.text.slice(0, 35)}"`);
      return true;
    }

    // avanza siempre hacia adelante: el carrusel es circular
    await page.locator(".flicking-arrow-next").click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1400);
  }

  return false;
}

async function pickMultiSelect(page: Page, label: string, search: string) {
  const boxes = page.locator(".multiselect");
  const count = await boxes.count();

  for (let index = 0; index < count; index += 1) {
    const box = boxes.nth(index);
    const visible = await box.isVisible().catch(() => false);
    if (!visible) continue;

    const text = (await box.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (label && !text.toLowerCase().includes(label.toLowerCase())) continue;

    console.log(`  abriendo multiselect "${text.slice(0, 30)}"`);
    await box.click({ timeout: 8000 });
    await page.waitForTimeout(800);

    const input = box.locator("input.multiselect__input").first();
    await input.fill(search);
    await page.waitForTimeout(2000);

    const options = box.locator(".multiselect__element");
    const optionCount = await options.count();
    console.log(`  opciones para "${search}": ${optionCount}`);

    for (let optionIndex = 0; optionIndex < optionCount; optionIndex += 1) {
      const option = options.nth(optionIndex);
      const optionText = (await option.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (!optionText || optionText === "No elements found. Consider changing the search query.") continue;
      console.log(`    ${optionIndex}: ${optionText.slice(0, 60)}`);
    }

    const candidate = box
      .locator(".multiselect__element")
      .filter({ hasText: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });

    const candidateCount = await candidate.count();
    let chosen = -1;
    for (let optionIndex = 0; optionIndex < candidateCount; optionIndex += 1) {
      const optionText = (await candidate.nth(optionIndex).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (optionText.toLowerCase().endsWith(search.toLowerCase())) {
        chosen = optionIndex;
        break;
      }
    }

    if (chosen >= 0) {
      await candidate.nth(chosen).click({ timeout: 8000 });
      await page.waitForTimeout(2000);
      console.log(`  seleccionado (exacto): ${(await box.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 70)}`);
      return true;
    }

    const match = candidate.first();
    if ((await match.count()) > 0) {
      await match.click({ timeout: 8000 });
      await page.waitForTimeout(2000);
      console.log(`  seleccionado (primero): ${(await box.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 70)}`);
      return true;
    }

    console.log("  no encontre una opcion que coincida");
    return false;
  }

  return false;
}

async function capture(page: Page, step: number, stamp: string): Promise<StepShot> {
  const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((button) => (button as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter((label) => label.length > 0),
  );

  await page.screenshot({ path: path.join(OUT_DIR, `ind-${step}-${stamp}.png`), fullPage: true });
  console.log(`\n--- paso ${step} · ${page.url()}`);
  console.log(text.slice(0, 600));
  console.log(`botones: ${buttons.join(" | ")}`);

  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const input = element as HTMLInputElement;
        return `type=${input.type} name=${input.name} id=${input.id} ph="${input.placeholder}" value="${input.value}"`;
      }),
  );
  if (inputs.length) {
    console.log(`inputs visibles (${inputs.length}):`);
    for (const input of inputs.slice(0, 10)) console.log(`  ${input}`);
  }

  return { step, url: page.url(), text: text.slice(0, 1500), buttons };
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const product = process.env.PRODUCT ?? "Caja Paquete S";
  const origin = process.env.ORIGIN ?? "TACNA";
  const destination = process.env.DESTINATION ?? "ZAMACOLA";

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());
  const steps: StepShot[] = [];

  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (type !== "xhr" && type !== "fetch") return;
    if (/google-analytics|googletagmanager|facebook|doubleclick|hotjar|clarity|sentry/i.test(response.url())) return;
    console.log(`  [net] ${response.status()} ${response.request().method()} ${response.url()}`);
  });

  try {
    await page.goto(INDIVIDUAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
    await dismissPopups(page);
    steps.push(await capture(page, 1, stamp));

    console.log(`\nSeleccionando "${product}" en el carrusel ...`);
    const ok = await selectProduct(page, product);
    if (!ok) {
      console.log("  no logre centrar el producto, abortando");
      process.exitCode = 1;
      return;
    }

    await page.getByRole("button", { name: /^continuar$/i }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(3000);
    steps.push(await capture(page, 2, stamp));

    console.log("\nSeleccionando origen ...");
    await pickMultiSelect(page, "Origen", origin);
    steps.push(await capture(page, 3, stamp));

    console.log("\nSeleccionando destino ...");
    await pickMultiSelect(page, "Destino", destination);
    await page.waitForTimeout(2500);
    steps.push(await capture(page, 4, stamp));

    for (let step = 5; step <= 9; step += 1) {
      const buttons = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .filter((button) => {
            const rect = button.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((button) => (button as HTMLElement).innerText.replace(/\s+/g, " ").trim())
          .filter((label) => label.length > 0),
      );

      if (buttons.some((label) => /registrar env|pagar|confirmar env/i.test(label))) {
        console.log("\n[!] Paso final detectado: se detiene sin registrar.");
        steps.push(await capture(page, step, stamp));
        break;
      }

      const continuar = page.getByRole("button", { name: /^continuar$/i }).first();
      if ((await continuar.count()) === 0 || (await continuar.isDisabled().catch(() => true))) {
        console.log("\nContinuar no disponible: hace falta completar datos en este paso.");
        break;
      }

      const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (/clave de seguridad/i.test(text)) {
        const key = process.env.KEY ?? "1234";
        console.log(`\nIngresando clave de seguridad ${key} en el teclado ...`);
        for (const digit of key.split("")) {
          await page.getByRole("button", { name: digit, exact: true }).first().click({ timeout: 6000 }).catch((error) => {
            console.log(`  no pude pulsar ${digit}: ${error instanceof Error ? error.message : error}`);
          });
          await page.waitForTimeout(500);
        }
        await page.waitForTimeout(1200);
        steps.push(await capture(page, step + 200, stamp));
        fs.writeFileSync(path.join(OUT_DIR, `clave-${stamp}.html`), await page.content(), "utf8");

        const continueButton = page.getByRole("button", { name: /^continuar$/i }).first();
        const disabled = await continueButton.isDisabled().catch(() => null);
        const info = await continueButton
          .evaluate((node) => ({
            className: node.className,
            disabled: (node as HTMLButtonElement).disabled,
            outer: node.outerHTML.slice(0, 200),
          }))
          .catch(() => null);
        console.log(`  Continuar disabled=${disabled} ${JSON.stringify(info)}`);

        if (disabled) {
          const keypad = await page.evaluate(() => {
            const container = document.querySelector("[class*='clave'], [class*='keypad'], [class*='pin']");
            return container ? container.outerHTML.slice(0, 1200) : null;
          });
          console.log(`  keypad dom: ${keypad}`);
        }
      }

      const declaration = page.locator("#declaracion_jurada_art");
      if ((await declaration.count()) > 0 && (await declaration.isVisible().catch(() => false))) {
        console.log("  marcando declaración jurada: Artículos de uso personal");
        await page.locator('label[for="declaracion_jurada_art"]').first().click({ timeout: 6000 }).catch(() => undefined);
        await page.waitForTimeout(600);
      }

      await continuar.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(1200);

      const toast = await page
        .locator(".swal2-container.swal2-shown, .toast, .alert")
        .allInnerTexts()
        .catch(() => [] as string[]);
      if (toast.length) {
        console.log(`  aviso: ${toast.map((text) => text.replace(/\s+/g, " ").trim()).join(" | ").slice(0, 300)}`);
      }
      await page.waitForTimeout(3500);
      await dismissPopups(page);
      steps.push(await capture(page, step, stamp));

      const receiver = process.env.RECEIVER;
      if (receiver) {
        const dniInput = page.locator('input[placeholder="DNI"]').first();
        if ((await dniInput.count()) > 0 && (await dniInput.isVisible().catch(() => false))) {
          console.log(`\nLlenando DNI del destinatario (${receiver}) ...`);
          await dniInput.fill(receiver);
          await page.keyboard.press("Tab");
          await page.waitForTimeout(4000);

          const values = await page.evaluate(() =>
            Array.from(document.querySelectorAll("input"))
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              })
              .map((element) => {
                const input = element as HTMLInputElement;
                return `${input.placeholder || input.id || "input"} = "${input.value}"`;
              }),
          );
          console.log("  valores tras el DNI:");
          for (const value of values) console.log(`    ${value}`);
          steps.push(await capture(page, step + 100, stamp));
        }
      }
    }

    await saveJson(`individual-flow-${stamp}.json`, { product, origin, destination, steps });
    fs.writeFileSync(path.join(OUT_DIR, `individual-flow-${stamp}.html`), await page.content(), "utf8");
    console.log(`\nArtefactos: poc/out/individual-flow-${stamp}.*`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
