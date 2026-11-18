# Plan de producción — shalom-service

## Progreso P0 (actualizado)

| Tarea | Estado |
| --- | --- |
| Credenciales fuera del `.env` | ✅ |
| `bootstrap` bloqueado en producción | ✅ |
| `.dockerignore` + `Dockerfile` corregido | ✅ |
| `chrome → chromium` en Linux | ✅ |
| `X-Request-Id` + `TRUST_PROXY_HOPS` | ✅ |
| OpenAPI (`docs/openapi-v1.yaml`) + `docs/security-v1.md` | ✅ |
| Alta de empresas por API (`POST /admin/tenants`) | ✅ |
| Validación de credenciales (`?validate=true` / endpoint dedicado) | ✅ |
| Auditoría (`audit_log` + `GET /admin/audit`) | ✅ |
| CI (typecheck + test + build) | ✅ |
| Rotar contraseña de Shalom | ⏳ (acción del cliente) |
| Tests E2E con base real | ⏳ (requiere Postgres) |
| Despliegue en VPS | ⏳ (acción del cliente) |

Estado de partida (verificado): registro individual con orden + código, cola durable, sesión con
re-login automático, multiempresa a nivel de datos, 43 tests, probado contra guías reales.

**Fuera de alcance de este plan:** dominio, DNS, HTTPS y certificados (los gestiona el cliente).

---

## P0 — Higiene y despliegue real (1-2 días)

| # | Tarea | Criterio de aceptación |
| --- | --- | --- |
| 1 | Sacar `SHALOM_EMAIL` / `SHALOM_PASSWORD` del `.env`; dejar credenciales **solo** en BD cifrada | `grep -r "SHALOM_PASSWORD" .env*` no devuelve nada |
| 2 | Rotar la contraseña de Shalom usada en pruebas | La anterior deja de funcionar |
| 3 | `ADMIN_TOKEN` fuerte y fuera del repo | El `.env` no está versionado y el token es aleatorio ≥32 chars |
| 4 | Construir la imagen Docker y correr api + worker + postgres en contenedor | `docker compose up -d` → `/v1/health` 200 y un login real funciona **en Linux** (channel `chromium`) |
| 5 | Verificar que `bootstrap` no se ejecuta en producción | Script bloqueado si `NODE_ENV=production` |
| 6 | Ajustar `.env.example` sin secretos y `.gitignore` | Repo limpio |

**Riesgo que cubre:** hoy todo se probó en Windows con Chrome instalado; el contenedor usa Chromium.

---

## P1 — Operación y observabilidad (2-3 días)

| # | Tarea | Criterio |
| --- | --- | --- |
| 7 | Alerta cuando `metrics.sessions.requiresLogin > 0` | Llega notificación (Slack/email) en <5 min |
| 8 | Alerta cuando `metrics.jobs.dead` crece | Idem |
| 9 | Alerta de worker caído (sin heartbeat) | Detecta proceso muerto en <5 min |
| 10 | Backup diario de Postgres + **restore probado** | Restauración en un entorno limpio |
| 11 | Logs retenidos y rotados | Se puede reconstruir un fallo de 7 días atrás |
| 12 | Uptime check externo de `/v1/health` | Historial de disponibilidad |

---

## P2 — Multiempresa operativa (3-4 días)

| # | Tarea | Criterio |
| --- | --- | --- |
| 13 | `POST /v1/admin/tenants` (empresa + aplicación + API key) | Alta completa por API, sin scripts |
| 14 | Validar credenciales al guardarlas (login de prueba) | Responde OK/error en la misma llamada |
| 15 | Consola: selector de empresas + estado de sesión por empresa | Se administran 3 empresas sin editar archivos |
| 16 | Auditoría mínima (quién cambia credenciales/config) | Tabla `audit_log` con usuario y fecha |
| 17 | Límites por empresa configurables (órdenes/día, ventana) | Se ajusta sin deploy |

---

## P3 — Ciclo completo con Nuvex (2-3 días)

| # | Tarea | Criterio |
| --- | --- | --- |
| 18 | Probar webhooks con un receptor real (firma + reintentos + `DEAD`) | Entrega firmada verificada y reintento observado |
| 19 | Aplicar migración en `nobitex-backend` (`ShalomIntegration` + campos `shalom_*`) | `prisma migrate deploy` sin errores |
| 20 | Configurar `SHALOM_SERVICE_URL` y credenciales de empresa en Nuvex | `GET /company/shalom-config` responde `ACTIVE` |
| 21 | Botón “Registrar en Shalom” en `entregas-pendientes` (clave de 4 dígitos) | Una venta real queda con orden y código visibles |
| 22 | Consumir webhook `order.registered` en Nuvex | La venta se actualiza sin recargar |

---

## P4 — Escala (3-5 días)

| # | Tarea | Criterio |
| --- | --- | --- |
| 23 | Benchmark 5 → 10 → 20 empresas en paralelo | Informe: guías/min, RAM por worker, % fallos de sesión |
| 24 | Ajustar `SHALOM_MAX_CONTEXTS` y cantidad de workers según los números | Configuración documentada y reproducible |
| 25 | Rate limit por empresa y por aplicación | Una empresa ruidosa no afecta a las demás |
| 26 | Fairness de cola (1 job por tenant ya existe; revisar prioridad) | Sin inanición bajo carga |

---

## P5 — Hardening y salida (2-3 días)

| # | Tarea | Criterio |
| --- | --- | --- |
| 27 | CI: `typecheck + test + build` en cada push; imagen versionada | Pipeline verde y rollback con tag anterior |
| 28 | Runbook operativo | Documentado: sesión caída, captcha, UI cambiada, cuenta bloqueada, job `DEAD` |
| 29 | Plan de contingencia con Shalom (ToS) y respaldo Excel | Acuerdo o decisión consciente documentada |
| 30 | Piloto 1 empresa → olas 5 → 20 → 50 con métricas por ola | Criterio de pausa definido |

---

## Checklist de salida a producción (go / no-go)

- [ ] El servicio corre en Docker/Linux con Chromium y registra una guía real.
- [ ] Ningún secreto en el repositorio ni en `.env`.
- [ ] Alerta de `requiresLogin` y `jobs.dead` funcionando.
- [ ] Backup con restore probado.
- [ ] Lista de empresas administrable sin scripts.
- [ ] Webhook verificado de punta a punta.
- [ ] Un registro real (Nuvex o CLI) repetible 3 veces seguidas.
- [ ] Runbook escrito y probado al menos una vez.

---

## Duración estimada

| Fase | Días |
| --- | --- |
| P0 | 1-2 |
| P1 | 2-3 |
| P2 | 3-4 |
| P3 | 2-3 |
| P4 | 3-5 |
| P5 | 2-3 |
| **Total** | **13-20 días** de trabajo enfocado |

## Orden recomendado

```
P0 (higiene + Docker)
 └─ P1 (operación)  ──────────────┐
     └─ P2 (multiempresa)         │
         └─ P3 (Nuvex + webhooks) │
             └─ P4 (escala)       │
                 └─ P5 (salida) ◄─┘
```

P0 y P1 son obligatorios antes de cualquier cliente real. P2 puede hacerse en paralelo con P3.
P4 se ejecuta cuando ya haya volumen; no bloquea el piloto.
