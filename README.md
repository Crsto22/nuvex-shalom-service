# shalom-service

Microservicio multiempresa y multiaplicación para registrar envíos y consultar estados en
**Shalom PRO**, siguiendo el patrón de `nuvex-billing-service` (NestJS + cola durable en PostgreSQL).

> Estado: **Fase 5 completada** (auth por API key con scopes, rate limit por app, webhooks firmados
> y métricas). Falta la prueba HTTP end-to-end (requiere Postgres con Docker).
> Plan completo en `docs/plan-implementacion.md`.

## Decisiones de arquitectura

| Tema | Decisión |
| --- | --- |
| Stack | Node 24 + TypeScript + NestJS 11 (`apps/api` + `apps/worker`) |
| Automatización | Playwright con Chrome real (el WAF de Shalom bloquea UA `HeadlessChrome`) |
| Cola | Durable en PostgreSQL con `FOR UPDATE SKIP LOCKED` (sin Redis) |
| Base de datos | Propia: `nuvex_shalom` |
| Multi-app | `Tenant` + `Application` + `ApiKey` (Bearer + scopes) |
| Concurrencia | 1 job activo por tenant (una sola cuenta Shalom por empresa) |
| Alcance v1 | Registro **individual** de envíos |
| Rótulos / S3 | Fuera del alcance (manual) |
| Diagnóstico | Sin capturas ni artefactos |

## Estructura

```
apps/api/          API HTTP (puerto 4100)
  src/modules/     health · sessions (v1) · orders · tracking (Fase 3-4)
apps/worker/       Procesador de la cola
  src/job-queue.repository.ts   claim atomico, leases, backoff, DEAD
  src/worker.service.ts         loop de procesamiento
libs/config/       Validacion de entorno (class-validator)
libs/database/     PrismaService
libs/security/     AES-256-GCM (v1.<iv>.<tag>.<ct>) + API keys HMAC
libs/shalom/       BrowserPool + PlaywrightShalomDriver + selectores centralizados
prisma/            Schema + migracion inicial (10 tablas)
poc/               POC validado contra Shalom real (login, masivo, individual, tracking)
scripts/           create-tenant · smoke-driver
docs/              Plan de implementacion
```

## Endpoints (v1)

| Método | Ruta | Scope | Descripción |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | — | salud + métricas (jobs, órdenes, sesiones) |
| `POST` | `/v1/sessions/:tenantId/login` | `shalom:sessions:write` | login en Shalom y storage state cifrado |
| `GET` | `/v1/sessions/:tenantId` | `shalom:sessions:read` | estado de la sesión |
| `POST` | `/v1/tenants/:tenantId/orders` | `shalom:orders:write` | encola 1 envío (registro individual) |
| `POST` | `/v1/tenants/:tenantId/orders?wait=true` | `shalom:orders:write` | igual, pero **espera y devuelve orden + código** |
| `GET` | `/v1/jobs/:jobId` | `shalom:orders:read` | estado del job + resultado |
| `GET` | `/v1/orders/:orderId` | `shalom:orders:read` | orden registrada |
| `GET` | `/v1/orders/:orderId/tracking` | `shalom:tracking:read` | estado guardado + historial |
| `POST` | `/v1/orders/:orderId/track` | `shalom:tracking:read` | encola rastreo puntual |
| `GET` | `/v1/tracking?orden=&codigo=` | `shalom:tracking:read` | consulta en vivo (10-20 s) |

Administración (solo `X-Admin-Token`):

