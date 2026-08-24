/**
 * Computer: Browser — Web browsing with Playwright
 * Full browser automation: navigate, click, extract, screenshot
 */
export class BrowserTool {
  constructor() {
    this.name = "browser";
    this.description = "Browse websites, extract content, take screenshots";
    this.parameters = {
      action: { type: "string", enum: ["navigate", "extract", "click", "screenshot", "scroll"], required: true },
      url: { type: "string", description: "URL to navigate to" },
      selector: { type: "string", description: "CSS selector for click/extract" },
      scrollAmount: { type: "integer", description: "Pixels to scroll", default: 500 },
      waitFor: { type: "string", description: "Selector to wait for" },
    };
    this._browser = null;
    this._page = null;
  }

  async _getPage() {
    if (!this._page) {
      try {
        const { chromium } = await import("playwright");
        this._browser = await chromium.launch({ headless: true });
        this._page = await this._browser.newPage();
      } catch (e) {
        console.warn("[swarm-browser] Playwright not available, using fetch fallback:", e.message);
        return null;
      }
    }
    return this._page;
  }

  async execute({ action, url, selector, scrollAmount = 500, waitFor }) {
    const page = await this._getPage();

    try {
      switch (action) {
        case "navigate": {
          if (!url) return { success: false, error: "URL required" };
          if (!page) {
            // Fallback to fetch
            const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
            const content = await response.text();
            return {
              success: true,
              data: { url, title: "", content: content.slice(0, 10000), status: response.status },
            };
          }
          await page.goto(url, { waitUntil: "networkidle" });
          const title = await page.title();
          const content = await page.content();
          return { success: true, data: { url, title, content: content.slice(0, 10000) } };
        }
        case "extract": {
          if (!page) return { success: false, error: "Browser not available" };
          if (!selector) return { success: false, error: "Selector required" };
          const elements = await page.locator(selector).all();
          const texts = await Promise.all(elements.map(el => el.textContent()));
          return { success: true, data: { selector, texts, count: elements.length } };
        }
        case "click": {
          if (!page) return { success: false, error: "Browser not available" };
          if (!selector) return { success: false, error: "Selector required" };
          await page.locator(selector).click();
          if (waitFor) await page.waitForSelector(waitFor);
          return { success: true, data: { clicked: selector, url: page.url() } };
        }
        case "screenshot": {
          if (!page) return { success: false, error: "Browser not available" };
          const buffer = await page.screenshot({ fullPage: true });
          return { success: true, data: { screenshot: buffer.toString("base64"), format: "png" } };
        }
        case "scroll": {
          if (!page) return { success: false, error: "Browser not available" };
          await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);
          return { success: true, data: { scrolled: scrollAmount, url: page.url() } };
        }
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async close() {
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
      this._page = null;
    }
  }

  getSchema() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: this.parameters,
          required: ["action"],
        },
      },
    };
  }
}
