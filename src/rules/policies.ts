import type { ElementFact } from "../types.js";

export type PolicyKind = "privacy" | "terms";

const PRIVACY_SLUG = /^(privacy|privacy[-_]?policy|privacy[-_]?notice|privacy[-_]?statement|datenschutz|confidentialite)$/i;
const TERMS_SLUG = /^(terms|tos|terms[-_]?of[-_]?(service|use)|terms[-_]?and[-_]?conditions|terms[-_]?conditions|conditions|eula)$/i;
const LEGAL_SLUG = /^legal$/i;

/** Directory names that mean "this file is a user-facing page". */
const PAGE_DIRS = new Set(["pages", "app", "routes", "views", "public", "static", "content", "site", "www"]);
const PAGE_FILES = /^(page|index|\+page|route|_index)\.[a-z]+$/i;
const DOC_EXT = /\.(html?|mdx?|astro|vue|svelte)$/i;
const CODE_EXT = /\.(tsx|jsx|ts|js|mjs)$/i;

/**
 * Decide whether a file path is a privacy or terms page.
 *
 *   app/privacy/page.tsx         -> privacy
 *   src/pages/terms-of-service.astro -> terms
 *   public/privacy.html          -> privacy
 *   app/(legal)/privacy/page.tsx -> privacy
 *   src/lib/privacy.ts           -> null (not a page)
 */
export function classifyRoute(relPath: string): PolicyKind[] {
  const parts = relPath.split("/").map((p) => p.replace(/^\(|\)$/g, "")); // strip Next.js route groups
  const file = parts[parts.length - 1] ?? "";
  const isPagey = DOC_EXT.test(file) || (CODE_EXT.test(file) && parts.some((p) => PAGE_DIRS.has(p)));
  if (!isPagey) return [];

  // The slug is either the file name ("privacy.html") or the folder holding an index/page file.
  const base = file.replace(/\.[^.]+$/, "");
  const slug = PAGE_FILES.test(file) ? (parts[parts.length - 2] ?? "") : base;

  if (PRIVACY_SLUG.test(slug)) return ["privacy"];
  if (TERMS_SLUG.test(slug)) return ["terms"];
  if (LEGAL_SLUG.test(slug)) return ["privacy", "terms"];
  return [];
}

const PRIVACY_HREF = /privacy|datenschutz|iubenda\.com\/privacy|termly\.io/i;
const TERMS_HREF = /terms|\/tos\b|conditions|\/eula\b/i;
const PRIVACY_TEXT = /privacy\s*(policy|notice|statement)?/i;
const TERMS_TEXT = /terms(\s*(of\s*(service|use)|\s*(&|and)\s*conditions))?|\bconditions\b/i;

/** Decide whether an element is a link to a privacy or terms page. */
export function classifyLink(el: ElementFact): { kinds: PolicyKind[]; target: string } {
  const href = el.attrs.href ?? el.attrs.to ?? el.attrs[":href"] ?? el.attrs[":to"];
  const isLinky = href !== undefined || /(^a$|Link$|^router-link$)/.test(el.name);
  if (!isLinky) return { kinds: [], target: "" };

  const target = typeof href === "string" ? href : el.text;
  const kinds = new Set<PolicyKind>();
  if (typeof href === "string") {
    if (PRIVACY_HREF.test(href)) kinds.add("privacy");
    if (TERMS_HREF.test(href)) kinds.add("terms");
    if (/\/legal\/?$/.test(href)) kinds.add("privacy").add("terms");
  }
  if (PRIVACY_TEXT.test(el.text)) kinds.add("privacy");
  if (TERMS_TEXT.test(el.text)) kinds.add("terms");
  return { kinds: [...kinds], target };
}

// ---------------------------------------------------------------------------
// Consent management platforms
// ---------------------------------------------------------------------------

export const CONSENT_DEPENDENCIES = [
  "vanilla-cookieconsent",
  "cookieconsent",
  "react-cookie-consent",
  "@cookieconsent/*",
  "klaro",
  "tarteaucitronjs",
  "@consent-manager/*",
  "@usercentrics/*",
  "@didomi/*",
  "@iubenda/*",
  "@c15t/*",
  "c15t",
  "@osano/*",
  "react-cookie-banner",
  "@porscheofficial/cookie-consent-banner-react",
  "vue-cookie-accept-decline",
  "@ngx-cookie-consent/*",
  "ngx-cookieconsent",
];

export const CONSENT_SCRIPTS: { pattern: RegExp; vendor: string }[] = [
  { pattern: /consent\.cookiebot\.com/, vendor: "Cookiebot" },
  { pattern: /cdn\.cookielaw\.org|optanon/i, vendor: "OneTrust" },
  { pattern: /app\.termly\.io\/(embed|resource-blocker)/, vendor: "Termly" },
  { pattern: /cmp\.osano\.com/, vendor: "Osano" },
  { pattern: /app\.usercentrics\.eu|web\.cmp\.usercentrics\.eu/, vendor: "Usercentrics" },
  { pattern: /sdk\.privacy-center\.org/, vendor: "Didomi" },
  { pattern: /cdn\.consentmanager\.net/, vendor: "consentmanager" },
  { pattern: /cs\.iubenda\.com/, vendor: "iubenda" },
  { pattern: /cdn\.cookie-script\.com/, vendor: "Cookie Script" },
];

/** Match a package name against a list that may contain "@scope/*" entries. */
export function matchesPackage(name: string, patterns: string[]): string | undefined {
  return patterns.find((p) => (p.endsWith("/*") ? name.startsWith(p.slice(0, -1)) : name === p));
}

/** Match an import specifier ("posthog-js/react") against package patterns. */
export function importPackageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? null);
}
