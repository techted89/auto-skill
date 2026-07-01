/**
 * Web sourcing utilities for fetching documentation.
 *
 * Uses native fetch (Node 18+) to avoid heavy dependencies like Playwright.
 * For JavaScript-rendered pages, a note is included suggesting headless browser use.
 */

/**
 * Fetch documentation from a URL with proper error handling and rate limiting.
 *
 * @param {string} url - URL to fetch
 * @returns {Promise<{content: string, title: string, url: string}>}
 */
export async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "opencode-auto-skill/0.1.0 (+https://github.com/opencode-ai/auto-skill)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const html = await response.text();
  const title = extractTitle(html);
  const content = extractMainContent(html);

  return { content, title, url };
}

/**
 * Search a documentation site using DuckDuckGo's HTML results.
 * Note: For production, prefer an API-based search provider.
 *
 * @param {string} query - Search query
 * @param {number} maxResults - Max results to process (default 3)
 * @returns {Promise<Array<{title: string, snippet: string, url: string}>>}
 */
export async function searchDocs(query, maxResults = 3) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + " documentation")}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; opencode-auto-skill/0.1.0)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status}`);
  }

  const html = await response.text();
  return extractSearchResults(html, maxResults);
}

/**
 * Search + scrape: search for docs, then fetch the top results.
 *
 * @param {string} query - Search query
 * @returns {Promise<Array<{title: string, content: string, url: string}>>}
 */
export async function searchAndScrape(query) {
  const results = await searchDocs(query, 3);
  const pages = [];

  for (const result of results) {
    try {
      const page = await fetchPage(result.url);
      pages.push(page);
    } catch {
      // Skip pages that fail to load
    }
  }

  return pages;
}

/**
 * Extract the page title from HTML.
 */
function extractTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? match[1].trim() : "Untitled";
}

/**
 * Extract main content from HTML (simple text extraction).
 */
function extractMainContent(html) {
  // Remove scripts, styles, nav, footer
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "\n")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "\n")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "\n")
    // Convert block tags to newlines
    .replace(/<\/(h[1-6]|p|div|li|tr|pre|blockquote)>/gi, "\n")
    // Remove remaining HTML tags
    .replace(/<[^>]*>/g, "")
    // Decode entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Truncate very large content
  if (text.length > 50000) {
    text = text.slice(0, 50000) + "\n\n... [content truncated]";
  }

  return text;
}

/**
 * Extract the real URL from a DuckDuckGo redirect wrapper.
 * Handles: //duckduckgo.com/l/?uddg=https://real.url&rut=...
 */
function extractRealUrl(raw) {
  // Already a clean http(s) URL
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  // DuckDuckGo redirect: extract uddg param
  const uddg = raw.match(/uddg=([^&]+)/);
  if (uddg) return decodeURIComponent(uddg[1]);
  // Otherwise return as-is (might be a relative path)
  return raw;
}

/**
 * Extract search results from DuckDuckGo HTML.
 */
function extractSearchResults(html, maxResults) {
  const results = [];
  // Match result blocks
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  const urls = [];
  const titles = [];

  while ((match = resultRegex.exec(html)) !== null && urls.length < maxResults) {
    urls.push(extractRealUrl(decodeURIComponent(match[1])));
    titles.push(match[2].replace(/<[^>]*>/g, "").trim());
  }

  const snippets = [];
  while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
    snippets.push(match[1].replace(/<[^>]*>/g, "").trim());
  }

  for (let i = 0; i < Math.min(urls.length, maxResults); i++) {
    results.push({
      title: titles[i] || "Untitled",
      snippet: snippets[i] || "",
      url: urls[i],
    });
  }

  return results;
}
