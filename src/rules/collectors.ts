import type { Category, Confidence, ElementFact, Requirement } from "../types.js";

export interface ElementMatch {
  evidence: string;
  confidence: Confidence;
}

/**
 * A rule that detects data collection. Every matcher is optional; a rule
 * fires if any of them match.
 */
export interface CollectorRule {
  id: string;
  category: Category;
  dataTypes: string[];
  requires: Requirement[];
  confidence: Confidence;
  vendor?: string;
  /** Package names. A trailing "/*" matches a whole scope: "@clerk/*". Also matched against imports. */
  dependencies?: string[];
  /** Tested against string literals and HTML attribute values (e.g. script src). */
  strings?: RegExp[];
  /** Bare function calls, e.g. "gtag". */
  calls?: string[];
  /** Member path prefixes, e.g. "navigator.geolocation". */
  members?: string[];
  /** Custom element matcher, for forms and framework components. */
  element?: (el: ElementFact) => ElementMatch | null;
}

const TRACKING: Requirement[] = ["privacy-policy", "cookie-consent"];
const ACCOUNT: Requirement[] = ["privacy-policy", "terms-of-service"];
const PRIVACY: Requirement[] = ["privacy-policy"];

// ---------------------------------------------------------------------------
// Tracking / analytics
// ---------------------------------------------------------------------------