| Método | Ruta |
| --- | --- |
| `POST` | `/v1/admin/applications/:applicationId/api-keys` | crea API key (se muestra una vez) |
| `GET` | `/v1/admin/applications/:applicationId/api-keys` | lista prefijos y estado |
| `DELETE` | `/v1/admin/api-keys/:apiKeyId` | revoca |
| `POST` | `/v1/admin/tenants` | **alta completa**: empresa + aplicación + API key (+ credenciales) |
| `PUT` | `/v1/admin/tenants/:tenantId/credentials` | guarda credenciales (`?validate=true` prueba el login) |
| `POST` | `/v1/admin/tenants/:tenantId/validate-credentials` | prueba el login y devuelve el resultado |
| `GET` | `/v1/admin/sessions` | estado de sesión por empresa |
| `GET` | `/v1/admin/audit?tenantId=&limit=` | historial de cambios administrativos |
| `POST` | `/v1/admin/applications/:applicationId/webhooks` | registra endpoint (secreto de firma una vez) |
| `GET` | `/v1/admin/applications/:applicationId/webhooks` | lista endpoints y últimas entregas |

### Autenticación

```http
Authorization: Bearer shm_live_xxxxxxxxx
```

- La key se guarda como **HMAC-SHA-256 con `API_KEY_PEPPER`**; el valor completo se muestra una vez.
- Resuelve tenant + aplicación + scopes; una key **nunca** puede operar sobre otro tenant.
- Rate limit por aplicación (`RATE_LIMIT_PER_MINUTE`, por réplica).
- El `X-Admin-Token` queda solo para administración.

### Ejemplo (registrar un envío)

```bash
# 1. login del tenant (guarda la sesión cifrada)
curl -X POST http://localhost:4100/v1/sessions/$TENANT_ID/login \
  -H "X-Admin-Token: $ADMIN_TOKEN"

# 2. encolar el envío
curl -X POST http://localhost:4100/v1/tenants/$TENANT_ID/orders \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "externalRef": "venta-9f2c",
    "recipientDocument": "42309872",
    "originAgency": "AV TACNA",
    "destinationAgency": "ZAMACOLA",
    "packageType": "PAQUETE S",
    "securityKey": "9872",
    "idempotencyKey": "venta-9f2c-v1"
  }'
# → { "jobId": "...", "status": "PENDING" }

# 3. consultar el resultado
curl http://localhost:4100/v1/jobs/$JOB_ID -H "X-Admin-Token: $ADMIN_TOKEN"
# → { "status": "COMPLETED", "result": { "orden": "104168762", "codigo": "739D", "monto": 12 } }
```

## Webhooks

Se registran desde administración y se firman con HMAC:

```http
POST https://app-cliente.pe/hooks/shalom
X-Shalom-Signature: t=1731850000,v1=<hmac_sha256(secret, "t.body")>
X-Shalom-Event: order.registered
X-Shalom-Delivery: <uuid>

{"event":"order.registered","deliveryId":"...","data":{...},"createdAt":"..."}
```

| Evento | Cuándo |
| --- | --- |
| `order.registered` | la guía se registró en Shalom |
| `order.status_changed` | el rastreo detectó un cambio de estado |

- Firma con `t` (timestamp) para permitir rechazo de replays (tolerancia 5 min).
- Reintentos con backoff exponencial (5 s, 10 s, 20 s…) y máximo 5 intentos → `DEAD`.
- El secreto se muestra **una sola vez** al crear el endpoint.

## Observabilidad

`GET /v1/health` devuelve métricas listas para monitoreo:

```json
{
  "status": "ok",
  "metrics": {
    "jobs": { "pending": 3, "processing": 1, "dead": 0 },
    "orders": { "active": 12, "last24h": 20 },
    "sessions": { "active": 2 }
  }
}
```

## Sesión de Shalom (robusta)

El worker no depende de que la sesión esté viva: `SessionManager` es la única puerta de acceso.

| Situación | Comportamiento |
| --- | --- |
| Sesión `ACTIVE` | reutiliza el storage state cifrado |
| Sesión `EXPIRED` / sin sesión | **re-loguea solo** con las credenciales cifradas del tenant |
| Login falla (captcha, credenciales, bloqueo) | marca `REQUIERE_LOGIN_MANUAL`, registra el motivo y alerta en logs |
| Sesión cae a mitad de un job | el worker intenta `recover()` y **reintenta el job en 10 s** |
| Login repetido | cooldown por tenant (`SHALOM_RELOGIN_COOLDOWN_SECONDS`, 30 s) y lock para evitar logins simultáneos |

