import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./types.js";

export const CONFIG_FILE = "dontsue.config.json";

export class ConfigError extends Error {}

export async function loadConfig(root: string, explicitPath?: string): Promise<Config> {
  const file = explicitPath ? path.resolve(explicitPath) : path.join(root, CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    if (!explicitPath && (e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ConfigError(`Could not read config ${file}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`Invalid JSON in ${file}: ${(e as Error).message}`);
  }
  return validate(parsed, file);
}

function validate(v: unknown, file: string): Config {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ConfigError(`${file} must contain a JSON object`);
  const c = v as Record<string, unknown>;
  const fail = (msg: string) => {
    throw new ConfigError(`${file}: ${msg}`);
  };
  for (const key of ["privacyPolicyUrl", "termsUrl"]) {
    if (c[key] !== undefined && typeof c[key] !== "string") fail(`"${key}" must be a string`);
  }
  if (c.cookieConsent !== undefined && typeof c.cookieConsent !== "boolean") fail(`"cookieConsent" must be a boolean`);
  if (c.ignore !== undefined && !(Array.isArray(c.ignore) && c.ignore.every((x) => typeof x === "string"))) {
    fail(`"ignore" must be an array of strings`);
  }
  if (c.rules !== undefined) {
    if (typeof c.rules !== "object" || c.rules === null) fail(`"rules" must be an object`);
    for (const [k, val] of Object.entries(c.rules as object)) if (val !== "off") fail(`rules["${k}"] must be "off"`);
  }
  return c as Config;
}