const trackers: CollectorRule[] = [
  {
    id: "tracker/google-analytics",
    vendor: "Google Analytics",
    category: "tracking",
    dataTypes: ["device-id", "usage", "ip-address"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["react-ga", "react-ga4", "ga-4-react", "vue-gtag", "@analytics/google-analytics", "ngx-google-analytics"],
    strings: [/googletagmanager\.com\/gtag/, /google-analytics\.com\/(analytics|ga)\.js/],
    calls: ["gtag"],
    element: (el) =>
      el.name === "GoogleAnalytics" ? { evidence: `<GoogleAnalytics> component`, confidence: "high" } : null,
  },
  {
    id: "tracker/google-tag-manager",
    vendor: "Google Tag Manager",
    category: "tracking",
    dataTypes: ["device-id", "usage", "ip-address"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["react-gtm-module", "@gtm-support/vue-gtm"],
    strings: [/googletagmanager\.com\/gtm\.js/, /googletagmanager\.com\/ns\.html/],
    element: (el) =>
      el.name === "GoogleTagManager" ? { evidence: `<GoogleTagManager> component`, confidence: "high" } : null,
  },
  {
    id: "tracker/next-third-parties",
    vendor: "Google (via @next/third-parties)",
    category: "tracking",
    dataTypes: ["device-id", "usage"],
    requires: TRACKING,
    // The package also ships YouTube/Maps embeds, so the dependency alone is only a hint.
    confidence: "medium",
    dependencies: ["@next/third-parties"],
  },
  {
    id: "tracker/meta-pixel",
    vendor: "Meta Pixel",
    category: "tracking",
    dataTypes: ["device-id", "usage", "ad-attribution"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["react-facebook-pixel", "@bettercart/react-facebook-pixel"],
    strings: [/connect\.facebook\.net\/[^"']*fbevents\.js/],
    calls: ["fbq"],
  },
  {
    id: "tracker/tiktok-pixel",
    vendor: "TikTok Pixel",
    category: "tracking",
    dataTypes: ["device-id", "usage", "ad-attribution"],
    requires: TRACKING,
    confidence: "high",
    strings: [/analytics\.tiktok\.com/],
    members: ["ttq.track", "ttq.page", "ttq.load"],
  },
  {
    id: "tracker/linkedin-insight",
    vendor: "LinkedIn Insight Tag",
    category: "tracking",
    dataTypes: ["device-id", "ad-attribution"],
    requires: TRACKING,
    confidence: "high",
    strings: [/snap\.licdn\.com/],
  },
  {
    id: "tracker/posthog",
    vendor: "PostHog",
    category: "tracking",
    dataTypes: ["device-id", "usage"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["posthog-js", "posthog-node", "posthog-react-native"],
  },
  {
    id: "tracker/mixpanel",
    vendor: "Mixpanel",
    category: "tracking",
    dataTypes: ["device-id", "usage"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["mixpanel", "mixpanel-browser", "mixpanel-react-native"],
  },
  {
    id: "tracker/amplitude",
    vendor: "Amplitude",
    category: "tracking",
    dataTypes: ["device-id", "usage"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["amplitude-js", "@amplitude/*"],
  },
  {
    id: "tracker/segment",
    vendor: "Segment",
    category: "tracking",
    dataTypes: ["device-id", "usage"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["@segment/analytics-next", "@segment/analytics-node", "analytics-node", "@segment/analytics-react-native"],
    strings: [/cdn\.segment\.com/],
  },
  {
    id: "tracker/heap",
    vendor: "Heap",
    category: "tracking",
    dataTypes: ["device-id", "usage"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["@heap/heap-node", "reactjs-heap"],
    strings: [/cdn\.heapanalytics\.com/],
  },
  {
    id: "tracker/matomo",
    vendor: "Matomo",
    category: "tracking",
    dataTypes: ["device-id", "usage"],
    requires: TRACKING,
    confidence: "high",
    dependencies: ["@datapunt/matomo-tracker-react", "@jonkoops/matomo-tracker-react", "vue-matomo"],
    members: ["_paq.push"],
  },
  {
    id: "tracker/session-replay",
    category: "tracking",
    dataTypes: ["session-recording", "usage", "device-id"],
    requires: TRACKING,
    confidence: "high",
    vendor: "Session replay (Hotjar, FullStory, LogRocket, Clarity)",
    dependencies: ["@hotjar/browser", "react-hotjar", "@fullstory/browser", "@fullstory/react-native", "logrocket", "@microsoft/clarity"],
    strings: [/static\.hotjar\.com/, /www\.clarity\.ms\/tag/, /edge\.fullstory\.com/, /cdn\.logrocket\.(io|com)/],
  },
  {
    id: "tracker/error-monitoring",
    vendor: "Error monitoring (Sentry, Datadog RUM, Bugsnag)",
    category: "tracking",
    dataTypes: ["ip-address", "device-info"],
    // Usually justified as legitimate interest, so disclosure is needed but not consent.
    requires: PRIVACY,
    confidence: "medium",
    dependencies: ["@sentry/*", "@datadog/browser-rum", "@bugsnag/js", "@bugsnag/browser"],
  },
];

// ---------------------------------------------------------------------------
// Accounts and payments
// ---------------------------------------------------------------------------

const accounts: CollectorRule[] = [
  {
    id: "auth/auth-library",
    vendor: "Authentication library",
    category: "auth",
    dataTypes: ["email", "account"],
    requires: ACCOUNT,
    confidence: "high",
    dependencies: [
      "next-auth", "@auth/*", "@clerk/*", "@auth0/*", "better-auth", "lucia", "passport",
      "@kinde-oss/*", "@workos-inc/authkit-nextjs", "@stackframe/stack", "aws-amplify",
    ],
  },
  {
    id: "auth/backend-sdk",
    vendor: "Backend SDK with auth (Firebase, Supabase, Appwrite)",
    category: "auth",
    dataTypes: ["email", "account"],
    requires: ACCOUNT,
    // These SDKs are used for more than auth, so they only suggest accounts exist.
    confidence: "medium",
    dependencies: ["firebase", "firebase-admin", "@supabase/supabase-js", "@supabase/ssr", "appwrite", "pocketbase"],
  },
  {
    id: "payment/payment-provider",
    vendor: "Payment provider",
    category: "payment",
    dataTypes: ["payment", "billing-address"],
    requires: ACCOUNT,
    confidence: "high",
    dependencies: [
      "stripe", "@stripe/stripe-js", "@stripe/react-stripe-js", "@paypal/*", "braintree", "braintree-web",
      "@lemonsqueezy/lemonsqueezy.js", "@paddle/paddle-js", "@polar-sh/sdk",
    ],
    strings: [/js\.stripe\.com/, /paypal\.com\/sdk\/js/],
  },
];

// ---------------------------------------------------------------------------
// Third-party processors: AI and email providers receive user data and must
// be disclosed in the privacy policy.
// ---------------------------------------------------------------------------

function processor(
  id: string,
  vendor: string,
  category: "ai" | "email",
  confidence: Confidence,
  dependencies: string[],
  strings: RegExp[] = [],
): CollectorRule {
  const dataTypes = category === "ai" ? ["user-content"] : ["email"];
  const rule: CollectorRule = { id, vendor, category, dataTypes, requires: PRIVACY, confidence, dependencies };
  if (strings.length) rule.strings = strings;
  return rule;
}

// AI SDKs are sometimes used on non-personal data (e.g. internal tooling), so medium.
const ai: CollectorRule[] = [
  processor("ai/anthropic", "Anthropic", "ai", "medium", ["@anthropic-ai/sdk", "@ai-sdk/anthropic", "@langchain/anthropic"], [/api\.anthropic\.com/]),
  processor("ai/openai", "OpenAI", "ai", "medium", ["openai", "@ai-sdk/openai", "@langchain/openai"], [/api\.openai\.com/]),
  processor(
    "ai/google-gemini",
    "Google Gemini",
    "ai",
    "medium",
    ["@google/genai", "@google/generative-ai", "@ai-sdk/google", "@langchain/google-genai"],
    [/generativelanguage\.googleapis\.com/],
  ),
  processor("ai/mistral", "Mistral", "ai", "medium", ["@mistralai/mistralai", "@ai-sdk/mistral"], [/api\.mistral\.ai/]),
  processor("ai/groq", "Groq", "ai", "medium", ["groq-sdk", "@ai-sdk/groq"], [/api\.groq\.com/]),
  processor("ai/cohere", "Cohere", "ai", "medium", ["cohere-ai", "@ai-sdk/cohere"], [/api\.cohere\.(ai|com)/]),
  processor("ai/replicate", "Replicate", "ai", "medium", ["replicate"], [/api\.replicate\.com/]),
  processor("ai/openrouter", "OpenRouter", "ai", "medium", ["@openrouter/ai-sdk-provider"], [/openrouter\.ai\/api/]),
];

// Sending email always means handing the recipient's address to the provider.
const email: CollectorRule[] = [
  processor("email/resend", "Resend", "email", "high", ["resend"], [/api\.resend\.com/]),
  processor("email/sendgrid", "SendGrid", "email", "high", ["@sendgrid/mail", "@sendgrid/client"], [/api\.sendgrid\.com/]),
  processor("email/postmark", "Postmark", "email", "high", ["postmark"], [/api\.postmarkapp\.com/]),
  processor("email/mailgun", "Mailgun", "email", "high", ["mailgun.js", "mailgun-js"], [/api\.(eu\.)?mailgun\.net/]),
  processor("email/brevo", "Brevo", "email", "high", ["@getbrevo/brevo", "sib-api-v3-sdk"], [/api\.(brevo|sendinblue)\.com/]),
  processor("email/mailchimp", "Mailchimp", "email", "high", ["@mailchimp/mailchimp_marketing", "@mailchimp/mailchimp_transactional"], [/\.api\.mailchimp\.com/, /mandrillapp\.com\/api/]),
  processor("email/aws-ses", "Amazon SES", "email", "high", ["@aws-sdk/client-ses", "@aws-sdk/client-sesv2"]),
  processor("email/loops", "Loops", "email", "high", ["loops"], [/app\.loops\.so\/api/]),
  // SMTP: the provider is configured at runtime, so we know email is sent but not to whom.
  processor("email/smtp", "SMTP email provider", "email", "medium", ["nodemailer"]),
];

// ---------------------------------------------------------------------------
// Device APIs
// ---------------------------------------------------------------------------

const device: CollectorRule[] = [
  {
    id: "location/geolocation",
    category: "location",
    dataTypes: ["precise-location"],
    requires: PRIVACY,
    confidence: "medium",
    members: ["navigator.geolocation"],
  },
  {
    id: "device/camera-microphone",
    category: "device",
    dataTypes: ["camera", "microphone"],
    requires: PRIVACY,
    confidence: "medium",
    members: ["navigator.mediaDevices.getUserMedia", "navigator.getUserMedia"],
  },
];

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const FIELD_COMPONENT = /(^|\.)([A-Z]\w*)?(Input|Field)$/;

function isFormField(el: ElementFact): boolean {
  if (el.attrs.type === "hidden") return false;
  return el.name === "input" || el.name === "textarea" || el.name === "select" || FIELD_COMPONENT.test(el.name);
}

function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** "user_email" -> "useremail" */
function norm(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface FieldSpec {
  types?: string[];
  autocomplete?: RegExp;
  names?: RegExp;
}

function fieldMatcher(spec: FieldSpec): (el: ElementFact) => ElementMatch | null {
  return (el) => {
    if (!isFormField(el)) return null;
    const tag = el.name;
    const type = str(el.attrs.type);
    if (type && spec.types?.includes(type.toLowerCase())) {
      return { evidence: `<${tag} type="${type}">`, confidence: "high" };
    }
    const ac = str(el.attrs.autocomplete) ?? str(el.attrs.autoComplete);
    if (ac && spec.autocomplete && ac.toLowerCase().split(/\s+/).some((t) => spec.autocomplete!.test(t))) {
      return { evidence: `<${tag} autocomplete="${ac}">`, confidence: "high" };
    }
    for (const attr of ["name", "id"]) {
      const v = str(el.attrs[attr]);
      if (v && spec.names?.test(norm(v))) {
        return { evidence: `<${tag} ${attr}="${v}">`, confidence: "medium" };
      }
    }
    return null;
  };
}

function formRule(id: string, dataTypes: string[], spec: FieldSpec, category: Category = "pii"): CollectorRule {
  return { id, category, dataTypes, requires: PRIVACY, confidence: "high", element: fieldMatcher(spec) };
}

const forms: CollectorRule[] = [
  formRule("pii/email-field", ["email"], { types: ["email"], autocomplete: /^email$/, names: /email/ }),
  formRule("pii/phone-field", ["phone"], { types: ["tel"], autocomplete: /^tel/, names: /phone|mobile|^tel$|telephone/ }),
  formRule("pii/name-field", ["name"], {
    autocomplete: /^(name|given-name|family-name|additional-name)$/,
    names: /^(first|last|full|given|family|sur)name$|^surname$/,
  }),
  formRule("pii/address-field", ["address"], {
    autocomplete: /^(street-address|address-line\d|address-level\d|postal-code|country|country-name)$/,
    names: /^(street|streetaddress|address(line)?\d?|postcode|postalcode|zip|zipcode|city)$/,
  }),
  formRule("pii/birthdate-field", ["birthdate"], { autocomplete: /^bday/, names: /^dob$|birth|^birthday$/ }),
  formRule("pii/government-id-field", ["government-id"], { names: /^ssn$|socialsecurity|passport|nationalid|taxid/ }),
  formRule("pii/password-field", ["credentials"], {
    types: ["password"],
    autocomplete: /^(new-password|current-password|username)$/,
  }),
  formRule("payment/card-field", ["payment"], { autocomplete: /^cc-/, names: /^(cardnumber|ccnumber|cvc|cvv)$/ }, "payment"),
];

export const collectorRules: CollectorRule[] = [...trackers, ...accounts, ...ai, ...email, ...device, ...forms];
