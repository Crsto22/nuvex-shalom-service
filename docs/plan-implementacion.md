# Plan de implementación — nuvex-shalom-service

Microservicio multiempresa/multiaplicación para registrar envíos y consultar estados en Shalom PRO,
siguiendo el patrón de `nuvex-billing-service`.

## Decisiones cerradas

| Tema | Decisión |
| --- | --- |
| Stack | Node 24 + TypeScript + NestJS 11 (monorepo `apps/api` + `apps/worker`) |
| Automatización | Playwright (Chromium/Chrome real), perfil por tenant |
| Cola | Durable en PostgreSQL (`FOR UPDATE SKIP LOCKED`), **sin Redis** |
| Base de datos | Propia: `nuvex_shalom` (independiente de `nuvex` y `nuvex_billing`) |
| Multi-app | `Tenant` + `Application` + `ApiKey` (Bearer + scopes) |
| Concurrencia | 1 job activo por tenant; N contextos por worker |
| Rótulos | **Fuera del alcance** (manual) |
| Almacenamiento | Sin S3. Diagnóstico opcional en disco local, apagado por defecto |
| Cifrado | AES-256-GCM, formato `v1.<iv>.<tag>.<ct>`, contexto por tenant y propósito |

Fase 0 (POC) ya validada en `poc/`: login, carga masiva, registro masivo, registro individual y
rastreo público funcionando contra cuentas reales.

---

## Fase 1 — Fundaciones (1-2 días)

1. Crear repo `nuvex-shalom-service` con la estructura calcada del billing:
   `apps/api`, `apps/worker`, `libs/{config,database,security,webhooks,browser,shalom}`, `prisma/`, `docs/`.
2. `package.json` (engines `>=24 <25`), `nest-cli.json` multi-app, `tsconfig`, eslint, prettier, jest.
3. `libs/config`: validación de entorno con `class-validator`.
4. `libs/database`: `PrismaService`.
5. `libs/security`: portar `secrets-crypto` del billing (mismo formato y test de contexto).
6. Prisma + migración inicial: `Tenant`, `Application`, `ApiKey`, `IdempotencyRecord`,
   `ShalomSession`, `ShalomJob`, `ShalomOrder`, `ShalomEvent`, `WebhookEndpoint`, `WebhookDelivery`.
7. `docker-compose.yml`: `postgres` + `api` (4100) + `worker`; Dockerfile base Playwright; `TZ=America/Lima`.
8. `GET /v1/health` + `docs/openapi-v1.yaml` esqueleto.

**Criterio de aceptación:** `docker compose up` levanta API y worker, health en verde, migraciones aplicadas.

## Fase 2 — Driver Shalom y sesiones (3-4 días)

9. `libs/shalom/driver.ts` con la interfaz `ShalomDriver` (hoy `PlaywrightDriver`, mañana `ApiDriver`).
10. `libs/shalom/selectors.ts`: **todos** los selectores en un solo archivo versionado
    (login, popup Shalom Puntos, carrusel, multiselect, keypad, review, pendientes, rastreo, botón de rastreo = `form button[type=submit]`).
11. `libs/browser/pool.ts`: pool de contextos por tenant, límite `SHALOM_MAX_CONTEXTS`,
    cierre por inactividad, métricas de memoria.
12. Login: lectura de credenciales cifradas del tenant, `launchPersistentContext` con UA real
    (evita el 403 del WAF), guardado del storage state cifrado en `ShalomSession`.
13. Estados de sesión: `ACTIVE`, `EXPIRED`, `REQUIERE_LOGIN_MANUAL` + endpoint para que un operador
    resuelva el login y el servicio reutilice las cookies.
14. Prueba de humo automatizada: login + verificación de `/home` en CI nocturno por tenant de prueba.

**Criterio de aceptación:** `POST /v1/sessions` deja sesión `ACTIVE` y `POST /v1/jobs/*` puede reutilizarla
sin volver a loguear; si falla, la sesión queda en `REQUIERE_LOGIN_MANUAL` con diagnóstico.

