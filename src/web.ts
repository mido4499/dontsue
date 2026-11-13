import { loadConfig } from "./config.js";
import { MAX_FILE_BYTES } from "./files.js";
import { extractHtmlFacts } from "./parsers/html.js";
import { extractJsFacts } from "./parsers/js.js";
import { classifyUrlPath } from "./rules/policies.js";
import { ScanError, VERSION, buildReport, type ParsedFile } from "./scan.js";
import type { Config, Report, SkippedFile } from "./types.js";

export interface ScanWebsiteOptions {
  /** Use this config instead of reading a config file. */
  config?: Config;
  /** Path to a config file. Ignored if `config` is given. */
  configPath?: string;
  /** Maximum number of same-origin HTML pages to crawl (default: 15). */
  maxPages?: number;
  /** Maximum number of same-origin external JS scripts to fetch (default: 10). */
  maxScripts?: number;
  /** Per-request timeout in milliseconds (default: 10000). */
  timeoutMs?: number;
  /** Custom fetch implementation (useful for testing). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_PAGES = 15;
const DEFAULT_MAX_SCRIPTS = 10;
const DEFAULT_TIMEOUT_MS = 10_000;

const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|cjs|json|pdf|zip|gz|tar|woff2?|ttf|eot|mp4|webm|mp3|wav|xml|txt)$/i;
const PRIORITY_PATH = /login|signin|sign-in|signup|sign-up|register|auth|account|contact|checkout|privacy|terms|legal|cookie/i;

/** Return true if the string looks like an HTTP(S) URL. */
export function isHttpUrl(target: string): boolean {
  return /^https?:\/\//i.test(target.trim());
}

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new ScanError("No URL provided.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ScanError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScanError(`Unsupported URL protocol: ${url.protocol}`);
  }
  url.hash = "";
  return url;
}

function urlLabel(url: URL): string {
  return (url.pathname || "/") + url.search;
}

