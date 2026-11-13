#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError } from "commander";
import { ConfigError } from "./config.js";
import { formatJson } from "./reporters/json.js";
import { formatPretty } from "./reporters/pretty.js";
import { ScanError, VERSION, scan } from "./scan.js";
import type { Report } from "./types.js";
import { isHttpUrl, scanWebsite } from "./web.js";

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

type TargetSelection = { mode: "website"; target: string } | { mode: "project"; target: string };

async function promptForTarget(): Promise<TargetSelection> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string | null> => {
    process.stderr.write(prompt);
    const next = await lines.next();
    return next.done ? null : next.value;
  };

  try {
    process.stderr.write("What would you like to scan?\n  1) live website (enter URL)\n  2) dev project (enter local directory)\n");
    const rawChoice = await ask("Choose [1/2] (live website / dev project): ");
    // Stdin closed immediately (e.g. non-interactive /dev/null): default to current directory.
    if (rawChoice === null) return { mode: "project", target: "." };

    const choice = rawChoice.trim().toLowerCase();
    if (choice === "1" || choice === "live" || choice === "live website" || choice === "website" || choice === "url") {
      const url = (await ask("Enter website URL: "))?.trim() ?? "";
      if (!url) throw new ScanError("No URL provided.");
      return { mode: "website", target: url };
    }

    if (choice === "2" || choice === "dev" || choice === "dev project" || choice === "project" || choice === "local" || choice === "dir") {
      const dir = (await ask("Enter project directory [.]: "))?.trim() ?? "";
      return { mode: "project", target: dir || "." };
    }

    throw new ScanError(`Invalid selection "${choice}". Choose "1" (live website) or "2" (dev project).`);
  } finally {
    rl.close();
  }
}

const program = new Command()
  .name("dontsue")
  .description("Flag apps and websites that collect personal data without a privacy policy, terms, or cookie consent.")
  .version(VERSION)
  .argument("[target]", "project directory or live website URL to scan")
  .option("-f, --format <format>", "output format: pretty | json", oneOf(["pretty", "json"] as const), "pretty")
  .option("--fail-on <level>", "exit 1 on: error | warn | never", oneOf(["error", "warn", "never"] as const), "error")
  .option("-c, --config <file>", "path to config file (default: <path>/dontsue.config.json)")
  .option("--no-color", "disable colored output")
  .exitOverride((err) => {
    // --help and --version exit 0; argument errors are a usage problem.
    process.exit(err.exitCode === 0 ? EXIT_OK : EXIT_CRASH);
  })
  .action(async (target: string | undefined, opts: { format: "pretty" | "json"; failOn: "error" | "warn" | "never"; config?: string; color: boolean }) => {
    try {
      const selected: TargetSelection = target !== undefined
        ? { mode: isHttpUrl(target) ? "website" : "project", target }
        : await promptForTarget();
      const report = selected.mode === "website"
        ? await scanWebsite(selected.target, { configPath: opts.config })
        : await scan(selected.target, { configPath: opts.config });
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
