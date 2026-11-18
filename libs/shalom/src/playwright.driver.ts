import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BrowserContext, Locator, Page } from 'playwright';

import { BrowserPool } from './browser.pool';
import { securityKeyIssue } from './security-key';
import { PACKAGE_TITLES, SHALOM_SELECTORS } from './selectors';
import {
  ShalomError,
  type LoginOutcome,
  type LoginResult,
  type PendingShipment,
  type RegisterOrderInput,
  type RegisterOrderResult,
  type ShalomDriver,
  type TrackingResult,
} from './types';

const POLL_MS = 750;

@Injectable()
export class PlaywrightShalomDriver implements ShalomDriver {
  private readonly logger = new Logger(PlaywrightShalomDriver.name);
  private readonly baseUrl: string;
  private readonly trackingUrl: string;
  private readonly loginTimeoutMs: number;

  constructor(
    private readonly pool: BrowserPool,
    config: ConfigService,
  ) {
    this.baseUrl = (config.get<string>('SHALOM_BASE_URL') ?? 'https://pro.shalom.pe').replace(/\/$/, '');
    this.trackingUrl = config.get<string>('SHALOM_TRACKING_URL') ?? 'https://shalom.com.pe/rastrea/';
    this.loginTimeoutMs = Number(config.get<number>('SHALOM_LOGIN_TIMEOUT_MS') ?? 45_000);
  }

  // ---------------------------------------------------------------------------
  // Sesion
  // ---------------------------------------------------------------------------

