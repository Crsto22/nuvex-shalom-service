import "dotenv/config";

import { chromium } from "playwright";

const URL_TARGET = "https://pro.shalom.pe/";
const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

async function probeBrowser(label: string, options: Parameters<typeof chromium.launch>[0]) {
  const browser = await chromium.launch(options);
  try {
    const context = await browser.newContext({
      locale: "es-PE",
      timezoneId: "America/Lima",
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    const response = await page.goto(URL_TARGET, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const title = await page.title().catch(() => "");
    const body = await page.locator("body").innerText().catch(() => "");
    const headers: Record<string, string> = response
      ? await response.allHeaders().catch(() => ({}))
      : {};

    console.log(`\n[${label}] status=${response?.status() ?? "-"} title="${title}"`);
    console.log(`  server=${headers["server"] ?? "-"} cf=${headers["cf-ray"] ?? "-"} x-powered=${headers["x-powered-by"] ?? "-"}`);
    console.log(`  body: ${body.replace(/\s+/g, " ").slice(0, 160)}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function probeFetch() {
  const response = await fetch(URL_TARGET, {
    headers: {
      "user-agent": UA_CHROME,
      "accept-language": "es-PE,es;q=0.9,es-419;q=0.8,en;q=0.7",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  const text = await response.text();
  console.log(`\n[fetch node] status=${response.status} bytes=${text.length}`);
  console.log(`  body: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
}

async function main() {
  await probeFetch();

  await probeBrowser("chrome headless (default)", {
    channel: "chrome",
    headless: true,
  }).catch((error) => console.log("  fallo:", error.message));

  await probeBrowser("chrome headless + UA custom", {
    channel: "chrome",
    headless: true,
    args: [`--user-agent=${UA_CHROME}`],
  }).catch((error) => console.log("  fallo:", error.message));

  await probeBrowser("chrome headless + flags anti-deteccion", {
    channel: "chrome",
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", `--user-agent=${UA_CHROME}`],
  }).catch((error) => console.log("  fallo:", error.message));

  await probeBrowser("chrome HEADFUL", {
    channel: "chrome",
    headless: false,
  }).catch((error) => console.log("  fallo:", error.message));

  await probeBrowser("chromium bundled headless", {
    headless: true,
  }).catch((error) => console.log("  fallo (falta instalar chromium?):", error.message));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
