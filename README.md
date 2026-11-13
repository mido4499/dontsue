# dontsue

[![npm version](https://img.shields.io/npm/v/dontsue)](https://www.npmjs.com/package/dontsue)
[![CI](https://github.com/mido4499/dontsue/actions/workflows/ci.yml/badge.svg)](https://github.com/mido4499/dontsue/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

**A fast, static-analysis pre-flight check that flags web apps and published websites collecting personal data without a privacy policy, terms of service, or cookie consent.**

> **Disclaimer:** `dontsue` is not legal advice. It flags likely compliance gaps in code and markup; it cannot confirm legal compliance.

```text
dontsue v0.1.0 — scanned 83 files in 0.1s

DATA COLLECTION DETECTED
  pii    app/components/SignUpForm.tsx:85  <input type="email">     high
  pii    app/reset-password/page.tsx:48    <input type="password">  high
  ai     package.json:20                   @anthropic-ai/sdk        medium
  auth   package.json:28                   next-auth                high
  email  package.json:32                   resend                   high

POLICIES
  ✖ Privacy policy    not found
  ✖ Terms of service  not found
  ✖ Cookie consent    not found

ISSUES
  ✖ error  missing-privacy-policy
           App collects personal data (email, credentials, user-content, account) and shares it with Anthropic and Resend, but no privacy policy route, page, or link was found.
           → Add a privacy policy page (e.g. /privacy) that discloses each data type and third party, and link it from your footer and signup forms.

  ⚠ warn   missing-terms-of-service
           App has user accounts but no terms of service were found.
           → Add a /terms page or set "termsUrl" in dontsue.config.json.

1 error, 1 warning
```

---

## Mission

Developers routinely ship apps with login forms, analytics scripts, email providers, or AI SDKs long before adding a `/privacy` page, `/terms` link, or cookie consent banner. `dontsue` exists to catch those gaps in seconds—right in your terminal, CI pipeline, or against a live URL—before users or regulators do.

---

## Installation

Requires **Node.js >= 22**.

```bash
npm install -g dontsue
# or run without installing
npx dontsue
```

---

## Usage

### Interactive Mode

Run `dontsue` with no arguments to choose between scanning a **live website** or a **dev project**:

```bash
dontsue
```

```text
What would you like to scan?
  1) live website (enter URL)
  2) dev project (enter local directory)
Choose [1/2] (live website / dev project):
```

### Direct CLI

```bash
# Scan a local project directory
dontsue ./my-app

# Scan the front-end of a published website
dontsue https://example.com

# Machine-readable JSON output
dontsue ./my-app --format json

# Exit 1 on warnings as well as errors (great for CI)
dontsue ./my-app --fail-on warn

# Always exit 0 (report only)
dontsue ./my-app --fail-on never

# Use a custom config file
dontsue ./my-app --config ./dontsue.config.json
```

**Exit codes:**
- `0`: No blocking issues found (or `--fail-on never`)
- `1`: Issues found matching `--fail-on` (`error` by default, or `warn`)
- `2`: Invalid CLI usage, config error, or unreachable/missing target

### Programmatic API

```ts
import { scan, scanWebsite, formatPretty, formatJson } from "dontsue";

// Local project
const projectReport = await scan("./my-app");

// Live website front-end
const webReport = await scanWebsite("https://example.com", {
  maxPages: 15,
  maxScripts: 10,
  timeoutMs: 10_000,
});

console.log(formatPretty(projectReport));
```

---

## Technical Architecture

`dontsue` separates **parsing**, **rule evaluation**, **policy detection**, and **reporting** so the exact same rules apply whether scanning local source files or a published website:

1. **Fact Extraction (`src/parsers/`)**
   - **Markup (`htmlparser2`):** Parses `.html`, `.vue`, `.svelte`, `.astro`, and fetched web pages into normalized `ElementFact`s (tags, attributes, link text) and extracts inline `<script>` blocks.
   - **JavaScript / TypeScript (`@babel/parser`):** Parses `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` into AST-backed facts: JSX elements, imports, function calls, member expressions, and string literals.
   - **Dependencies:** Inspects `package.json` (`dependencies`, `devDependencies`, `optionalDependencies`) in local projects.

2. **Collector Rules (`src/rules/collectors.ts`)**
   Detects data collection across 8 categories with `high`, `medium`, or `low` confidence:
   - `pii`: Email, password, telephone, name, and address inputs
   - `tracking`: Google Analytics / GTM, Meta Pixel, Segment, Mixpanel, PostHog, etc.
   - `auth`: `next-auth`, `@auth/*`, Clerk, Auth0, Supabase Auth, Firebase Auth, etc.
   - `payment`: Stripe, PayPal, Braintree, Paddle, Lemon Squeezy, etc.
   - `ai`: OpenAI, Anthropic, Google Gemini SDKs, etc.
   - `email`: Resend, SendGrid, Postmark, Nodemailer, etc.
   - `location` & `device`: Geolocation (`navigator.geolocation`) and media capture (`getUserMedia`)

3. **Policy Detection (`src/rules/policies.ts`)**
   - **Routes & URL paths:** Detects `/privacy`, `/privacy-policy`, `/terms`, `/tos`, `/legal`, and framework route files (`app/privacy/page.tsx`, `pages/terms.astro`, etc.).
   - **Links:** Inspects `<a>`, `<Link>`, and `<router-link>` elements for privacy/terms URLs and anchor text.
   - **Consent Management Platforms (CMPs):** Detects Cookiebot, OneTrust, Termly, Osano, Usercentrics, Didomi, iubenda, Cookie Script, and npm consent packages.

4. **Live Website Crawler (`src/web.ts`)**
   - Fetches the target URL over HTTP(S) and crawls same-origin HTML pages up to `maxPages` (default `15`), prioritizing auth, form, and policy routes (`/login`, `/signup`, `/contact`, `/privacy`, `/terms`, `/legal`).
   - Fetches same-origin external `<script src="...">` bundles up to `maxScripts` (default `10`) and runs them through the JS parser.
   - Skips non-HTML assets and gracefully records non-200 secondary pages in `report.skipped`.

---

## Configuration

Create a `dontsue.config.json` in your project root (or pass `--config <file>`):

```json
{
  "privacyPolicyUrl": "https://example.com/privacy",
  "termsUrl": "https://example.com/terms",
  "cookieConsent": true,
  "ignore": ["legacy/**"],
  "rules": {
    "pii/phone-field": "off"
  }
}
```

You can also suppress false positives inline in source files:
- `// dontsue-ignore` — ignores findings on the current and next line
- `// dontsue-ignore-file` — ignores the entire file

---

## Limitations

- **Not a legal audit:** `dontsue` checks for the *presence and linking* of a privacy policy, terms of service, and cookie consent mechanism—not whether the legal text accurately discloses every data processor or satisfies GDPR/CCPA/CPRA requirements.
- **No headless browser for live sites:** `scanWebsite` inspects fetched HTML and same-origin `<script>` files without executing JavaScript in a browser. Pure client-rendered SPAs (e.g., React/Vite without SSR) compile `<input>` and `<a>` tags into `jsx()`/`createElement()` calls rather than HTML markup, so dynamically rendered forms or footer links may not be detected from a live URL alone (use local source scanning for full SPA coverage).
- **No backend visibility from public URLs:** Server-only SDKs (e.g., `@anthropic-ai/sdk`, `resend`, `nodemailer`, database writes) live in backend code and `package.json`, which are not exposed on a published website.
- **JS/TS/HTML ecosystem focus:** Local project scanning targets JavaScript, TypeScript, HTML, Vue, Svelte, and Astro projects. Non-JS backends (Python, Go, Rust, etc.) are not analyzed.
- **Runtime & tag-manager blind spots:** Scripts injected dynamically at runtime via a tag manager (such as GTM) or conditional server responses cannot be observed statically; use `dontsue.config.json` to declare external policies or consent handlers.

---

## License

[MIT](./LICENSE)
