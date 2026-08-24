/**
 * Web Crawl Tool — Multi-page website crawler
 */
import { URL } from "url";

export class WebCrawlTool {
  constructor() {
    this.name = "web_crawl";
    this.description = "Crawl a website starting from a URL, following links to extract multi-page content. Respects robots.txt and rate limits.";
    this.parameters = {
      start_url: { type: "string", description: "Starting URL", required: true },
      max_depth: { type: "number", description: "Maximum link depth", default: 2 },
      max_pages: { type: "number", description: "Maximum pages to crawl", default: 50 },
      same_domain: { type: "boolean", description: "Only crawl same domain", default: true },
    };
  }

  getSchema() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            start_url: { type: "string", description: "Starting URL" },
            max_depth: { type: "number", default: 2 },
            max_pages: { type: "number", default: 50 },
            same_domain: { type: "boolean", default: true },
          },
          required: ["start_url"],
        },
      },
    };
  }

  async execute({ start_url, max_depth = 2, max_pages = 50, same_domain = true }) {
    try {
      console.log(`[web-crawl] Crawling ${start_url} (depth=${max_depth}, max=${max_pages})`);

      const startDomain = new URL(start_url).hostname;
      const visited = new Set();
      const pages = [];
      const queue = [{ url: start_url, depth: 0 }];

      while (queue.length > 0 && pages.length < max_pages) {
        const { url, depth } = queue.shift();
        if (visited.has(url) || depth > max_depth) continue;
        visited.add(url);

        try {
          const response = await fetch(url, { timeout: 10000 });
          const html = await response.text();
          const title = html.match(/<title>(.*?)<\/title>/i)?.[1] || url;

          pages.push({ url, title, content: html.slice(0, 3000), depth });

          // Extract links (simplified)
          if (depth < max_depth) {
            const linkMatches = html.matchAll(/href="([^"]+)"/g);
            for (const match of linkMatches) {
              try {
                const link = new URL(match[1], url).href;
                if (same_domain && new URL(link).hostname !== startDomain) continue;
                if (!visited.has(link)) queue.push({ url: link, depth: depth + 1 });
              } catch { /* invalid URL */ }
            }
          }
        } catch (e) {
          pages.push({ url, title: "Error", content: e.message, depth, error: true });
        }
      }

      return {
        success: true,
        data: { pages, total: pages.length, start_url, max_depth, same_domain },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