  async login(username: string, password: string): Promise<LoginResult> {
    const context = await this.pool.acquire();
    try {
      const page = await context.newPage();
      await page.goto(`${this.baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_500);
      await this.dismissPopups(page);

      const current = await this.readLoginState(page);
      if (current.outcome !== 'SUCCESS') {
        await page.locator(SHALOM_SELECTORS.login.email).fill(username);
        await page.locator(SHALOM_SELECTORS.login.password).fill(password);
        if ((await page.locator(SHALOM_SELECTORS.login.remember).count()) > 0) {
          await page.locator(SHALOM_SELECTORS.login.remember).check().catch(() => undefined);
        }
        await page.locator(SHALOM_SELECTORS.login.submit).click();
        await this.waitForLoginOutcome(page);
      }

      const state = await this.readLoginState(page);
      const storageState = JSON.stringify(await context.storageState());

      if (state.outcome === 'SUCCESS') {
        return { outcome: 'SUCCESS', message: null, storageState };
      }
      return { outcome: state.outcome, message: state.message, storageState };
    } finally {
      await this.pool.release(context);
    }
  }

  // ---------------------------------------------------------------------------
  // Registro individual (asistente de 9 pasos)
  // ---------------------------------------------------------------------------

  async registerOrder(input: RegisterOrderInput, storageState: string): Promise<RegisterOrderResult> {
    this.assertSecurityKey(input.securityKey);
    const title = PACKAGE_TITLES[input.packageType.toUpperCase()] ?? input.packageType;

    const context = await this.pool.acquire(storageState);
    try {
      const page = await context.newPage();
      await page.goto(`${this.baseUrl}${SHALOM_SELECTORS.individual.route}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(2_500);
      await this.dismissPopups(page);
      await this.assertSession(page);

      // Paso 1: tipo de producto (la tarjeta centrada es la elegida)
      if (!(await this.centerProduct(page, title))) {
        throw new ShalomError(`No se pudo seleccionar el paquete "${title}"`, 'RETRYABLE');
      }
      await this.clickContinue(page);

      // Paso 2: origen y destino
      await this.waitForText(page, /a d[oó]nde deseas enviar/i);
      if (!(await this.pickMultiselect(page, 'Origen', input.originAgency))) {
        throw new ShalomError(`No se encontro la agencia de origen "${input.originAgency}"`, 'PERMANENT');
      }
      await page.waitForTimeout(1_500);
      if (!(await this.pickMultiselect(page, 'Destino', input.destinationAgency))) {
        throw new ShalomError(
          `No se encontro la agencia de destino "${input.destinationAgency}"`,
          'PERMANENT',
        );
      }
      await page.waitForTimeout(2_000);
      const monto = await this.readTariff(page);
      await this.clickContinue(page);

      // Paso 3: sobreprotegido + documentacion
      await this.waitForText(page, /sobreprotegido|agrega documentaci[oó]n/i);
      await this.chooseService(page, input.extraSecurity === true);
      await this.clickContinue(page);

      // Paso 4: remitente / destinatario
      await this.fillRecipient(page, input);

      await this.selectDeclaration(page, input.declarationType);
      await this.clickContinue(page);

      // Paso 5: cobro seguro
      await this.waitForText(page, /cobro seguro/i);
      await this.chooseService(page, input.cashOnDelivery === true);
      await this.clickContinue(page);

      // Paso 6: clave de seguridad
      await page.locator(SHALOM_SELECTORS.individual.keypad).first().waitFor({ timeout: 20_000 });
      await this.enterSecurityKey(page, input.securityKey);
      await page.waitForTimeout(800);
      await this.clickContinue(page);

      // Resultado
      const result = await this.readRegistrationResult(page);
      const codigo = await this.fetchOrderCode(page, result.orden);

      this.logger.log(
        `Envio registrado orden=${result.orden} codigo=${codigo ?? '-'} monto=${monto ?? '-'} tenant-doc=${input.recipientDocument}`,
      );

      return { orden: result.orden, codigo, monto, reference: result.reference };
    } finally {
      await this.pool.release(context);
    }
  }

  async getOrderCode(orden: string, storageState: string): Promise<string | null> {
    const context = await this.pool.acquire(storageState);
    try {
      const page = await context.newPage();
      await page.goto(`${this.baseUrl}${SHALOM_SELECTORS.pending.route}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(3_000);
      await this.assertSession(page);
      return this.fetchOrderCode(page, orden);
    } finally {
      await this.pool.release(context);
    }
  }

  /** Lista las guias pendientes de confirmacion (para reconciliar). */
  async listPending(storageState: string): Promise<PendingShipment[]> {
    const context = await this.pool.acquire(storageState);
    try {
      const page = await context.newPage();
      await page.goto(`${this.baseUrl}${SHALOM_SELECTORS.pending.route}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(3_500);
      await this.assertSession(page);

      return page.evaluate(() =>
        Array.from(document.querySelectorAll('.shipment-row')).map((row) => {
          const text = (row as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
          const amount = /S\/\s*([\d.,]+)/.exec(text)?.[1];
          const document = /DNI:\s*(\d{6,12})/.exec(text)?.[1];
          const content = /(\d+\s+[A-Za-z ]+?)\s+\d{2}-\d{2}-\d{4}/.exec(text)?.[1];

          return {
            orden: (row.querySelector('.order-number') as HTMLElement | null)?.innerText.trim() ?? '',
            codigo: (row.querySelector('.code-value') as HTMLElement | null)?.innerText.trim() ?? null,
            monto: amount ? Number(amount.replace(',', '')) : null,
            contenido: content?.trim() ?? '',
            documento: document ?? '',
          };
        }),
      );
    } finally {
      await this.pool.release(context);
    }
  }

  // ---------------------------------------------------------------------------
  // Rastreo publico (sin sesion)
  // ---------------------------------------------------------------------------

  async tracking(orden: string, codigo: string | null): Promise<TrackingResult> {
    const context = await this.pool.acquire();
    try {
      const page = await context.newPage();
      await page.goto(this.trackingUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2_500);
      await this.dismissPopups(page);

      const orderInput = page.locator(SHALOM_SELECTORS.tracking.orderInput).first();
      await orderInput.click();
      await orderInput.pressSequentially(orden, { delay: 50 });

      if (codigo) {
        const codeInput = page.locator(SHALOM_SELECTORS.tracking.codeInput).first();
        if ((await codeInput.count()) > 0) {
          await codeInput.click();
          await codeInput.pressSequentially(codigo, { delay: 50 });
        }
      }

      let sawEstados = false;
      const onResponse = (response: { url(): string }) => {
        if (/rastrea\/estados/i.test(response.url())) sawEstados = true;
      };
      page.on('response', onResponse);

      await page.locator(SHALOM_SELECTORS.tracking.submit).first().click();

      const clickedAt = Date.now();
      let headingVisible = false;
      const deadline = clickedAt + 30_000;

      try {
        while (Date.now() < deadline) {
          headingVisible = await page
            .locator(SHALOM_SELECTORS.tracking.heading)
            .first()
            .isVisible()
            .catch(() => false);
          if (headingVisible) break;
          // El sitio consulta /rastrea/estados solo cuando encuentra la guia.
          if (sawEstados && Date.now() - clickedAt > 4_000) break;
          if (!sawEstados && Date.now() - clickedAt > 12_000) break;
          await page.waitForTimeout(500);
        }
      } finally {
        page.off('response', onResponse);
      }

      if (!headingVisible) {
        if (!sawEstados) {
          const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
          if (/no (se )?encontr|no existe|verifica/i.test(text)) {
            throw new ShalomError(`Shalom no encontro la guia: ${text.slice(0, 160)}`, 'PERMANENT');
          }
          throw new ShalomError(
            'Shalom no devolvio resultados para esa orden (puede estar expirada: la ventana es de 24 h)',
            'PERMANENT',
          );
        }
        throw new ShalomError('No se pudo leer el resultado del rastreo', 'RETRYABLE');
      }
      await page.waitForTimeout(2_500);

      return await page.evaluate(
        ({ orden, codigo }) => {
          const heading = document.querySelector('.text-4xl.font-bold.text-red-color-sidebar');
          const mensaje = document.querySelector('p.font-normal.text-silver-title');
          const dateLine = document.querySelector('p.text-placeholder-rastrea');

          const pasos = Array.from(
            document.querySelectorAll(
              'p.text-md.font-bold.text-color-card-terrestre, div.text-md.font-bold.text-color-card-terrestre',
            ),
          ).map((node) => {
            const block = node.parentElement;
            const circle = block?.querySelector('div.rounded-full div') ?? null;
            const className = (circle?.className ?? '').toString();
            return {
              nombre: (node as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
              activo: /bg-red-600/.test(className) && !/bg-white/.test(className),
            };
          });

          const bars = Array.from(document.querySelectorAll('div.h-2.w-1\\/3'));
          const progreso = bars.filter((bar) => Number(window.getComputedStyle(bar as HTMLElement).opacity) > 0.5)
            .length;

          return {
            orden,
            codigo,
            estado: heading ? (heading as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : null,
            mensaje: mensaje ? (mensaje as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : null,
            fecha: dateLine ? (dateLine as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : null,
            progreso,
            pasos,
            url: location.href,
          };
        },
        { orden, codigo },
      );
    } finally {
      await this.pool.release(context);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertSecurityKey(key: string): void {
    const issue = securityKeyIssue(key);
    if (issue) throw new ShalomError(issue, 'PERMANENT');
  }

  private async assertSession(page: Page): Promise<void> {
    if (page.url().includes('/login')) {
      throw new ShalomError('Sesion de Shalom expirada o no iniciada', 'SESSION_REQUIRED');
    }
    const loginForm = await page.locator(SHALOM_SELECTORS.login.form).count();
    if (loginForm > 0) {
      throw new ShalomError('Sesion de Shalom expirada o no iniciada', 'SESSION_REQUIRED');
    }
  }

  private async dismissPopups(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const close = page.locator(SHALOM_SELECTORS.popups.loyaltyClose).first();
      if ((await close.count()) === 0 || !(await close.isVisible().catch(() => false))) return;
      await close.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }

  private async readLoginState(page: Page): Promise<{ outcome: LoginOutcome; message: string | null }> {
    const info = await page
      .evaluate(() => {
        const body = (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 2500).toLowerCase();
        const authenticated = Boolean((window as { IS_AUTHENTICATED?: boolean }).IS_AUTHENTICATED);
        const title = document.title.toLowerCase();
        return { body, authenticated, title, url: location.href };
      })
      // La navegacion posterior al submit destruye el contexto de ejecucion:
      // se trata como "todavia sin resultado" y se reintenta en el siguiente poll.
      .catch(() => null);

    if (!info) return { outcome: 'UNKNOWN', message: null };

    if (info.title.includes('403') || info.body.includes('forbidden')) {
      return { outcome: 'HTTP_ERROR', message: 'Shalom respondio 403 (bloqueo por User-Agent)' };
    }
    if (info.url.includes('/home') || info.authenticated) {
      return { outcome: 'SUCCESS', message: null };
    }
    if (/captcha|no soy un robot|verifica que eres humano/.test(info.body)) {
      return { outcome: 'CAPTCHA', message: 'reCAPTCHA rechazo el intento' };
    }
    if (/bloquead|demasiados intentos/.test(info.body)) {
      return { outcome: 'BLOCKED', message: 'Cuenta bloqueada o limite de intentos' };
    }
    if (/codigo de verificacion|verificacion en dos pasos|two-factor/.test(info.body)) {
      return { outcome: 'NEEDS_CODE', message: 'Shalom pide codigo de verificacion' };
    }
    if (/credenciales|incorrect|invalid/.test(info.body)) {
      return { outcome: 'BAD_CREDENTIALS', message: 'Credenciales rechazadas' };
    }
    return { outcome: 'UNKNOWN', message: null };
  }

  private async waitForLoginOutcome(page: Page): Promise<void> {
    const deadline = Date.now() + this.loginTimeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(POLL_MS);
      const state = await this.readLoginState(page);
      if (state.outcome !== 'UNKNOWN') return;

      const message = await this.readToast(page).catch(() => null);
      if (message) return;
    }
  }

  private async centerProduct(page: Page, title: string): Promise<boolean> {
    const normalized = title.toLowerCase();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = await page.evaluate(() => {
        const viewport = document.querySelector('.flicking-viewport');
        if (!viewport) return null;
        const rect = viewport.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const panels = Array.from(document.querySelectorAll('.card-panel')).map((panel) => {
          const panelRect = panel.getBoundingClientRect();
          return {
            text: (panel as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
            distance: Math.abs(panelRect.left + panelRect.width / 2 - centerX),
          };
        });
        panels.sort((a, b) => a.distance - b.distance);
        return panels[0] ? { text: panels[0].text, distance: panels[0].distance } : null;
      });

      if (!current) return false;
      if (current.text.toLowerCase().includes(normalized) && current.distance < 80) {
        return true;
      }
      await page.locator(SHALOM_SELECTORS.individual.next).click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(900);
    }
    return false;
  }

  /** Primer elemento visible de un locator (los pasos ocultos viven en el DOM). */
  private async visibleLocator(locator: Locator, timeoutMs = 20_000): Promise<Locator | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  }

  private async clickContinue(page: Page): Promise<void> {
    const candidates = page
      .locator(SHALOM_SELECTORS.individual.continueButton)
      .filter({ hasText: /continuar/i });

    const button = await this.visibleLocator(candidates);
    if (!button) {
      throw new ShalomError('No hay boton "Continuar" visible en la pantalla', 'RETRYABLE');
    }

    await button.click({ timeout: 15_000 });
    await page.waitForTimeout(2_500);
    await this.dismissPopups(page);
  }

  private async pickMultiselect(page: Page, label: string, search: string): Promise<boolean> {
    const boxes = page.locator(SHALOM_SELECTORS.individual.multiselect);
    const count = await boxes.count();

    for (let index = 0; index < count; index += 1) {
      const box = boxes.nth(index);
      if (!(await box.isVisible().catch(() => false))) continue;

      const text = (await box.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (!text.toLowerCase().includes(label.toLowerCase())) continue;

      await box.click({ timeout: 8_000 });
      await page.waitForTimeout(700);

      const input = box.locator(SHALOM_SELECTORS.individual.multiselectInput).first();
      await input.fill(search);
      await page.waitForTimeout(1_800);

      const options = box.locator(SHALOM_SELECTORS.individual.multiselectOption);
      const optionCount = await options.count();
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matching = options.filter({ hasText: new RegExp(escaped, 'i') });
      const matchingCount = await matching.count();

      let chosen = -1;
      for (let optionIndex = 0; optionIndex < matchingCount; optionIndex += 1) {
        const optionText = (await matching.nth(optionIndex).innerText().catch(() => ''))
          .replace(/\s+/g, ' ')
          .trim();
        if (optionText.toLowerCase().endsWith(search.toLowerCase())) {
          chosen = optionIndex;
          break;
        }
      }

      if (chosen < 0 && matchingCount > 0) chosen = 0;
      if (chosen < 0 || optionCount === 0) return false;

      await matching.nth(chosen).click({ timeout: 8_000 });
      await page.waitForTimeout(1_800);
      return true;
    }

    return false;
  }

  private async chooseService(page: Page, enabled: boolean): Promise<void> {
    const pattern = enabled ? /deseo el servicio/i : /no deseo el servicio/i;
    const option = await this.visibleLocator(page.getByText(pattern), 5_000);
    if (!option) return;
    await option.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  }

  /**
   * Paso "¿Quién recibirá el envío?".
   *
   * Shalom autocompleta nombre/apellidos/celular desde su registro cuando el
   * documento existe (y oculta los inputs). Si no lo reconoce, hay que enviar
   * los datos: el formulario los pide en #names-input, apellidos y #phone-input.
   */
  private async fillRecipient(page: Page, input: RegisterOrderInput): Promise<void> {
    const type = (input.documentType ?? 'DNI').toUpperCase();

    if (type !== 'DNI') {
      const radioId = `${type.toLowerCase()}_client_receiver`;
      const radio = page.locator(`#${radioId}`);
      if ((await radio.count()) === 0) {
        throw new ShalomError(`Shalom no ofrece el tipo de documento ${type}`, 'PERMANENT');
      }
      await page.locator(`label[for="${radioId}"]`).first().click({ timeout: 5_000 });
      await page.waitForTimeout(800);
    }

    const selectors = SHALOM_SELECTORS.individual.recipient;
    const docInput = page.locator(selectors.docInput).first();
    await docInput.waitFor({ state: 'visible', timeout: 20_000 });
    await docInput.fill(input.recipientDocument);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(3_000);
    await page
      .locator(selectors.spinner)
      .first()
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => undefined);

    const nameInput = page.locator(selectors.nameInput).first();
    const businessInput = page.locator(selectors.businessNameInput).first();
    const paternal = page.locator(selectors.paternalInput).first();
    const maternal = page.locator(selectors.maternalInput).first();
    const phone = page.locator(selectors.phoneInput).first();

    if ((await businessInput.count()) > 0 && (await businessInput.isVisible().catch(() => false))) {
      if (input.businessName) await businessInput.fill(input.businessName);
    }

    if ((await nameInput.count()) > 0 && (await nameInput.isVisible().catch(() => false))) {
      const current = (await nameInput.inputValue().catch(() => '')).trim();
      if (!current) {
        if (!input.recipientName) {
          throw new ShalomError(
            'Shalom no reconocio el documento; envia recipientName, apellidos y recipientPhone',
            'PERMANENT',
          );
        }

        await nameInput.fill(input.recipientName);
        if (input.recipientPaternalLastName) {
          await paternal.fill(input.recipientPaternalLastName);
        }
        if (input.recipientMaternalLastName) {
          await maternal.fill(input.recipientMaternalLastName);
        }
        await page.waitForTimeout(300);
      }
    }

    if (input.recipientPhone && (await phone.isVisible().catch(() => false))) {
      const value = (await phone.inputValue().catch(() => '')).trim();
      if (!value) await phone.fill(input.recipientPhone);
    }
  }

  private async selectDeclaration(page: Page, type?: string): Promise<void> {    const map: Record<string, string> = {
      'Articulos de uso personal': SHALOM_SELECTORS.individual.declarationRadio,
      Documentos: '#declaracion_jurada_docs',
      Ropa: '#declaracion_jurada_ropa',
      Electrodomesticos: '#declaracion_jurada_elec',
    };
    const selector = map[type ?? 'Articulos de uso personal'] ?? SHALOM_SELECTORS.individual.declarationRadio;
    const label = page.locator(`label[for="${selector.replace('#', '')}"]`);

    const visible = await this.visibleLocator(label, 3_000);
    if (!visible) return;

    await visible.click({ timeout: 5_000 });
    await page.waitForTimeout(400);
  }

  private async enterSecurityKey(page: Page, key: string): Promise<void> {
    for (const digit of key.split('')) {
      const candidates = page.locator(
        `${SHALOM_SELECTORS.individual.keypadDigit}:text-is("${digit}")`,
      );
      const button = await this.visibleLocator(candidates, 10_000);
      if (!button) {
        throw new ShalomError(`No se encontro la tecla "${digit}" del teclado de seguridad`, 'RETRYABLE');
      }
      await button.click({ timeout: 6_000 });
      await page.waitForTimeout(400);
    }
  }

  private async readTariff(page: Page): Promise<number | null> {
    const text = await page.locator('body').innerText().catch(() => '');
    const match = /S\/\s*([\d.,]+)/.exec(text);
    if (!match?.[1]) return null;
    const value = Number(match[1].replace(',', ''));
    return Number.isFinite(value) ? value : null;
  }

  private async readToast(page: Page): Promise<string | null> {
    const texts = await page
      .locator('.swal2-title, .swal2-html-container, .toast, .alert')
      .allInnerTexts()
      .catch(() => [] as string[]);
    const first = texts.map((text) => text.replace(/\s+/g, ' ').trim()).find(Boolean);
    return first ?? null;
  }

  private async readRegistrationResult(page: Page): Promise<{ orden: string; reference: string }> {
    const deadline = Date.now() + 40_000;

    while (Date.now() < deadline) {
      const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const match = SHALOM_SELECTORS.individual.resultOrder.exec(text);
      if (match?.[1]) {
        return { orden: match[1], reference: text.slice(0, 400) };
      }

      const toast = await this.readToast(page);
      if (toast && /clave|seguridad|error|no se pudo|rechaz/i.test(toast)) {
        throw new ShalomError(`Shalom rechazo el registro: ${toast}`, 'PERMANENT');
      }
      await page.waitForTimeout(1_000);
    }

    const toast = await this.readToast(page);
    throw new ShalomError(
      `No se obtuvo numero de orden${toast ? `: ${toast}` : ''}`,
      'RETRYABLE',
    );
  }

  private async fetchOrderCode(page: Page, orden: string): Promise<string | null> {
    await page.goto(`${this.baseUrl}${SHALOM_SELECTORS.pending.route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);

    return page.evaluate((target) => {
      const rows = Array.from(document.querySelectorAll('.shipment-row'));
      for (const row of rows) {
        const number = (row.querySelector('.order-number') as HTMLElement | null)?.innerText.trim();
        if (number === target) {
          return (row.querySelector('.code-value') as HTMLElement | null)?.innerText.trim() ?? null;
        }
      }
      return null;
    }, orden);
  }

  private async waitForText(page: Page, pattern: RegExp): Promise<void> {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const text = await page.locator('body').innerText().catch(() => '');
      if (pattern.test(text)) return;
      await page.waitForTimeout(500);
    }
    throw new ShalomError(`La pantalla esperada no aparecio: ${pattern}`, 'RETRYABLE');
  }
}
