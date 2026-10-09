import { describe, expect, test } from "bun:test";

import { ConfigSchema } from "../src/config/schema";
import { runRunCommand } from "../src/commands/run";

describe("runRunCommand", () => {
  test("requires an explicit target in manual mode instead of auto-routing", async () => {
    const diagnostics: string[] = [];
    let streamCalls = 0;
    const config = ConfigSchema.parse({
      routing: { mode: "manual" },
    });

    const exitCode = await runRunCommand(
      { prompt: "fix this bug", config },
      {
        scan: async () => [],
        stream: () => {
          streamCalls += 1;
          throw new Error("stream must not be called in manual mode");
        },
        write: (text) => diagnostics.push(text),
      },
    );

    expect(exitCode).toBe(1);
    expect(diagnostics.join("")).toContain(
      "routing.mode=manual 时，非交互 run 必须显式提供 --agent 或 --model",
    );
    expect(streamCalls).toBe(0);
  });
});