## Fase 2 — Driver Shalom y sesiones (completada)

Validado contra Shalom real sin base de datos (script `scripts/smoke-driver.ts`):

| Prueba | Resultado |
| --- | --- |
| Login del driver | `SUCCESS` en 12-17 s, 7 cookies + 2 orígenes con localStorage |
| Registro individual | orden **104168762** · código **739D** · S/ 12.00 |
| Lectura de código | tomado de `/enviospendientes/list` |
| Rastreo de la misma guía | “Envío no confirmado”, 0/3 |

Correcciones que surgieron de la prueba real:

- El contexto de ejecución se destruye al navegar tras el submit → los polls toleran el error.
- `Continuar` resuelve primero a botones **ocultos** de otros pasos → todos los clics pasan por
  `visibleLocator()`.

Entregables: `libs/shalom/` (selectores, pool, driver, tipos), `POST/GET /v1/sessions/:tenantId`,
`scripts/create-tenant.ts` y `scripts/smoke-driver.ts`.

## Fase 3 — Jobs de registro (3-4 días)

15. `ShalomJob` repository con claim atómico (`FOR UPDATE SKIP LOCKED`), `locked_by`, `locked_at`,
    `next_attempt_at`, backoff con jitter, `DEAD`, renovación de lease y apagado ordenado.
16. Regla de exclusión: no reclamar un job si el tenant ya tiene otro `PROCESSING`
    (subconsulta en el claim o `pg_try_advisory_lock`).
17. `POST /v1/jobs/bulk` (multipart, `.xlsx`, ≤50 filas por archivo) + `Idempotency-Key`.
18. Troceo automático: si Nuvex envía más de 50 filas, el API crea N sub-jobs de ≤50 y un job padre
    que reporta progreso agregado.
19. Processor: subir archivo → modales SweetAlert → review → `Registrar envíos` → capturar
    `N° de orden`, `Código`, `Monto` por fila → `ShalomOrder` → cerrar job.
20. Errores por fila: `fila`, `ventaEnvioPublicId`, `motivo`; el job termina `COMPLETED_WITH_ERRORS`.
21. Dedupe: `ShalomOrder` única por `(tenant_id, venta_envio_public_id)`; si ya existe orden, no se reenvía.
22. Registro individual (si se habilita en v1): mismo driver, clave de seguridad configurable por tenant
    (regla: últimos 4 del DNI o clave fija), declaración jurada obligatoria.

**Criterio de aceptación:** un lote de 50 filas termina con 50 `shalom_order` y 0 jobs colgados;
matar el worker a mitad y verificar recuperación.

## Fase 3 — Jobs de registro (completada, solo individual)

Entregables:

- `POST /v1/tenants/:tenantId/orders` con validación (DNI/RUC, agencia, paquete, clave, idempotencia).
- Reglas de negocio antes de encolar: ventana operativa, límite diario, dedupe por `externalRef`,
  idempotencia y validación de la clave de seguridad.
- `ShalomJobProcessor`: carga la sesión cifrada, llama al driver, guarda `shalom_order` + `shalom_event`
  y devuelve orden/código/monto.
- Manejo de errores por tipo: `SESSION_REQUIRED` marca la sesión como `REQUIERE_LOGIN_MANUAL` y
  reintenta en 15 min; `PERMANENT` → `DEAD`; `RETRYABLE` → backoff.
- `GET /v1/jobs/:jobId` y `GET /v1/orders/:orderId`.

Pendiente de la fase: prueba HTTP end-to-end con Postgres (requiere Docker levantado).

## Fase 4 — Tracking (2 días)

23. `GET /v1/tracking?orden=&codigo=` consulta en vivo; `POST /v1/jobs/tracking` para lotes.
24. Parser del timeline → mapeo: `Envío no confirmado → POR_PREPARAR`, `En origen → POR_DESPACHAR`,
    `En tránsito/En destino → EN_TRANSITO`, `Entregado → ENTREGADO`, resto → `INCIDENCIA`.
