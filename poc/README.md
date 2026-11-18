# shalom-service

Microservicio de integración con **Shalom PRO**. Fase actual: **0.1 — verificación de login**.

## Requisitos

- Node.js 22–24 (`node --version`)
- Google Chrome instalado (Playwright usa el Chrome real, no un Chromium parcheado)

## Instalación

```bash
npm install
```

## Configuración

Copia `.env.example` a `.env` y completa las credenciales:

```ini
SHALOM_EMAIL=cuenta@empresa.com
SHALOM_PASSWORD=********
BROWSER_CHANNEL=chrome
HEADLESS=false          # ventana visible en la primera prueba
LOGIN_TIMEOUT_MS=45000
```

El `.env` está en `.gitignore`: nunca se commitea ni se imprime en logs.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run login:check` | Abre el login y verifica selectores + reCAPTCHA, **sin** enviar el formulario |
| `npm run login` | Login real: llena el formulario, envía y clasifica el resultado |
| `npm run session` | Reabre el perfil guardado y comprueba si la sesión sigue viva |
| `npm run probe` | Diagnóstico: compara variantes de navegador/User-Agent contra el sitio |
| `npm run explore` | Lista los menús del dashboard y sus opciones |
| `npm run masivo` | Abre `/registromasivo` y vuelca los controles de la pantalla |
| `npm run plantilla` | Descarga la plantilla oficial a `poc/out/plantilla-shalom.xlsx` |
| `npm run upload -- --file <xlsx>` | Sube un archivo (por defecto la plantilla); `--advance` / `--deep` recorren los pasos |
| `npm run review` | Muestra/limpia los envíos en `/registromasivo/review` (`--clear-all`) |
| `npm run inspect -- --url <url>` | Vuelca texto, botones y tablas de cualquier pantalla |
| `npm run typecheck` | Verifica tipos |

## Resultados

Cada ejecución escribe en `poc/out/`:

- `report-<fecha>.md` / `.json` — resultado clasificado, cookies, señales detectadas
- `login-<fecha>.png` — captura de pantalla final
- `login-<fecha>.html` — DOM final (para ajustar selectores)
- `trace-<fecha>.zip` — trace de Playwright (`npx playwright show-trace <archivo>`)
- `storage-state.json` — cookies de sesión (solo si el login fue exitoso)

`GET /` redirige a `/login` cuando no hay sesión, por eso el estado inicial esperado es
`NOT_LOGGED_IN` y no un error.

## Hallazgos de la Fase 0.1

1. **El login es Laravel** (`#formLogin`, CSRF `_token`, POST a `/login`). Sin checkbox de captcha.
2. **reCAPTCHA v3 invisible**: `grecaptcha.execute(SITE_KEY, {action:'login'})` llena el input
   oculto `#recaptcha_token`. No hay nada que resolver a mano; el puntaje lo decide Google.
3. **El sitio responde `403 Forbidden`** si el `User-Agent` contiene `HeadlessChrome`
   (regla del WAF sobre Apache). Por eso el servicio fija un UA de Chrome real, detectando la
   versión instalada en el equipo (`resolveUserAgent()` en `poc/lib/browser.ts`).
4. La app firma y cifra sus respuestas de API con `meta response-key` y `meta api-secret`
   por sesión → **no** se puede consumir la API interna con requests HTTP; hay que operar la UI
   con un navegador real, que es exactamente lo que hace Playwright.
5. La sesión vive en cookies (`enviashalom_session`, `XSRF-TOKEN`, `_GRECAPTCHA`) y en
   `localStorage`, por eso se usa un **perfil persistente** (`.profile/`) en vez de solo cookies.
6. El dashboard muestra un popup de "Shalom Puntos" que hay que cerrar
   (`button.popup-close[aria-label="Cerrar"]`); si no, tapa el menú.
7. El menú no usa `href`: son items Vue (`.figma-dropdown-item`) que navegan por JS.
   La ruta del masivo es **`/registromasivo`**.
8. **La plantilla oficial coincide exactamente** con el Excel que genera `nobitex-backend`:
   las mismas 13 columnas y las mismas 500 filas (encabezado + 499).
   Archivo descargado: `Formato-Pro-Masivo-2026_11_16_20.xlsx` (112 KB, con listas de validación).
9. Límites mostrados en pantalla: **máximo 50 envíos por archivo** y **hasta 10 encomiendas
   por destinatario**. El input acepta `.xls,.xlsx` y no es `multiple` → un lote grande debe
   partirse en varios archivos de ≤50 filas y subirse en secuencia.

## Fase 0.2 — flujo de carga (verificado)

| Paso | Pantalla / endpoint | Resultado |
| --- | --- | --- |
| Subir archivo | `input[type=file]` en `/registromasivo` | Acepta `.xls,.xlsx`, no `multiple` |
| Validar | `POST /service-orders/import/validate` | Responde **cifrado** (`{"encrypted":true,"data":"..."}`) |
| Aviso | modal SweetAlert2 | “Archivo válido” / “Carga completada”, se avanza con `.swal2-confirm` |
| Revisión | `/registromasivo/review` | Lista `.shipment-card`: N°, fecha, origen, destino, destinatario, DNI, cel, paquete y **precio** |
| Registro final | botón “Registrar envíos” | Crea las guías (cobra). **No se pulsa en pruebas** |
| Clave masiva | botón “CLAVE MASIVA” | Modal opcional “Clave de seguridad masiva” (No/Sí) |
| Anular | `.btn-basurero` → “Sí, confirmar” | Elimina todos los registros en revisión |

