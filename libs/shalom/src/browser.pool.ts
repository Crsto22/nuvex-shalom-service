import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, type Browser, type BrowserContext } from 'playwright';

import { resolveUserAgent } from './user-agent';

/**
 * Pool de contextos de navegador.
 *
 * Un solo proceso de Chromium puede sostener varios contextos aislados
 * (cada uno es "otro navegador" para el sitio). El limite evita que 50 tenants
 * en paralelo tumben el worker por RAM: cuando se alcanza el maximo, el
 * siguiente trabajo espera su turno.
 */
@Injectable()
export class BrowserPool implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserPool.name);
  private readonly maxContexts: number;
  private readonly headless: boolean;
  private readonly channel: 'chrome' | 'chromium';
  private readonly acquireTimeoutMs: number;

  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(config: ConfigService) {
    this.maxContexts = Number(config.get<number>('SHALOM_MAX_CONTEXTS') ?? 2);
    this.headless = (config.get<string>('SHALOM_HEADLESS') ?? 'true') === 'true';
    this.acquireTimeoutMs = Number(config.get<number>('SHALOM_ACQUIRE_TIMEOUT_MS') ?? 60_000);

    const configured = (config.get<string>('SHALOM_BROWSER_CHANNEL') ?? '').trim().toLowerCase();
    const wantsChrome = configured === 'chrome';
    const canUseChrome = process.platform === 'win32';

    if (wantsChrome && !canUseChrome) {
      this.logger.warn('BROWSER_CHANNEL=chrome no existe en Linux; se usa el Chromium del contenedor');
    }

    this.channel = wantsChrome && canUseChrome ? 'chrome' : 'chromium';

    this.logger.log(
      `Pool de navegadores: max=${this.maxContexts} headless=${this.headless} channel=${this.channel}`,
    );
  }

  get activeContexts(): number {
    return this.active;
  }

  async acquire(storageState?: string): Promise<BrowserContext> {
    await this.reserveSlot();

    try {
      const browser = await this.getBrowser();
      const context = await browser.newContext({
        userAgent: resolveUserAgent(),
        locale: 'es-PE',
        timezoneId: 'America/Lima',
        viewport: { width: 1366, height: 900 },
        acceptDownloads: false,
        storageState: storageState ? JSON.parse(storageState) : undefined,
        extraHTTPHeaders: {
          'accept-language': 'es-PE,es;q=0.9,es-419;q=0.8,en;q=0.7',
        },
      });

      context.setDefaultTimeout(30_000);
      context.setDefaultNavigationTimeout(60_000);
      return context;
    } catch (error) {
      this.releaseSlot();
      throw error;
    }
  }

  async release(context: BrowserContext): Promise<void> {
    await context.close().catch(() => undefined);
    this.releaseSlot();
  }

  async onModuleDestroy(): Promise<void> {
    for (const waiter of this.waiters.splice(0)) waiter();
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }

  private async reserveSlot(): Promise<void> {
    if (this.active < this.maxContexts) {
      this.active += 1;
      return;
    }

    this.logger.debug(`Limite de ${this.maxContexts} contextos alcanzado, esperando turno`);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onRelease);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('SHALOM_POOL_BUSY: no hubo contexto libre a tiempo'));
      }, this.acquireTimeoutMs);

      const onRelease = () => {
        clearTimeout(timer);
        this.active += 1;
        resolve();
      };

      this.waiters.push(onRelease);
    });
  }

  private releaseSlot(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;

    this.launching = chromium
      .launch({
        channel: this.channel,
        headless: this.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
        ],
      })
      .then((browser) => {
        this.browser = browser;
        this.logger.log('Chromium lanzado para el pool');
        return browser;
      })
      .finally(() => {
        this.launching = null;
      });

    return this.launching;
  }
}
