import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_SCOPES = [
  'shalom:orders:write',
  'shalom:orders:read',
  'shalom:sessions:write',
  'shalom:sessions:read',
  'shalom:tracking:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export type GeneratedApiKey = {
  /** Se muestra una sola vez al administrador. */
  plain: string;
  prefix: string;
  hashedKey: string;
};

/**
 * Genera una API key con prefijo visible. En la base solo se guarda
 * el prefijo y el HMAC-SHA-256 con el pepper del servicio.
 */
export function generateApiKey(
  pepper: string,
  environment: 'sandbox' | 'production',
): GeneratedApiKey {
  const secret = randomBytes(32).toString('base64url');
  const plain = `shm_${environment === 'sandbox' ? 'test' : 'live'}_${secret}`;
  const prefix = plain.slice(0, 18);
  return { plain, prefix, hashedKey: hashApiKey(pepper, plain) };
}

export function hashApiKey(pepper: string, plain: string): string {
  return createHmac('sha256', pepper).update(plain).digest('hex');
}

export function hasScopes(granted: string[], required: string[]): boolean {
  return required.every((scope) => granted.includes(scope));
}

/** Comparacion en tiempo constante para secrets de igual longitud. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Firma de webhooks: `t=<unix>,v1=<hmac-sha256(secret, "t.body")>`.
 * El receptor debe rechazar timestamps viejos (replay) y comparar en tiempo constante.
 */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function verifyWebhook(
  secret: string,
  header: string,
  body: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key?.trim(), value?.trim()];
    }),
  ) as Record<string, string | undefined>;

  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  return safeEqual(signWebhook(secret, timestamp, body), `t=${timestamp},v1=${signature}`);
}