### Detalles que importan para la integración

- **La plantilla oficial NO está vacía**: la fila 2 trae un ejemplo real
  (`DNI 70503353`, `PAQUETE L`, Zamacola → Jaen). Subirla tal cual crea un envío
  pendiente real (`S/ 28.00`). Nuestro generador arranca la hoja desde cero, así que
  no arrastra ese ejemplo.
- La columna **A** de la plantilla lleva **el número de documento** (`70503353` en el ejemplo
  oficial), no el nombre: Shalom resuelve nombre y celular desde su propio registro de clientes
  y muestra, por ejemplo, `Dessiret Carolain Hernandez Mio · Cel: 995417675`.
- Las columnas I–L (alto/ancho/largo/peso) son **fórmulas** que dependen de `MERCADERIA`;
  nuestro backend ya las replica igual.
- El precio del envío se muestra en la revisión, antes de confirmar (ej. `S/ 12.00`).
- Todo el estado del lote vive en el servidor: cerrar el navegador no pierde la revisión.

## Fase 0.3 — registro individual (verificado end-to-end)

`/registroindividual` es un **asistente Vue de 9 pasos**, no un formulario:

| Paso | Pantalla | Cómo se automatiza |
| --- | --- | --- |
| 1 | Tipo de producto | Carrusel Flicking: **la tarjeta centrada es la elegida**. Se mide contra `.flicking-viewport` (no `.flicking-camera`, que abarca todo el track) y se avanza con `.flicking-arrow-next` hasta que el centro coincida |
| 2 | Origen / destino | `vue-multiselect` (`.multiselect` → `.multiselect__input` → `.multiselect__element`). Destino queda bloqueado hasta elegir origen. La tarifa aparece aquí |
| 3 | Sobreprotegido + Documentación | “No deseo el servicio”; serie/guía opcionales (`#series-input`, `#guide-input`) |
| 4 | Remitente / destinatario | Al escribir el DNI el sistema **autocompleta nombre, apellidos y celular** (enmascarados) |
| 5 | Declaración jurada | **Obligatoria**: `#declaracion_jurada_art` (Artículos de uso personal / Documentos / Ropa / Electrodomésticos) |
| 6 | Cobro Seguro | Deseo / No deseo |
| 7 | Clave de seguridad | Teclado numérico (`div.input-key`). Se envía como `clave` en el POST |
| 8 | Guardar | `POST /envia_ya/service_order/save` |
| 9 | Confirmación | `N° de registro: V391 - 104167642` + “Descargar rótulo” |

### Reglas descubiertas

- **La clave de 4 dígitos no puede ser consecutiva**: `1234` es rechazado
  (“Por seguridad su clave no puede ser números consecutivos”). Usar algo como los
  últimos 4 del DNI (`9872`).
- Sin la **declaración jurada** el POST responde `200` pero no crea la guía; el error
  aparece como toast (`Alerts.showToastErrorMessage`). Los `200` de esta app no
  significan éxito: hay que leer el DOM/avisos.
- El resultado es idéntico al masivo: **N° de orden + código (ej. `9DPK`) + S/ 12.00 +
  24 h para dejar el paquete en la agencia**.

## Fase 0.4 — rastreo público (verificado)

`https://shalom.com.pe/rastrea/` es una SPA Vue. **No requiere login** para el estado básico.

| Elemento | Detalle |
| --- | --- |
| Formulario | `input[placeholder="N° de Orden"]` (maxlength 10) + `input[placeholder="Código de Orden"]` (maxlength 4) + `form button[type=submit]` |
| Endpoints | `POST /api/v1/web/rastrea/buscar` y `POST /api/v1/web/rastrea/estados` (respuestas **cifradas** igual que en PRO) |
| Resultado | navega a `/rastrea/information` |
| Selectores | estado `.text-4xl.font-bold.text-red-color-sidebar` · mensaje `p.font-normal.text-silver-title` · fecha `p.text-placeholder-rastrea` · pasos `p|div.text-md.font-bold.text-color-card-terrestre` |

Ejemplo real (orden `104167642`, código `9DPK`):

```
Estado   : Envío no confirmado
Mensaje  : Tu envío fue registrado, pero aún no está en la agencia.
           No realices pagos. El remitente tiene 24 horas para llevarlo.
Fecha    : Desde el 16/11/26 a las 21:47
Progreso : 0/3
  [ ] En origen   [ ] En tránsito   [ ] En destino   [ ] Entregado
```

⚠️ **Cuidado con el selector del botón**: usar `form button[type=submit]`. Un selector por
texto (`/buscar|rastrea/i`) termina pulsando el ítem de navegación “Rastrea” y no pasa nada.

Los detalles completos (movimientos, quién entrega) solo se ven iniciando sesión en Shalom Pro,
así que para el microservicio alcanza con este estado público.

## Estados posibles del login

`SUCCESS` · `NOT_LOGGED_IN` · `CAPTCHA` · `BAD_CREDENTIALS` · `NEEDS_CODE` (2FA) · `BLOCKED` · `HTTP_ERROR` · `UNKNOWN`
