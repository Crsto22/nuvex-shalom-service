import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const INDIVIDUAL_URL = "https://pro.shalom.pe/registroindividual";

type Control = {
  tag: string;
  type: string | null;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  label: string | null;
  value: string;
  disabled: boolean;
  visible: boolean;
  options?: string[];
};

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function dismissPopups(page: Page) {
  const close = page.locator(".loyalty-popup .popup-close, .loyalty-popup-overlay button.popup-close").first();
  if ((await close.count()) > 0) {
    await close.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
}

async function dumpControls(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll("input, select, textarea, button, [role='combobox']"),
    );

    return nodes.map((node) => {
      const element = node as HTMLElement;
      const input = element as HTMLInputElement;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      let label: string | null = null;
      if (input.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (explicit) label = (explicit as HTMLElement).innerText.trim();
      }
      if (!label) {
        const parentLabel = element.closest("label");
        if (parentLabel) label = (parentLabel as HTMLElement).innerText.trim();
      }
      if (!label) {
        const container = element.closest(".form-group, .input-group, .field, .form-input, div");
        const candidate = container?.querySelector("label, .label, .control-label");
        if (candidate) label = (candidate as HTMLElement).innerText.trim();
      }

      const options =
        element.tagName.toLowerCase() === "select"
          ? Array.from((element as HTMLSelectElement).options).map((option) =>
              `${option.value}|${option.text.trim()}`,
            )
          : undefined;

      return {
        tag: element.tagName.toLowerCase(),
        type: input.type ?? null,
        name: input.name ?? null,
        id: element.id || null,
        placeholder: input.placeholder ?? null,
        label: label ? label.replace(/\s+/g, " ").slice(0, 60) : null,
        value: String(input.value ?? "").slice(0, 40),
        disabled: Boolean(input.disabled),
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        options,
      };
    });
  });
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const dni = argValue("--dni");
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(INDIVIDUAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    console.log(`URL: ${page.url()}`);
    await dismissPopups(page);
    await page.waitForTimeout(1000);

    const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    console.log(`\nTexto inicial:\n${text.slice(0, 900)}`);

    let controls = await dumpControls(page);
    console.log("\n== Controles (visibles) ==");
    for (const control of controls.filter((item) => item.visible)) {
      const parts = [
        control.tag,
        control.type ? `type=${control.type}` : null,
        control.name ? `name=${control.name}` : null,
        control.id ? `id=${control.id}` : null,
        control.placeholder ? `ph="${control.placeholder}"` : null,
        control.label ? `label="${control.label}"` : null,
        control.value ? `value="${control.value}"` : null,
      ].filter(Boolean);
      console.log(`  ${parts.join(" ")}`);
      if (control.options?.length) {
        console.log(`      opciones(${control.options.length}): ${control.options.slice(0, 12).join(" · ")}`);
      }
    }

    if (dni) {
      console.log(`\nProbando autocompletado con DNI ${dni} ...`);
      const docInput = page
        .locator("input[placeholder*='documento' i], input[placeholder*='DNI' i], input[name*='documento' i], input[name*='dni' i]")
        .first();

      if ((await docInput.count()) > 0) {
        await docInput.fill(dni);
        await page.keyboard.press("Tab");
        await page.waitForTimeout(4000);

        const afterText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
        const afterControls = await dumpControls(page);

        console.log(`\nTexto tras ingresar DNI:\n${afterText.slice(0, 900)}`);

        console.log("\n== Campos con valor tras el DNI ==");
        for (const control of afterControls.filter((item) => item.visible && item.value)) {
          console.log(`  ${control.tag} ${control.name ?? control.id ?? ""} = "${control.value}" (label=${control.label ?? "-"})`);
        }

        await saveJson(`individual-dni-${runStamp}.json`, { dni, controls: afterControls, text: afterText });
      } else {
        console.log("  no encontre el input de documento");
      }
    }

    controls = await dumpControls(page);
    await page.screenshot({ path: path.join(OUT_DIR, `individual-${runStamp}.png`), fullPage: true });
    fs.writeFileSync(path.join(OUT_DIR, `individual-${runStamp}.html`), await page.content(), "utf8");
    await saveJson(`individual-${runStamp}.json`, { url: page.url(), controls, text });
    console.log(`\nArtefactos: poc/out/individual-${runStamp}.*`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
