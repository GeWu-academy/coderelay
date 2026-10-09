#!/usr/bin/env bun

import {
  Command,
  InvalidArgumentError,
  type OptionValues,
} from "commander";

import { runAgentsCommand } from "./commands/agents";
import { runDoctorCommand } from "./commands/doctor";
import { runFavoriteCommand } from "./commands/favorite";
import { runModelsCommand } from "./commands/models";
import { runRunCommand } from "./commands/run";
import type { RoutingMode } from "./config/schema";
import { MODEL_STRENGTHS, type ModelStrength } from "./models/types";

import pkg from "../package.json";

const VERSION = pkg.version;

interface RunCliOptions extends OptionValues {
  readonly mode?: RoutingMode;
  readonly agent?: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly config?: string;
  readonly file?: string[];
  readonly lang?: string;
  readonly contextSize?: number;
  readonly strength?: ModelStrength[];
  readonly timeout?: number;
}

interface CommandCliOptions extends OptionValues {
  readonly cwd?: string;
  readonly config?: string;
}

function isModelStrength(value: string): value is ModelStrength {
  return (MODEL_STRENGTHS as readonly string[]).includes(value);
}

function collectModelStrength(
  value: string,
  previous: ModelStrength[],
): ModelStrength[] {
  if (!isModelStrength(value)) {
    throw new InvalidArgumentError(
      `expected one of: ${MODEL_STRENGTHS.join(", ")}`,
    );
  }
  return [...previous, value];
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("expected a positive integer");
  }
  return parsed;
}

function parseRoutingMode(value: string): RoutingMode {
  if (value === "local" || value === "manual" || value === "jev") {
    return value;
  }
  throw new InvalidArgumentError("expected one of: local, manual, jev");
}

async function applyExitCode(action: () => Promise<number>): Promise<void> {
  process.exitCode = await action();
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("coderelay")
    .description("Route coding tasks to the best available coding agent CLI.")
    .version(VERSION, "-v, --version")
    .showHelpAfterError();

  program
    .command("run")
    .description("Route a prompt to an installed coding agent CLI.")
    .argument("[prompt...]", "prompt to send to the selected agent")
    .option("-a, --agent <id>", "explicit agent; bypasses routing")
    .option("-m, --model <model>", "explicit model or agent:model reference")
    .option("-C, --cwd <path>", "working directory for scan and execution")
    .option("-c, --config <path>", "explicit config file")
    .option(
      "--file <path>",
      "request file used by routing rules (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .option("--lang <language>", "request language used by routing rules")
    .option(
      "--context-size <tokens>",
      "approximate context size used by scoring",
      parsePositiveInteger,
    )
    .option(
      "--strength <strength>",
      `required model strength: ${MODEL_STRENGTHS.join(", ")}`,
      collectModelStrength,
      [],
    )
    .option(
      "-M, --mode <mode>",
      "routing decision mode: local, manual, jev",
      parseRoutingMode,
    )
    .option(
      "--timeout <ms>",
      "terminate the selected agent after this timeout",
      parsePositiveInteger,
    )
    .action(async (promptParts: string[], options: RunCliOptions) => {
      const prompt = promptParts.join(" ").trim();
      await applyExitCode(() =>
        runRunCommand({
          prompt,
          mode: options.mode,
          agent: options.agent,
          model: options.model,
          cwd: options.cwd,
          configPath: options.config,
          files: options.file,
          language: options.lang,
          contextSize: options.contextSize,
          requiredStrengths: options.strength,
          timeoutMs: options.timeout,
        }),
      );
    });

  program
    .command("agents")
    .description("List supported agents and their availability.")
    .option("-C, --cwd <path>", "directory to start config discovery from")
    .option("-c, --config <path>", "explicit config file")
    .action(async (options: CommandCliOptions) => {
      await applyExitCode(() =>
        runAgentsCommand({
          cwd: options.cwd,
          configPath: options.config,
        }),
      );
    });

  program
    .command("models")
    .description("List configured models and routing defaults.")
    .option("-C, --cwd <path>", "directory to start config discovery from")
    .option("-c, --config <path>", "explicit config file")
    .action(async (options: CommandCliOptions) => {
      await applyExitCode(() =>
        runModelsCommand({
          cwd: options.cwd,
          configPath: options.config,
        }),
      );
    });

  program
    .command("doctor")
    .description("Check config, routing rules, and installed agent CLIs.")
    .option("-C, --cwd <path>", "directory to start config discovery from")
    .option("-c, --config <path>", "explicit config file")
    .action(async (options: CommandCliOptions) => {
      await applyExitCode(() =>
        runDoctorCommand({
          cwd: options.cwd,
          configPath: options.config,
        }),
      );
    });

  program
    .command("favorite")
    .alias("fav")
    .description("Set or show favorite initial agent stored in SQLite.")
    .argument("[agent]", "agent id (codex, claude, pi, omp)")
    .action(async (agent: string | undefined) => {
      await applyExitCode(() => runFavoriteCommand({ agent }));
    });

  return program;
}

if (import.meta.main) {
  if (process.argv.length <= 2) {
    await import("./cli.tsx");
  } else {
    await createProgram().parseAsync(process.argv);
  }
}
