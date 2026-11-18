# Runbook operativo — shalom-service

## 1. Una empresa queda en REQUIERE_LOGIN_MANUAL

**Síntoma:** `GET /v1/health` → `metrics.sessions.requiresLogin > 0`, o una orden falla con
"Sesión de Shalom expirada".

**Qué hacer:**

1. `GET /v1/admin/sessions` para ver la empresa y `lastError`.
2. Si el error es de credenciales o captcha:
   - Actualizar credenciales: `PUT /v1/admin/tenants/:tenantId/credentials`.
   - O volver a iniciar sesión: `POST /v1/sessions/:tenantId/login`.
3. Si el login responde `CAPTCHA`, el reCAPTCHA v3 está rechazando el intento:
   - Reintentar más tarde (cooldown) o hacer el login desde una IP de oficina.
   - Última opción: login manual asistido (una persona entra al panel y el servicio reutiliza la
     sesión en el siguiente job).
4. Verificar que `requiresLogin` vuelve a 0.

## 2. Jobs en DEAD

**Síntoma:** `metrics.jobs.dead` crece.

1. `GET /v1/jobs/:jobId` para leer `errorMessage`.
2. Errores típicos:
   - *Agencia no encontrada* → el nombre de la agencia no coincide con el catálogo de Shalom.
   - *Shalom no reconoció el documento* → faltó `recipientName`/apellidos/`recipientPhone`.
   - *Shalom rechaza claves consecutivas* → el usuario eligió `1234`.
   - *No devolvió resultados* → la guía no existe (anulada o expirada a 24 h).
3. Corregir el dato y volver a crear la orden con **otro** `externalRef` (si se reutiliza, la API
   devuelve la orden anterior).

## 3. Shalom cambia la interfaz

**Síntoma:** los jobs empiezan a fallar con "No hay botón Continuar visible" o timeouts de selectores.

1. Revisar `libs/shalom/src/selectors.ts` (todo está centralizado ahí).
2. Abrir el flujo manualmente y comparar el DOM.
3. Ajustar el selector, correr `npm test` y probar con una guía real.
4. Mientras se corrige: usar el export Excel como respaldo manual.

## 4. La cuenta de Shalom fue bloqueada

1. Contactar al ejecutivo de Shalom de esa empresa.
2. Pausar la empresa (`tenant.status = SUSPENDED`) para que la API no la use.
3. Revisar volumen y horarios de uso antes de reactivar.

## 5. Docker / base de datos

| Situación | Acción |
| --- | --- |
| `docker compose ps` muestra postgres caído | `docker compose up -d postgres`; luego api y worker |
| API no conecta (`P1001`) | Verificar que postgres esté healthy y `DATABASE_URL` |
| Disco lleno | `docker system prune -af` (sin `--volumes`), limpiar temporales; **nunca** borrar el volumen de postgres |
| Restore | Ver `docs/backup-restore.md` |

## 6. Apagado / reinicio ordenado

```bash
docker compose stop worker   # deja de tomar jobs
docker compose stop api      # deja de recibir requests
docker compose stop postgres # solo tras los anteriores
```

Al arrancar: `postgres → api → worker` (compose ya respeta el orden con healthchecks).

## 7. Verificación diaria (2 minutos)

```bash
curl -s http://127.0.0.1:4100/v1/health
node scripts/check-alerts.mjs --url http://127.0.0.1:4100
```

Debe responder `OK ... requiresLogin=0` y no dejar jobs viejos en `DEAD`.