async function fetchText(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; contentType: string; finalUrl: string; text: string }> {
  const res = await fetchFn(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": `dontsue/${VERSION}`, Accept: "text/html,application/xhtml+xml,application/javascript,*/*;q=0.8" },
  });
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  return { status: res.status, ok: res.ok, contentType, finalUrl: res.url || url, text };
}

/**
 * Crawl the front-end of a published website (same-origin HTML pages and scripts)
 * and evaluate it with the same data-collection and policy rules as local projects.
 */
export async function scanWebsite(rawUrl: string, options: ScanWebsiteOptions = {}): Promise<Report> {
  const started = performance.now();
  const startUrl = normalizeUrl(rawUrl);
  const fetchFn = options.fetchImpl ?? fetch;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxScripts = options.maxScripts ?? DEFAULT_MAX_SCRIPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const config = options.config ?? (options.configPath ? await loadConfig(process.cwd(), options.configPath) : {});

  const parsed: ParsedFile[] = [];
  const skipped: SkippedFile[] = [];
  const routes: { file: string; kinds: ("privacy" | "terms")[] }[] = [];

  const visitedPages = new Set<string>();
  const queuedPages = new Set<string>([startUrl.href]);
  const priorityQueue: string[] = [startUrl.href];
  const normalQueue: string[] = [];
  const scriptQueue: string[] = [];
  const seenScripts = new Set<string>();

  let origin = startUrl.origin;
  let scannedCount = 0;

  while ((priorityQueue.length > 0 || normalQueue.length > 0) && visitedPages.size < maxPages) {
    const nextHref = priorityQueue.shift() ?? normalQueue.shift()!;
    if (visitedPages.has(nextHref)) continue;
    visitedPages.add(nextHref);

    const isRoot = visitedPages.size === 1;
    let res: Awaited<ReturnType<typeof fetchText>>;
    try {
      res = await fetchText(fetchFn, nextHref, timeoutMs);
    } catch (e) {
      const msg = (e as Error).message || "request failed";
      if (isRoot) throw new ScanError(`Failed to fetch ${startUrl.href}: ${msg}`);
      skipped.push({ file: nextHref, reason: msg });
      continue;
    }

    const finalParsed = (() => {
      try {
        const u = new URL(res.finalUrl);
        u.hash = "";
        return u;
      } catch {
        return new URL(nextHref);
      }
    })();

    // If the root URL redirected (e.g. http -> https or apex -> www), anchor crawling to the final origin.
    if (isRoot) origin = finalParsed.origin;
    visitedPages.add(finalParsed.href);

    if (!res.ok) {
      if (isRoot) throw new ScanError(`Failed to fetch ${startUrl.href}: HTTP ${res.status}`);
      skipped.push({ file: urlLabel(finalParsed), reason: `HTTP ${res.status}` });
      continue;
    }

    if (res.contentType && !/html|xhtml/i.test(res.contentType)) {
      if (isRoot) throw new ScanError(`Expected HTML from ${startUrl.href}, got ${res.contentType}`);
      skipped.push({ file: urlLabel(finalParsed), reason: `non-HTML (${res.contentType.split(";")[0]})` });
      continue;
    }

    const label = urlLabel(finalParsed);
    if (Buffer.byteLength(res.text, "utf8") > MAX_FILE_BYTES) {
      skipped.push({ file: label, reason: `larger than ${MAX_FILE_BYTES / 1_000_000}MB` });
      continue;
    }

    scannedCount++;
    const kinds = classifyUrlPath(finalParsed.pathname);
    if (kinds.length) routes.push({ file: label, kinds });

    const facts = extractHtmlFacts(res.text, label);
    parsed.push({ facts, ignoredLines: new Set() });

    for (const el of facts.elements) {
      if (el.name === "a" && typeof el.attrs.href === "string") {
        enqueueLink(el.attrs.href, finalParsed);
      } else if (el.name === "script" && typeof el.attrs.src === "string") {
        enqueueScript(el.attrs.src, finalParsed);
      }
    }
  }

  for (const scriptHref of scriptQueue.slice(0, maxScripts)) {
    const scriptUrl = new URL(scriptHref);
    const label = urlLabel(scriptUrl);
    let res: Awaited<ReturnType<typeof fetchText>>;
    try {
      res = await fetchText(fetchFn, scriptHref, timeoutMs);
    } catch (e) {
      skipped.push({ file: label, reason: (e as Error).message || "request failed" });
      continue;
    }
    if (!res.ok) {
      skipped.push({ file: label, reason: `HTTP ${res.status}` });
      continue;
    }
    if (Buffer.byteLength(res.text, "utf8") > MAX_FILE_BYTES) {
      skipped.push({ file: label, reason: `larger than ${MAX_FILE_BYTES / 1_000_000}MB` });
      continue;
    }
    scannedCount++;
    try {
      const facts = extractJsFacts(res.text, label);
      parsed.push({ facts, ignoredLines: new Set() });
    } catch (e) {
      skipped.push({ file: label, reason: `parse error: ${(e as Error).message.split("\n")[0]}` });
    }
  }

  return buildReport({
    root: origin,
    scannedFiles: scannedCount,
    startedAt: started,
    parsed,
    dependencies: [],
    skipped,
    routes,
    config,
  });

  function enqueueLink(rawHref: string, base: URL) {
    if (!rawHref || /^(mailto:|tel:|javascript:|#)/i.test(rawHref.trim())) return;
    let resolved: URL;
    try {
      resolved = new URL(rawHref, base);
    } catch {
      return;
    }
    if (resolved.origin !== origin) return;
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    resolved.hash = "";
    if (ASSET_EXT.test(resolved.pathname)) return;
    if (queuedPages.has(resolved.href)) return;
    queuedPages.add(resolved.href);
    if (PRIORITY_PATH.test(resolved.pathname)) priorityQueue.push(resolved.href);
    else normalQueue.push(resolved.href);
  }

  function enqueueScript(rawSrc: string, base: URL) {
    let resolved: URL;
    try {
      resolved = new URL(rawSrc, base);
    } catch {
      return;
    }
    if (resolved.origin !== origin) return;
    resolved.hash = "";
    if (seenScripts.has(resolved.href)) return;
    seenScripts.add(resolved.href);
    scriptQueue.push(resolved.href);
  }
}
