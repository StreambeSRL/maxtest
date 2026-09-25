import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

/**
 * Un único proceso de Chromium compartido; cada tester recibe su propio
 * BrowserContext (cookies, storage, sesión y cache completamente aislados).
 */
class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  async get(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium
        .launch({ headless: process.env.HEADED !== "true" })
        .then((b) => {
          this.browser = b;
          b.on("disconnected", () => {
            this.browser = null;
          });
          return b;
        })
        .finally(() => {
          this.launching = null;
        });
    }
    return this.launching;
  }

  async newSession(): Promise<{ context: BrowserContext; page: Page }> {
    const browser = await this.get();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "es-AR",
      ignoreHTTPSErrors: true,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 AI-Tester",
    });
    context.setDefaultTimeout(8000);
    context.setDefaultNavigationTimeout(30000);
    const page = await context.newPage();
    return { context, page };
  }

  async shutdown() {
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
  }
}

export const browserPool = new BrowserPool();
