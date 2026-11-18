import type { Page } from "playwright";

export type LoginOutcome =
  | "SUCCESS"
  | "NOT_LOGGED_IN"
  | "CAPTCHA"
  | "BAD_CREDENTIALS"
  | "NEEDS_CODE"
  | "BLOCKED"
  | "HTTP_ERROR"
  | "UNKNOWN";

export type PageState = {
  url: string;
  title: string;
  httpStatus: number | null;
  authenticated: boolean;
  hasLoginForm: boolean;
  recaptchaLoaded: boolean;
  hasRecaptchaField: boolean;
  rememberCheckbox: boolean;
  outcome: LoginOutcome;
  message: string | null;
  signals: string[];
};

const ERROR_SELECTORS = [
  ".alert-danger",
  ".alert.alert-danger",
  ".invalid-feedback",
  ".swal2-html-container",
  ".swal2-title",
  "[role='alert']",
  ".text-danger",
];

const CAPTCHA_WORDS = [
  "captcha",
  "recaptcha",
  "no soy un robot",
  "verifica que eres humano",
  "actividad sospechosa",
];

const CREDENTIAL_WORDS = [
  "credenciales",
  "incorrect",
  "invalido",
  "no coinciden",
  "usuario o contrasena",
  "correo o contrasena",
];

const CODE_WORDS = [
  "codigo de verificacion",
  "ingresa el codigo",
  "codigo enviado",
  "verificacion en dos pasos",
  "two-factor",
];

const BLOCKED_WORDS = [
  "bloqueada",
  "bloqueado",
  "suspendida",
  "suspendido",
  "demasiados intentos",
  "intentos permitidos",
  "forbidden",
  "access denied",
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(normalize(needle)));
}

export async function readState(page: Page, httpStatus: number | null = null): Promise<PageState> {
  const url = page.url();
  const title = await page.title().catch(() => "");

  const authenticated = await page
    .evaluate(() => Boolean((window as { IS_AUTHENTICATED?: boolean }).IS_AUTHENTICATED))
    .catch(() => false);

  const hasLoginForm = (await page.locator("#formLogin").count().catch(() => 0)) > 0;

  const recaptchaLoaded = await page
    .evaluate(() => typeof (window as { grecaptcha?: unknown }).grecaptcha !== "undefined")
    .catch(() => false);

  const hasRecaptchaField = (await page.locator("#recaptcha_token").count().catch(() => 0)) > 0;
  const rememberCheckbox = (await page.locator("#remember").count().catch(() => 0)) > 0;

  const errorTexts: string[] = [];
  for (const selector of ERROR_SELECTORS) {
    const texts = await page
      .locator(selector)
      .allInnerTexts()
      .catch(() => [] as string[]);
    for (const text of texts) {
      const clean = text.replace(/\s+/g, " ").trim();
      if (clean && clean.length < 300) errorTexts.push(clean);
    }
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const normalizedErrors = normalize(errorTexts.join(" | "));
  const normalizedBody = normalize(bodyText.slice(0, 4000));

  const loginScreen =
    hasLoginForm ||
    /iniciar sesion/.test(normalizedBody) ||
    /ingresa tus datos para registrar/.test(normalizedBody);

  const signals: string[] = [];
  let outcome: LoginOutcome = "UNKNOWN";

  if (httpStatus !== null && httpStatus >= 400) {
    outcome = "HTTP_ERROR";
    signals.push(`respuesta HTTP ${httpStatus}`);
  } else if (authenticated) {
    outcome = "SUCCESS";
    signals.push("window.IS_AUTHENTICATED = true");
  } else if (includesAny(normalizedErrors, CAPTCHA_WORDS)) {
    outcome = "CAPTCHA";
    signals.push("mensaje de captcha en el DOM");
  } else if (includesAny(normalizedErrors, BLOCKED_WORDS)) {
    outcome = "BLOCKED";
    signals.push("mensaje de bloqueo en el DOM");
  } else if (includesAny(normalizedErrors, CODE_WORDS)) {
    outcome = "NEEDS_CODE";
    signals.push("pide codigo de verificacion");
  } else if (includesAny(normalizedErrors, CREDENTIAL_WORDS)) {
    outcome = "BAD_CREDENTIALS";
    signals.push("mensaje de credenciales invalidas");
  } else if (includesAny(normalizedBody, BLOCKED_WORDS) && bodyText.length < 500) {
    outcome = "BLOCKED";
    signals.push("pagina de bloqueo");
  } else if (loginScreen) {
    outcome = "NOT_LOGGED_IN";
    signals.push("formulario de login disponible");
  } else if (/two-factor|verificacion|verification/i.test(url)) {
    outcome = "NEEDS_CODE";
    signals.push(`url de verificacion: ${url}`);
  } else if (!hasLoginForm && new URL(url).pathname !== "/") {
    outcome = "SUCCESS";
    signals.push(`navegacion fuera del login: ${url}`);
  }

  if (recaptchaLoaded) signals.push("grecaptcha disponible en window");
  if (hasRecaptchaField) signals.push("input recaptcha_token presente (reCAPTCHA v3 invisible)");

  return {
    url,
    title,
    httpStatus,
    authenticated,
    hasLoginForm,
    recaptchaLoaded,
    hasRecaptchaField,
    rememberCheckbox,
    outcome,
    message: errorTexts[0] ?? null,
    signals,
  };
}

export function isTerminal(outcome: LoginOutcome) {
  return ["SUCCESS", "CAPTCHA", "BAD_CREDENTIALS", "NEEDS_CODE", "BLOCKED", "HTTP_ERROR"].includes(
    outcome,
  );
}

export function describeOutcome(state: PageState) {
  switch (state.outcome) {
    case "SUCCESS":
      return "Sesion iniciada";
    case "NOT_LOGGED_IN":
      return "Sin sesion: formulario de login disponible";
    case "CAPTCHA":
      return "Login rechazado por captcha / anti-bot";
    case "BAD_CREDENTIALS":
      return "Credenciales rechazadas";
    case "NEEDS_CODE":
      return "Pide codigo de verificacion (2FA)";
    case "BLOCKED":
      return "Bloqueado por el servidor";
    case "HTTP_ERROR":
      return `Error HTTP ${state.httpStatus ?? ""}`.trim();
    default:
      return "Resultado indeterminado";
  }
}
