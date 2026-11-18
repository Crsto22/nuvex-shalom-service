# Seguridad v1 — shalom-service

## Variables obligatorias

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | base de datos propia (`nuvex_shalom`) |
| `SECRETS_ENCRYPTION_KEY` | 32 bytes base64; cifra contraseñas y storage state (AES-256-GCM) |
| `API_KEY_PEPPER` | ≥32 caracteres; HMAC-SHA-256 de las API keys |
| `ADMIN_TOKEN` | token de administración; **debe** definirse en producción |

`SECRETS_ENCRYPTION_KEY` y `API_KEY_PEPPER` deben ser distintos por ambiente y vivir fuera del
repositorio (gestor de secretos o variables del orquestador).

## Cifrado

Formato: `v1.<iv>.<tag>.<ciphertext>` (base64url).

El contexto (AAD) identifica tenant y propósito:

- `tenant:<id>:shalom-password`
- `tenant:<id>:shalom-session`

Descifrar con otro contexto falla: el ciphertext de una empresa no sirve para otra.

## API keys

- Se muestra la key completa **una sola vez**; en BD solo quedan `prefix` y `hashed_key`.
- Scopes: `shalom:orders:write`, `shalom:orders:read`, `shalom:sessions:write`,
  `shalom:sessions:read`, `shalom:tracking:read`.
- Revocación inmediata (`revokedAt`) y expiración opcional.
- Rate limit por aplicación (`RATE_LIMIT_PER_MINUTE`, por réplica).

## Controles HTTP

- Helmet y eliminación de `X-Powered-By`.
- CORS cerrado por lista (`CORS_ORIGINS`); vacío solo para desarrollo.
- `X-Request-Id` validado o generado en cada request.
- `trust proxy` configurable (`TRUST_PROXY_HOPS`) detrás de nginx/traefik.
- Validación global con `whitelist` y rechazo de propiedades desconocidas.
- Errores del driver mapeados: `422` / `503` / `409` (sin stack traces).

## Aislamiento multiempresa

- Cada request resuelve `tenantId` y `applicationId` desde la API key.
- Toda consulta filtra por tenant; una key no puede leer otra empresa.
- Credenciales y sesión son por tenant; nunca se comparten.

## Webhooks

- Firma `X-Shalom-Signature: t=<unix>,v1=<hmac_sha256(secret, "t.body")>`.
- Tolerancia de 5 minutos contra replay.
- Reintentos con backoff y estado `DEAD` tras 5 intentos.

## Pendientes de seguridad (roadmap)

1. Rotación automática de API keys y política de expiración.
2. Auditoría de cambios (creación/revocación de keys, credenciales).
3. Cifrado por tenant con KMS (hoy una llave maestra con contexto por tenant).
4. Lista de IPs permitidas por aplicación.
