#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { ConfigError } from "./config.js";
import { formatJson } from "./reporters/json.js";
import { formatPretty } from "./reporters/pretty.js";
import { ScanError, VERSION, scan } from "./scan.js";
import type { Report } from "./types.js";

export const EXIT_OK = 0;
export const EXIT_ISSUES = 1;
export const EXIT_CRASH = 2;

function oneOf<T extends string>(values: readonly T[]) {
  return (v: string): T => {
    if (!values.includes(v as T)) throw new InvalidArgumentError(`Expected one of: ${values.join(", ")}`);
    return v as T;
  };
}

export function exitCodeFor(report: Report, failOn: "error" | "warn" | "never"): number {
  if (failOn === "never") return EXIT_OK;
  if (report.summary.errors > 0) return EXIT_ISSUES;
  if (failOn === "warn" && report.summary.warnings > 0) return EXIT_ISSUES;
  return EXIT_OK;
}

const program = new Command()
  .name("dontsue")
  .description("Flag apps that collect personal data without a privacy policy, terms, or cookie consent.")
  .version(VERSION)
  .argument("[path]", "project directory to scan", ".")
  .option("-f, --format <format>", "output format: pretty | json", oneOf(["pretty", "json"] as const), "pretty")
  .option("--fail-on <level>", "exit 1 on: error | warn | never", oneOf(["error", "warn", "never"] as const), "error")
  .option("-c, --config <file>", "path to config file (default: <path>/dontsue.config.json)")
  .option("--no-color", "disable colored output")
  .exitOverride((err) => {
    // --help and --version exit 0; argument errors are a usage problem.
    process.exit(err.exitCode === 0 ? EXIT_OK : EXIT_CRASH);
  })
  .action(async (target: string, opts: { format: "pretty" | "json"; failOn: "error" | "warn" | "never"; config?: string; color: boolean }) => {
    try {
      const report = await scan(target, { configPath: opts.config });
      const color = opts.color && !process.env.NO_COLOR && process.stdout.isTTY === true;
      process.stdout.write((opts.format === "json" ? formatJson(report) : formatPretty(report, { color })) + "\n");
      process.exitCode = exitCodeFor(report, opts.failOn);
    } catch (e) {
      const expected = e instanceof ScanError || e instanceof ConfigError;
      process.stderr.write(`dontsue: ${expected ? (e as Error).message : (e as Error).stack}\n`);
      process.exitCode = EXIT_CRASH;
    }
  });

await program.parseAsync();
