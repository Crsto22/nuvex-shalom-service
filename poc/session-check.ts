import "dotenv/config";

import path from "node:path";

import {
  BASE_URL,
  ensureDirs,
  launchContext,
  readEnv,
  saveJson,
  saveText,
} from "./lib/browser.js";
import { describeOutcome, readState } from "./lib/detect.js";

/**
 * Reabre el perfil persistente SIN credenciales y verifica si la sesion
 * de Shalom sigue activa. Sirve para medir la duracion real de la sesion.
 */
async function main() {
  const env = readEnv();
  ensureDirs();

  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const context = await launchContext(env);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    const state = await readState(page);
    const cookies = await context.cookies();
    const sessionCookies = cookies.filter((cookie) => /session|remember|shalom|token/i.test(cookie.name));

    console.log("================================================");
    console.log(`Resultado : ${state.outcome} - ${describeOutcome(state)}`);
    console.log(`URL       : ${state.url}`);
    console.log(`Cookies   : ${cookies.length} (sesion: ${sessionCookies.map((c) => c.name).join(", ") || "ninguna"})`);
    console.log("================================================");

    await saveJson(`session-${runStamp}.json`, { state, cookies });
    await saveText(`session-${runStamp}.md`, [
      "# Verificacion de sesion persistente",
      "",
      `- Fecha: ${new Date().toISOString()}`,
      `- Resultado: **${state.outcome}** (${describeOutcome(state)})`,
      `- URL: ${state.url}`,
      `- Cookies: ${cookies.length}`,
      "",
      "## Cookies de sesion",
      "",
      ...(sessionCookies.length
        ? sessionCookies.map((cookie) => {
            const hours = cookie.expires > 0
              ? Math.round((cookie.expires * 1000 - Date.now()) / 3_600_000)
              : null;
            return `- \`${cookie.name}\` -> expira en ${hours === null ? "sesion" : `${hours} h`}`;
          })
        : ["- (ninguna)"]),
      "",
    ].join("\n"));

    if (state.outcome !== "SUCCESS") process.exitCode = 1;
  } finally {
    await page.screenshot({
      path: path.join(process.cwd(), "poc", "out", `session-${runStamp}.png`),
      fullPage: true,
    }).catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
