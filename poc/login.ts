import "dotenv/config";

import path from "node:path";

import type { BrowserContext, Page } from "playwright";

import {
  BASE_URL,
  OUT_DIR,
  credentialsHint,
  ensureDirs,
  hasCredentials,
  launchContext,
  readEnv,
  saveJson,
  saveText,
  type Env,
} from "./lib/browser.js";
import {
  describeOutcome,
  isTerminal,
  readState,
  type LoginOutcome,
  type PageState,
} from "./lib/detect.js";

const CONSOLE_LIMIT = 60;

type RunResult = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  mode: "check" | "login";
  email: string | null;
  passwordProvided: boolean;
  channel: Env["channel"];
  headless: boolean;
  baseUrl: string;
  before: PageState | null;
  after: PageState | null;
  outcome: LoginOutcome | "NO_CREDENTIALS";
  message: string | null;
  cookies: { total: number; names: string[]; maxExpiresInHours: number | null };
  consoleErrors: string[];
  files: string[];
};

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function maskEmail(email: string) {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

function collectConsole(page: Page, bucket: string[]) {
  page.on("console", (msg) => {
    if (msg.type() === "error" && bucket.length < CONSOLE_LIMIT) {
      bucket.push(msg.text().slice(0, 500));
    }
  });
  page.on("pageerror", (error) => {
    if (bucket.length < CONSOLE_LIMIT) bucket.push(`pageerror: ${error.message}`.slice(0, 500));
  });
}

async function waitForOutcome(page: Page, timeoutMs: number): Promise<PageState> {
  const deadline = Date.now() + timeoutMs;
  let last = await readState(page);

  while (Date.now() < deadline) {
    if (isTerminal(last.outcome)) return last;
    if (last.message) return last;
    await page.waitForTimeout(750);
    last = await readState(page);
  }

  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  return readState(page);
}

async function login(page: Page, env: Env): Promise<PageState> {
  await page.locator("input[name='email']").fill(env.email);
  await page.locator("input[name='password']").fill(env.password);

  if (await page.locator("#remember").count()) {
    await page.locator("#remember").check().catch(() => undefined);
  }

  await page.locator("#formLogin button[type='submit']").click();

  return waitForOutcome(page, env.loginTimeoutMs);
}

async function cookieSummary(context: BrowserContext) {
  const cookies = await context.cookies();
  const expires = cookies
    .map((cookie) => cookie.expires)
    .filter((value) => typeof value === "number" && value > 0);

  const maxExpiresInHours = expires.length
    ? Math.round((Math.max(...expires) * 1000 - Date.now()) / 3_600_000)
    : null;

  return {
    total: cookies.length,
    names: cookies.map((cookie) => cookie.name).slice(0, 40),
    maxExpiresInHours,
  };
}

function buildReport(result: RunResult) {
  const after = result.after;
  const lines = [
    "# Fase 0.1 - Verificacion de login Shalom PRO",
    "",
    `- Fecha: ${result.startedAt}`,
    `- Modo: ${result.mode === "check" ? "solo verificacion (no envia formulario)" : "login real"}`,
    `- Cuenta: ${result.email ?? "(sin correo)"}`,
    `- Navegador: ${result.channel} · headless=${result.headless}`,
    `- Duracion: ${(result.durationMs / 1000).toFixed(1)} s`,
    "",
    "## Resultado",
    "",
    `**${result.outcome}** - ${result.message ?? "sin mensaje de error"}`,
    "",
  ];

  if (after) {
    lines.push(
      "| Dato | Valor |",
      "| --- | --- |",
      `| URL final | ${after.url} |`,
      `| HTTP | ${after.httpStatus ?? "-"} |`,
      `| Titulo | ${after.title} |`,
      `| Autenticado | ${after.authenticated} |`,
      `| Formulario de login presente | ${after.hasLoginForm} |`,
      `| reCAPTCHA cargado | ${after.recaptchaLoaded} |`,
      `| Campo recaptcha_token | ${after.hasRecaptchaField} |`,
      `| Checkbox "Recuerdame" | ${after.rememberCheckbox} |`,
      `| Cookies | ${result.cookies.total} (expiracion max ${result.cookies.maxExpiresInHours ?? "-"} h) |`,
      "",
    );

    if (after.signals.length) {
      lines.push("## Senales detectadas", "");
      for (const signal of after.signals) lines.push(`- ${signal}`);
      lines.push("");
    }
  }

  if (result.consoleErrors.length) {
    lines.push("## Errores de consola", "");
    for (const error of result.consoleErrors.slice(0, 15)) lines.push(`- \`${error}\``);
    lines.push("");
  }

  lines.push("## Archivos generados", "");
  for (const file of result.files) lines.push(`- ${path.relative(process.cwd(), file)}`);
  lines.push("");

  if (result.outcome === "SUCCESS") {
    lines.push(
      "## Siguiente paso",
      "",
      "La sesion quedo guardada en `.profile/`. Ejecuta `npm run session` para confirmar",
      "que sigue activa al reabrir el navegador, y luego seguimos con la carga del Excel.",
      "",
    );
  } else if (result.outcome === "CAPTCHA") {
    lines.push(
      "## Conclusion",
      "",
      "reCAPTCHA / anti-bot rechazo el login automatizado. El diseno debe pasar a",
      "login asistido: una persona resuelve el acceso y el servicio reutiliza las cookies.",
      "",
    );
  }

  return lines.join("\n");
}

async function main() {
  const env = readEnv();
  const checkArg = process.argv.includes("--check");
  const checkOnly = env.checkOnly || checkArg;

  ensureDirs();

  const startedAt = new Date();
  const consoleErrors: string[] = [];
  const files: string[] = [];
  const runStamp = stamp();

  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());
  collectConsole(page, consoleErrors);

  const tracePath = path.join(OUT_DIR, `trace-${runStamp}.zip`);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

  let before: PageState | null = null;
  let after: PageState | null = null;
  let outcome: RunResult["outcome"] = "UNKNOWN";
  let message: string | null = null;
  let note = "";

  try {
    console.log(`Abriendo ${BASE_URL} ...`);
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const httpStatus = response?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    before = await readState(page, httpStatus);

    if (before.outcome === "SUCCESS") {
      after = before;
      outcome = "SUCCESS";
      message = "La sesion ya estaba iniciada (perfil persistente).";
      note = "Sesion reutilizada del perfil .profile/";
    } else if (before.outcome === "HTTP_ERROR" || before.outcome === "BLOCKED") {
      after = before;
      outcome = before.outcome;
      message = before.message ?? `La pagina principal respondio ${httpStatus}`;
    } else if (checkOnly) {
      after = before;
      outcome = before.outcome;
      message = "Modo verificacion: no se envio el formulario.";
    } else if (!hasCredentials(env)) {
      after = before;
      outcome = "NO_CREDENTIALS";
      message = credentialsHint();
      console.error(credentialsHint());
    } else {
      console.log(`Iniciando sesion como ${maskEmail(env.email)} ...`);
      after = await login(page, env);
      outcome = after.outcome;
      message = after.message;
    }

    if (outcome === "SUCCESS") {
      const stateFile = path.join(OUT_DIR, "storage-state.json");
      await context.storageState({ path: stateFile });
      files.push(stateFile);
    }
  } catch (error) {
    outcome = "UNKNOWN";
    message = error instanceof Error ? error.message : String(error);
    console.error("Error durante la ejecucion:", message);
    after = await readState(page).catch(() => null);
  } finally {
    const screenshotPath = path.join(OUT_DIR, `login-${runStamp}.png`);
    await page
      .screenshot({ path: screenshotPath, fullPage: true })
      .then(() => files.push(screenshotPath))
      .catch(() => undefined);

    const html = await page.content().catch(() => "");
    await saveText(`login-${runStamp}.html`, html)
      .then((file) => files.push(file))
      .catch(() => undefined);

    await context.tracing.stop({ path: tracePath }).catch(() => undefined);
    files.push(tracePath);

    const cookies = await cookieSummary(context).catch(() => ({
      total: 0,
      names: [],
      maxExpiresInHours: null,
    }));

    const finishedAt = new Date();
    const result: RunResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      mode: checkOnly ? "check" : "login",
      email: maskEmail(env.email),
      passwordProvided: env.password.length > 0,
      channel: env.channel,
      headless: env.headless,
      baseUrl: BASE_URL,
      before,
      after,
      outcome,
      message: outcome === "NO_CREDENTIALS" ? "faltan credenciales en .env" : message,
      cookies,
      consoleErrors,
      files,
    };

    files.push(await saveJson(`report-${runStamp}.json`, result));
    files.push(await saveText(`report-${runStamp}.md`, buildReport(result)));

    console.log("");
    console.log("================================================");
    console.log(`Resultado : ${outcome} ${after ? `- ${describeOutcome(after)}` : ""}`);
    console.log(`URL final : ${after?.url ?? "-"}`);
    console.log(`Cookies   : ${cookies.total} (expira en ~${cookies.maxExpiresInHours ?? "-"} h)`);
    if (message && outcome !== "SUCCESS") console.log(`Detalle   : ${message}`);
    if (note) console.log(`Nota      : ${note}`);
    console.log("Artefactos:");
    for (const file of files) console.log(`  - ${path.relative(process.cwd(), file)}`);
    console.log("================================================");

    await context.close().catch(() => undefined);
  }

  const ok =
    outcome === "SUCCESS" ||
    (checkOnly && (outcome === "NOT_LOGGED_IN" || outcome === "UNKNOWN"));

  if (outcome === "NO_CREDENTIALS") process.exitCode = 2;
  else if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