25. `ShalomEvent`: solo se inserta cuando el estado cambia (idempotente).
26. Job programado (`TRACKING_SWEEP`) cada 15 min sobre órdenes activas, configurable por tenant.

**Criterio de aceptación:** el estado de una guía real aparece y cambia en `ShalomEvent` con webhook.

## Fase 4 — Tracking (completada)

Entregables:

- `GET /v1/tracking?orden=&codigo=` (consulta en vivo, sin sesión).
- `POST /v1/orders/:orderId/track` y `GET /v1/orders/:orderId/tracking` (estado guardado + eventos).
- `mapTracking()`: estado de Shalom → `REGISTRADO`/`EN_ORIGEN`/`EN_TRANSITO`/`ENTREGADO`/`INCIDENCIA`/`ANULADO`.
- `TrackingScheduler` en el worker: barrido cada 15 min sobre órdenes activas, con lote máximo.
- Índice único parcial que impide dos rastreos pendientes para la misma orden.
- `ShalomEvent` solo cuando el estado cambia.

Validado contra la guía real `104168762`: estado “Envío no confirmado” → `REGISTRADO` (progreso 0).

## Fase 5 — Seguridad multi-app y observabilidad (2 días)

27. `ApiKey` con prefijo visible + HMAC-SHA-256 (`API_KEY_PEPPER`), scopes y expiración.
28. Guards: `Authorization: Bearer`, `@Scope('shalom:jobs:write')`, throttler por aplicación,
    `X-Request-Id`, errores `application/problem+json`, helmet, CORS cerrado.
29. Webhooks firmados (`X-Shalom-Signature`) con reintentos y estado `DEAD`.
30. Observabilidad: logs estructurados, métricas (`jobs/min`, tasa de error, latencia por paso,
    contextos activos, memoria), alertas por fallo de flujo o sesión caída.

**Criterio de aceptación:** una app sin scope recibe 403; un webhook fallido reintenta y queda registrado.

## Fase 5 — Seguridad multi-app y observabilidad (completada)

- `ApiKeyGuard`: `Authorization: Bearer`, HMAC-SHA-256 con pepper, vigencia, tenant/aplicación activos,
  scopes por endpoint y aislamiento de tenant en todos los recursos.
- `ApplicationRateLimiter`: cupo por aplicación (`RATE_LIMIT_PER_MINUTE`, por réplica).
- Administración (`X-Admin-Token`): crear/listar/revocar API keys y registrar webhooks.
- Webhooks firmados (`X-Shalom-Signature: t=...,v1=...`), reintentos con backoff y `DEAD`;
  dispatcher con claim atómico sobre `webhook_delivery` (migración nueva).
- Métricas en `/v1/health`: jobs por estado, órdenes activas/24h y sesiones activas.

Pendiente de la fase: prueba HTTP con API keys reales (requiere Postgres).

## Fase 6 — Integración con Nuvex (2-3 días)

31. `nobitex-backend`: módulo `integrations/shalom` (cliente HTTP + DTOs + reintentos).
32. Migración Prisma en `venta_envio`: `shalomOrden`, `shalomCodigo`, `shalomEstado`,
    `shalomRegistradoAt`, `shalomSyncAt` + índice por `shalomOrden`.
33. Endpoint interno `POST /sales/:publicId/shalom-register` y de lote;
    consumo del webhook `job.completed` para escribir orden/código.
34. UI `entregas-pendientes`: botón **Registrar en Shalom** (individual/lote), progreso y errores por fila;
    el export Excel actual queda como respaldo.
35. Cron de tracking cada 15 min → actualizar `estadoLogistico` + `venta_envio_historial`.

**Criterio de aceptación:** desde la UI una venta pasa a “registrada en Shalom” con orden y código
visibles, y el estado cambia automáticamente al día siguiente.

## Fase 6 — Integración con Nuvex (backend completado)

Implementado en `nobitex-backend` (documentado en `docs/shalom-integration-v1.md`):