Monitoreo:

- `GET /v1/health` → `metrics.sessions = { active, requiresLogin }`
- `GET /v1/admin/sessions` → estado por empresa (`ACTIVE`, `EXPIRED`, `REQUIERE_LOGIN_MANUAL`)

> Shalom permite **una sola sesión activa**: si un operador entra al panel, el servicio re-loguea
> automáticamente en el siguiente job (y la sesión del operador se invalida).

## Rastreo

El rastreo público de Shalom (`shalom.com.pe/rastrea/`) no requiere sesión y devuelve estado +
timeline de 4 pasos. El servicio lo traduce a nuestros estados:

| Shalom | `shalom_order.status` |
| --- | --- |
| Envío no confirmado | `REGISTRADO` |
| En origen | `EN_ORIGEN` |
| En tránsito / en camino | `EN_TRANSITO` |
| En destino / disponible en agencia | `EN_TRANSITO` (progreso 2) |
| Entregado | `ENTREGADO` (progreso 3) |
| No entregado / devuelto / observado | `INCIDENCIA` |
| Anulado / cancelado | `ANULADO` |

**El rastreo automático está desactivado por defecto** (`SHALOM_TRACKING_ENABLED=false`): registrar
una guía solo devuelve orden y código. Si se quiere el estado, se consulta a propósito:

- `GET /v1/tracking?orden=&codigo=` (en vivo)
- `POST /v1/orders/:orderId/track` + `GET /v1/orders/:orderId/tracking` (guardado)

Para reactivar el barrido cada 15 min: `SHALOM_TRACKING_ENABLED=true`.

### Datos del destinatario

Shalom autocompleta nombre, apellidos y celular cuando reconoce el documento (DNI en RENIEC).
Para **CE, RUC o documentos que no reconoce**, el request debe incluir los datos:

```json
{
  "documentType": "CE",
  "recipientDocument": "000000001",
  "recipientName": "JUAN",
  "recipientPaternalLastName": "PEREZ",
  "recipientMaternalLastName": "GOMEZ",
  "recipientPhone": "987654321",
  "businessName": "EMPRESA SAC"
}
```

| Campo | Uso |
| --- | --- |
| `documentType` | `DNI` (default), `RUC`, `CE` |
| `recipientName` / `recipientPaternalLastName` / `recipientMaternalLastName` | se escriben en el formulario cuando Shalom no autocompleta |
| `recipientPhone` | celular del destinatario (9 dígitos) |
| `businessName` | razón social, solo RUC |

Si Shalom no reconoce el documento y no se envían los datos, el job termina `DEAD` con un
mensaje explícito pidiendo nombre y apellidos.

### Reglas aplicadas antes de encolar
| Regla | Comportamiento |
| --- | --- |
| Ventana operativa del tenant | `400` fuera de `windowStart`-`windowEnd` (TZ de la empresa) |
| Límite diario | `429` al superar `maxOrdersPerDay` |
| `externalRef` repetido | devuelve la orden existente (no crea otra guía) |
| `idempotencyKey` repetida | devuelve el job existente |
| Clave de seguridad inválida | `400` antes de gastar la sesión (4 dígitos, no consecutivos, no repetidos) |
| Un solo job por tenant | el claim excluye tenants con otro job en `PROCESSING` |

Los endpoints de administración aceptan `X-Admin-Token` cuando `ADMIN_TOKEN` está definido
(en Fase 5 se reemplaza por API keys con scopes).

## Driver de Shalom

`PlaywrightShalomDriver` implementa:

