import fs from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext } from "playwright";

export const BASE_URL = "https://pro.shalom.pe/";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const OUT_DIR = path.join(ROOT, "poc", "out");

export const PROFILE_DIR = path.join(ROOT, ".profile");

export type Env = {
  email: string;
  password: string;
  channel: "chrome" | "chromium";
  headless: boolean;
  checkOnly: boolean;
  loginTimeoutMs: number;
};

function flag(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "si"].includes(raw.trim().toLowerCase());
}

export function readEnv(): Env {
  const channel = (process.env.BROWSER_CHANNEL ?? "chrome").trim().toLowerCase();

  return {
    email: (process.env.SHALOM_EMAIL ?? "").trim(),
    password: process.env.SHALOM_PASSWORD ?? "",
    channel: channel === "chromium" ? "chromium" : "chrome",
    headless: flag("HEADLESS"),
    checkOnly: flag("CHECK_ONLY"),
    loginTimeoutMs: Number(process.env.LOGIN_TIMEOUT_MS ?? 45000),
  };
}

export function ensureDirs() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

const CHROME_DIRS = [
  "C:\\Program Files\\Google\\Chrome\\Application",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application",
  path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application"),
];

/**
 * Shalom responde 403 cuando el User-Agent contiene "HeadlessChrome"
 * (regla del WAF sobre Apache). Detectamos la version real de Chrome
 * instalada y armamos un UA identico al de un navegador normal.
 */
export function resolveUserAgent(): string {
  const fromEnv = process.env.SHALOM_USER_AGENT?.trim();
  if (fromEnv) return fromEnv;

  const versions: number[][] = [];
  for (const dir of CHROME_DIRS) {
    if (!dir) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(entry);
      if (match) versions.push(match.slice(1).map(Number));
    }
  }

  const latest = versions.sort((a, b) => {
    for (let i = 0; i < 4; i += 1) {
      const diff = (b[i] ?? 0) - (a[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  })[0];

  const major = latest?.[0] ?? 157;

  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * Contexto persistente: guarda cookies Y localStorage en .profile/,
 * de modo que la sesion de Shalom sobreviva a reinicios del script.
 */
export async function launchContext(env: Env): Promise<BrowserContext> {
  const userAgent = resolveUserAgent();

  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: env.channel,
    headless: env.headless,
    userAgent,
    locale: "es-PE",
    timezoneId: "America/Lima",
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
    extraHTTPHeaders: {
      "accept-language": "es-PE,es;q=0.9,es-419;q=0.8,en;q=0.7",
    },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
}

export function hasCredentials(env: Env) {
  return env.email.length > 0 && env.password.length > 0;
}

export function credentialsHint() {
  return [
    "Faltan credenciales de Shalom.",
    "",
    "Edita el archivo .env en la raiz de shalom-service y completa:",
    "  SHALOM_EMAIL=...",
    "  SHALOM_PASSWORD=...",
    "",
    "Puedes copiar .env.example como punto de partida.",
  ].join("\n");
}

export async function saveJson(fileName: string, value: unknown) {
  const target = path.join(OUT_DIR, fileName);
  fs.writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
  return target;
}

export async function saveText(fileName: string, value: string) {
  const target = path.join(OUT_DIR, fileName);
  fs.writeFileSync(target, value, "utf8");
  return target;
}