- Migración: `empresa_shalom_integration` + columnas `shalom_*` en `venta_envio`.
- Módulo `shalom-integration`: cliente HTTP, configuración cifrada por empresa,
  registro, estado y sincronización manual.
- Endpoints: `POST /sales/:publicId/shalom-register`, `GET /sales/:publicId/shalom`,
  `POST /sales/:publicId/shalom-sync`, `GET|PUT /company/shalom-config`.
- Webhook público `POST /shalom/webhooks` con verificación de firma HMAC,
  mapeo a `estado_logistico` e historial.
- Cliente del frontend: `salesApi.registerShalom`, `getShalomStatus`, `syncShalom`.

Pendiente: botón “Registrar en Shalom” en la UI de `entregas-pendientes` (modal con la clave
de 4 dígitos) y prueba end-to-end con Postgres.

## Fase 7 — QA y hardening (2 días)

36. Tests unitarios: parsers (review, timeline), troceo, mapeo de estados, cifrado.
37. Integración: job completo contra un tenant de prueba, cola con 2 workers (verificar no duplicación).
38. Contrato: validar OpenAPI contra el cliente real de Nuvex.
39. **Benchmark de carga**: 5 y 10 tenants × 50 guías en paralelo; medir RAM por contexto,
    tiempo por guía y tasa de fallo de sesión. Ajustar `SHALOM_MAX_CONTEXTS` con datos.

**Criterio de aceptación:** informe con números (guías/min, GB por worker, % fallos) y configuración definitiva.

## Fase 8 — Producción (1-2 días)

40. Deploy Docker (api + worker + postgres), backups, secretos fuera del repo, `TRUST_PROXY_HOPS`.
41. Runbook: sesión caída, captcha, cambio de UI, cuenta bloqueada, job `DEAD`, rollback.
42. Rollout por olas: 1 empresa → 5 → 20 → 50, con métricas por ola y criterio de pausa.

---

## Orden recomendado de ejecución

```
Fase 1 (fundaciones)
   └─ Fase 2 (driver + sesiones)   ← riesgo técnico más alto, se valida temprano
        └─ Fase 3 (jobs masivos)   ← valor principal para Nuvex
             ├─ Fase 4 (tracking)
             └─ Fase 6 (integración Nuvex)
                  └─ Fase 5 (seguridad/observabilidad multi-app) + Fase 7 (QA)
                       └─ Fase 8 (producción por olas)
```

Duración estimada total: **16-22 días** de trabajo enfocado (sin contar tiempos de respuesta de Shalom).

## Pendientes a confirmar antes de la Fase 1

1. ~~Nombre del repo~~ → **`shalom-service`**.
2. ~~¿v1 individual o masivo?~~ → **registro individual** en v1; el masivo queda para una fase posterior.
3. ~~Regla de clave de seguridad~~ → **la define el usuario** y viene en el request
   (validar 4 dígitos, sin consecutivos ni repetidos).
4. ~~Retención de diagnóstico~~ → **desactivado**: sin capturas, sin HTML, sin S3.
5. ~~Ventana operativa y límites~~ → **configurables por tenant** (env + tabla), valores iniciales:
   1 job activo por tenant, 200 registros/día, ventana 07:00-21:00 `America/Lima`.
6. ~~Administración de API keys~~ → **solo admin** (endpoint interno, sin portal).

### Alcance de la v1 (solo registro individual)

| Endpoint | Función |
| --- | --- |
| `POST /v1/sessions` | login por tenant (o marcar `REQUIERE_LOGIN_MANUAL`) |
| `GET /v1/sessions/:tenantId` | estado de la sesión |
| `POST /v1/orders` | registra **1 envío**; recibe destinatario, origen/destino, paquete, clave y opciones |
| `GET /v1/orders/:orden` | estado del registro (orden + código) |
| `GET /v1/tracking?orden=&codigo=` | estado público |
| `GET /v1/health` | salud del servicio |

Descartado explícitamente en v1: carga masiva por Excel, rótulos, S3, portal de API keys.

