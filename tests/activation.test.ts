import { describe, expect, test } from "bun:test";

import {
  activationConfirmTargets,
  activationManageTargets,
  pendingActivation,
  toActivationOptions,
  type ActivationOption,
} from "../src/config/activation";
import { defaultConfig } from "../src/config/schema";
import { CLI_IDS, type CliId, type DetectedCli } from "../src/models/cli";

const DETECTED: DetectedCli[] = [
  { id: "codex", bin: "codex", path: "/bin/codex", version: "1", available: true },
  { id: "claude", bin: "claude", path: "/bin/claude", version: "1", available: true },
  { id: "pi", bin: "pi", path: "", version: null, available: false },
  { id: "omp", bin: "omp", path: "/bin/omp", version: "1", available: true },
];

function option(
  overrides: Partial<ActivationOption> & { readonly cliId: CliId },
): ActivationOption {
  return { available: true, enabled: true, decided: false, ...overrides };
}

describe("toActivationOptions", () => {
  test("covers every CLI in a stable order", () => {
    const options = toActivationOptions(DETECTED, defaultConfig());
    expect(options.map((item) => item.cliId)).toEqual([...CLI_IDS]);
  });

  test("a CLI with no config entry is available but undecided", () => {
    const options = toActivationOptions(DETECTED, defaultConfig());
    expect(options.find((item) => item.cliId === "codex")).toEqual({
      cliId: "codex",
      available: true,
      enabled: true,
      decided: false,
    });
  });

  test("availability comes from the scan, not the config", () => {
    const options = toActivationOptions(DETECTED, defaultConfig());
    expect(options.find((item) => item.cliId === "pi")?.available).toBe(false);
  });

  test("activationDecided marks an enabled CLI as decided", () => {
    const config = defaultConfig();
    config.agents["omp"] = {
      enabled: true,
      activationDecided: true,
      models: [],
      extraArgs: [],
      env: {},
    };
    const row = toActivationOptions(DETECTED, config).find((item) => item.cliId === "omp");
    expect(row).toMatchObject({ enabled: true, decided: true });
  });

  test("enabled: false counts as a decision even without the flag", () => {
    // 手写 `enabled: false` 的用户已经表过态，重启后不该再被问一次。
    const config = defaultConfig();
    config.agents["omp"] = {
      enabled: false,
      activationDecided: false,
      models: [],
      extraArgs: [],
      env: {},
    };
    const row = toActivationOptions(DETECTED, config).find((item) => item.cliId === "omp");
    expect(row).toMatchObject({ enabled: false, decided: true });
  });
});

describe("pendingActivation", () => {
  test("is non-empty only for available-and-undecided CLIs", () => {
    const options: ActivationOption[] = [
      option({ cliId: "codex" }),
      option({ cliId: "claude", decided: true }),
      option({ cliId: "pi", available: false }),
      option({ cliId: "omp", available: false }),
    ];
    expect(pendingActivation(options).map((item) => item.cliId)).toEqual(["codex"]);
  });

  test("is empty once every available CLI has been decided", () => {
    const options: ActivationOption[] = CLI_IDS.map((cliId) => option({ cliId, decided: true }));
    expect(pendingActivation(options)).toHaveLength(0);
  });

  test("an uninstalled undecided CLI never triggers the prompt", () => {
    const options: ActivationOption[] = [
      option({ cliId: "codex", decided: true }),
      option({ cliId: "claude", decided: true }),
      option({ cliId: "pi", available: false, decided: false }),
      option({ cliId: "omp", decided: true }),
    ];
    expect(pendingActivation(options)).toHaveLength(0);
  });
});

describe("activation page targets", () => {
  const options: ActivationOption[] = [
    option({ cliId: "codex", decided: true }),
    option({ cliId: "claude" }),
    option({ cliId: "pi", available: false }),
    option({ cliId: "omp", available: false, decided: true }),
  ];

  test("the first-run page shows only usable, undecided CLIs", () => {
    expect(activationConfirmTargets(options).map((item) => item.cliId)).toEqual(["claude"]);
  });

  test("the /activate page shows every CLI so any can be re-enabled", () => {
    expect(activationManageTargets(options).map((item) => item.cliId)).toEqual([...CLI_IDS]);
  });

  test("the /activate page does not share the first-run page's filtering", () => {
    // 管理页必须能看到每个 CLI：已禁用和未安装的行也要出现，否则无法重新启用。
    const disabled = options.map((item) => ({ ...item, enabled: false }));
    expect(activationConfirmTargets(disabled).map((item) => item.cliId)).toEqual(["claude"]);
    expect(activationManageTargets(disabled)).toHaveLength(4);
  });
});
