import { describe, expect, it } from "vitest";
import { ScanError, isHttpUrl, scanWebsite } from "../src/index.js";

type RouteMap = Record<string, { status?: number; contentType?: string; body: string }>;

function mockFetch(routes: RouteMap): typeof fetch {
  return async (input: string | URL | Request) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const hit = routes[url.pathname];
    if (!hit) {
      return new Response("<h1>Not Found</h1>", { status: 404, headers: { "content-type": "text/html" } });
    }
    return new Response(hit.body, {
      status: hit.status ?? 200,
      headers: { "content-type": hit.contentType ?? "text/html; charset=utf-8" },
    });
  };
}

describe("isHttpUrl", () => {
  it("recognizes http and https URLs", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://localhost:3000")).toBe(true);
    expect(isHttpUrl("./my-app")).toBe(false);
    expect(isHttpUrl("/tmp/site")).toBe(false);
  });
});

describe("scanWebsite", () => {
  const siteUrl = "https://example.test";
  const fetchImpl = mockFetch({
    "/": {
      body: `<!doctype html><html><head>
        <script src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>
        <script src="/app.js"></script>
      </head><body>
        <a href="/login">Sign in</a>
        <a href="/broken-page">Broken</a>
        <a href="https://other-origin.test/about">External</a>
      </body></html>`,
    },
    "/login": {
      body: `<!doctype html><html><body>
        <form><input type="email" name="email"><input type="password" name="password"></form>
      </body></html>`,
    },
    "/app.js": {
      contentType: "application/javascript",
      body: `window.gtag("config", "G-TEST123");`,
    },
  });

  it("crawls same-origin pages and external scripts to flag missing privacy policy and cookie consent", async () => {
    const report = await scanWebsite(siteUrl, { fetchImpl });
    expect(report.root).toBe(siteUrl);
    expect(report.scannedFiles).toBe(3); // /, /login, /app.js
    expect(report.skipped.some((s) => s.file === "/broken-page" && s.reason === "HTTP 404")).toBe(true);

    const ruleIds = new Set(report.findings.map((f) => f.ruleId));
    expect(ruleIds.has("pii/email-field")).toBe(true);
    expect(ruleIds.has("pii/password-field")).toBe(true);
    expect(ruleIds.has("tracker/google-analytics")).toBe(true);

    const issueIds = new Set(report.issues.map((i) => i.id));
    expect(issueIds.has("missing-privacy-policy")).toBe(true);
    expect(issueIds.has("tracking-without-consent")).toBe(true);
  });

  it("recognizes privacy policy, terms, and cookie consent on a compliant website", async () => {
    const compliantFetch = mockFetch({
      "/": {
        body: `<!doctype html><html><head>
          <script src="https://www.googletagmanager.com/gtag/js?id=G-123"></script>
          <script src="https://consent.cookiebot.com/uc.js"></script>
        </head><body>
          <form><input type="email"></form>
          <footer><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></footer>
        </body></html>`,
      },
      "/privacy": { body: `<html><body><h1>Privacy Policy</h1></body></html>` },
      "/terms": { body: `<html><body><h1>Terms</h1></body></html>` },
    });
    const report = await scanWebsite("example.test", { fetchImpl: compliantFetch });
    expect(report.policies.privacyPolicy.found).toBe(true);
    expect(report.policies.termsOfService.found).toBe(true);
    expect(report.policies.cookieConsent.found).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("throws ScanError when the root URL returns an HTTP error or invalid URL", async () => {
    await expect(scanWebsite(`${siteUrl}/missing-root`, { fetchImpl })).rejects.toThrow(ScanError);
    await expect(scanWebsite("ftp://example.com", { fetchImpl })).rejects.toThrow(ScanError);
    await expect(scanWebsite("", { fetchImpl })).rejects.toThrow(ScanError);
  });
});