| Método | Qué hace |
| --- | --- |
| `login(username, password)` | login con reCAPTCHA v3 y UA real; devuelve `storageState` |
| `registerOrder(input, storageState)` | asistente de 9 pasos: producto → origen/destino → sobreprotegido → DNI + declaración jurada → cobro seguro → clave → orden |
| `getOrderCode(orden, storageState)` | lee el código desde “Envíos pendientes” |
| `tracking(orden, codigo)` | rastreo público con timeline |

Detalles que el driver maneja y que hay que conservar:

- **UA real**: si el User-Agent contiene `HeadlessChrome`, Shalom responde 403.
- **Solo elementos visibles**: todos los pasos del asistente viven en el DOM; un `Continuar`
  oculto de otro paso rompe el flujo si no se filtra por visibilidad.
- **Carrusel**: la tarjeta seleccionada es la centrada, medida contra `.flicking-viewport`.
- **Clave de seguridad**: 4 dígitos, sin consecutivos ni repetidos (Shalom los rechaza).
- **200 no significa éxito**: se lee el DOM y los avisos (toasts) para confirmar.

## Requisitos

- Node.js 24
- Docker Desktop (Postgres 17)

## Puesta en marcha

```bash
npm install
cp .env.example .env          # completar SECRETS_ENCRYPTION_KEY y API_KEY_PEPPER
```

Generar secretos:

```bash
openssl rand -base64 32       # SECRETS_ENCRYPTION_KEY
openssl rand -hex 32          # API_KEY_PEPPER
```

Levantar base y migrar:

```bash
docker compose up -d postgres
npx prisma migrate deploy
```

Arrancar:

```bash
npm run start:api:dev         # http://localhost:4100/v1/health
npm run start:worker:dev
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run typecheck` | TypeScript sin emitir |
| `npm test` | Tests unitarios (cifrado, API keys) |
| `npm run build` | Compila api y worker |
| `npm run db:migrate:dev` | Nueva migración en desarrollo |
| `npm run db:migrate:deploy` | Aplica migraciones (lo hace el contenedor api) |
| `npm run db:validate` | Valida el schema Prisma |
| `npm run tenant:create -- --code nobitex --name Nobitex --email ... --password ...` | Crea tenant + credenciales cifradas + app + API key |
| `npm run smoke:driver` | Prueba el driver contra Shalom sin base de datos (login) |
| `npm run smoke:driver -- --register` | Además registra un envío real (cuesta dinero) |

## Modelo de datos (v1)

| Tabla | Contenido |
| --- | --- |
| `tenant` | empresa dueña de la cuenta Shalom + límites (órdenes/día, ventana horaria, TZ) |
| `shalom_credential` | usuario + contraseña cifrada (contexto `tenant:<id>:shalom-password`) |
| `shalom_session` | storage state cifrado, estado (`ACTIVE`/`EXPIRED`/`REQUIERE_LOGIN_MANUAL`) |
| `application` | app consumidora (Nuvex, apps a medida) |
| `api_key` | prefijo visible + HMAC-SHA-256 con pepper + scopes |
| `shalom_job` | cola durable: `PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`/`DEAD`, leases y backoff |
| `shalom_order` | orden, código, monto, estado y referencia externa (`externalRef`) |
| `shalom_event` | historial de cambios de estado |
| `webhook_endpoint` / `webhook_delivery` | notificaciones firmadas con reintentos |

## Seguridad

- Contraseñas de Shalom cifradas con AES-256-GCM y **contexto por tenant** (un ciphertext no sirve
  para otro tenant).
- API keys: solo se guarda prefijo + HMAC; la key completa se muestra una vez.
- Scopes: `shalom:orders:write`, `shalom:orders:read`, `shalom:sessions:write`, `shalom:tracking:read`.
- Helmet, CORS cerrado, throttler, `X-Request-Id` (Fase 5).

## POC

En `poc/` está todo lo validado contra cuentas reales antes de escribir el servicio:

```bash
cd poc && npm install
npm run login          # login y sesión persistente
npm run individual     # registro individual de punta a punta
npm run tracking       # estado público de una guía
```

Detalle de hallazgos en `poc/README.md`.
