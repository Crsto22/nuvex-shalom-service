import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import type { Page, Response } from "playwright";

import { OUT_DIR, ensureDirs, launchContext, readEnv, saveJson } from "./lib/browser.js";

const MASIVO_URL = "https://pro.shalom.pe/registromasivo";

type NetworkLog = {
  method: string;
  url: string;
  status: number;
  contentType: string | null;
  bodyPreview: string | null;
};

type SwalInfo = {
  present: boolean;
  kind: "success" | "error" | "warning" | "info" | "question" | "unknown";
  title: string;
  content: string;
  buttons: string[];
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
    await page.waitForTimeout(500);
  }
}

async function waitSwal(page: Page, timeoutMs = 60_000): Promise<SwalInfo | null> {
  const deadline = Date.now() + timeoutMs;
  const container = page.locator(".swal2-container.swal2-shown").first();

  while (Date.now() < deadline) {
    if ((await container.count()) > 0) {
      break;
    }
    await page.waitForTimeout(500);
  }

  if ((await container.count()) === 0) return null;

  return container.evaluate((node) => {
    const kinds = ["success", "error", "warning", "info", "question"] as const;
    const titleEl = node.querySelector(".swal2-title");
    const contentEl = node.querySelector("#swal2-content");

    let kind: "success" | "error" | "warning" | "info" | "question" | "unknown" = "unknown";
    for (const candidate of kinds) {
      const icon = node.querySelector(`.swal2-icon.swal2-${candidate}`);
      if (icon && window.getComputedStyle(icon).display !== "none") {
        kind = candidate;
        break;
      }
    }

    const buttons = Array.from(node.querySelectorAll("button"))
      .filter((button) => (button.className || "").includes("swal2-"))
      .map((button) => (button as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    return {
      present: true,
      kind,
      title: (titleEl as HTMLElement | null)?.innerText.trim() ?? "",
      content: (contentEl as HTMLElement | null)?.innerText.trim() ?? "",
      buttons,
    };
  });
}

async function readTables(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("table")).map((table) => ({
      headers: Array.from(table.querySelectorAll("thead th")).map((th) =>
        (th as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      ),
      rows: Array.from(table.querySelectorAll("tbody tr")).slice(0, 10).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) =>
          (td as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        ),
      ),
      totalRows: table.querySelectorAll("tbody tr").length,
    })),
  );
}

async function readVisibleButtons(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a.btn"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => (element as HTMLElement).innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
}

async function main() {
  const env = readEnv();
  ensureDirs();

  const filePath = path.resolve(
    argValue("--file") ?? path.join(OUT_DIR, "plantilla-shalom.xlsx"),
  );
  const advance = process.argv.includes("--advance");

  if (!fs.existsSync(filePath)) {
    console.error(`No existe el archivo: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const network: NetworkLog[] = [];

  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  page.on("response", (response: Response) => {
    const type = response.request().resourceType();
    if (type !== "xhr" && type !== "fetch") return;
    if (/google-analytics|googletagmanager|facebook|doubleclick|hotjar|clarity|sentry/i.test(response.url())) return;
    if (network.length >= 40) return;

    void (async () => {
      const contentType = await response.headerValue("content-type").catch(() => null);
      let bodyPreview: string | null = null;
      try {
        bodyPreview = (await response.text()).slice(0, 400);
      } catch {
        bodyPreview = null;
      }
      network.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        contentType,
        bodyPreview,
      });
    })();
  });

  try {
    await page.goto(MASIVO_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    if (!page.url().includes("registromasivo")) {
      console.error(`Sesion no valida (redirigido a ${page.url()}). Ejecuta "npm run login".`);
      process.exitCode = 1;
      return;
    }

    await dismissPopups(page);

    console.log(`Subiendo: ${path.relative(process.cwd(), filePath)}`);
    await page.locator("input[type='file']").first().setInputFiles(filePath, { timeout: 30_000 });

    const swal = await waitSwal(page, 90_000);
    if (!swal) {
      console.log("No aparecio ningun modal de resultado en 90s.");
    } else {
      console.log(`\nModal [${swal.kind}] ${swal.title}`);
      console.log(`  ${swal.content}`);
      console.log(`  Botones: ${swal.buttons.join(" | ") || "(ninguno)"}`);
    }

    let nextScreen: {
      url: string;
      tables: Awaited<ReturnType<typeof readTables>>;
      buttons: string[];
      texts: string[];
      body: string;
    } | null = null;

    const swals: SwalInfo[] = swal ? [swal] : [];

    if (advance && swal?.kind !== "error") {
      const maxSteps = process.argv.includes("--deep") ? 5 : 2;

      for (let step = 0; step < maxSteps; step += 1) {
        const openModal = await waitSwal(page, 3000);
        if (openModal) {
          swals.push(openModal);
          console.log(`\nModal ${swals.length}: ${openModal.title} — ${openModal.content}`);
          console.log(`  Botones: ${openModal.buttons.join(" | ")}`);
          await page
            .locator(".swal2-container.swal2-shown .swal2-confirm")
            .first()
            .click({ timeout: 10_000 })
            .catch(() => undefined);
          await page.waitForTimeout(4000);
          continue;
        }

        const continuar = page.getByRole("button", { name: /^continuar$/i }).first();
        const blocked = await page
          .getByRole("button", { name: /confirmar|registrar|finalizar|pagar/i })
          .count();

        if (blocked > 0) {
          console.log("\n[!] Aparecio un boton de confirmacion final: se detiene aqui sin pulsarlo.");
          break;
        }

        if ((await continuar.count()) === 0) break;

        console.log(`Paso ${step + 1}: click en Continuar de la pagina ...`);
        await continuar.click({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(5000);
      }

      const body = await page.locator("body").innerText().catch(() => "");
      nextScreen = {
        url: page.url(),
        tables: await readTables(page),
        buttons: await readVisibleButtons(page),
        texts: await page
          .locator(".alert, [role='alert'], .invalid-feedback, .text-danger")
          .allInnerTexts()
          .catch(() => [] as string[]),
        body: body.replace(/\s+/g, " ").slice(0, 4000),
      };

      console.log(`\nURL      : ${nextScreen.url}`);
      console.log(`Botones  : ${nextScreen.buttons.join(" | ") || "(ninguno)"}`);
      for (const table of nextScreen.tables) {
        console.log(`  headers: ${table.headers.join(" | ") || "(vacio)"} · filas=${table.totalRows}`);
        for (const row of table.rows.slice(0, 5)) console.log(`    - ${row.join(" | ")}`);
      }
      console.log(`\nTexto:\n${nextScreen.body.slice(0, 1400)}`);

      if (nextScreen.buttons.some((button) => /confirmar|registrar/i.test(button))) {
        console.log("\n[!] Hay un boton de confirmacion final: NO se pulsa.");
      }
    }

    await page.screenshot({ path: path.join(OUT_DIR, `upload-${runStamp}.png`), fullPage: true });
    fs.writeFileSync(path.join(OUT_DIR, `upload-${runStamp}.html`), await page.content(), "utf8");
    await saveJson(`upload-${runStamp}.json`, {
      file: filePath,
      swals,
      nextScreen,
      network,
      finalUrl: page.url(),
    });

    console.log(`\nArtefactos: poc/out/upload-${runStamp}.*`);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
