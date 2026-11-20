import { createInterface } from "node:readline";

import { METHODS, PROTOCOL_VERSION } from "../../src/protocol";
import packageManifest from "../../package.json";

const lines = createInterface({ input: process.stdin });

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

lines.on("line", (line) => {
  let request: {
    protocolVersion: number;
    requestId: string;
    method: string;
    params?: unknown;
  };
  try {
    request = JSON.parse(line) as typeof request;
  } catch {
    return;
  }

  if (request.method === METHODS.status) {
    write({
      status: "ok",
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: {
        coreVersion: packageManifest.version,
        protocolVersion: PROTOCOL_VERSION,
        transport: "stdio",
      },
    });
    return;
  }

  if (request.method === METHODS.discoverAgents) {
    write({
      status: "ok",
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: {
        cwd: "/fixture/workspace",
        configPath: null,
        defaultAgent: "codex",
        routingModes: ["local", "manual", "jev"],
        detected: [
          {
            id: "codex",
            bin: "codex",
            path: "/fixture/codex",
            version: "1.2.3",
            available: true,
            runtime: "local",
            source: "path",
            candidates: [
              {
                path: "/fixture/codex",
                runtime: "local",
                source: "path",
                version: "1.2.3",
              },
            ],
            diagnostics: [],
          },
        ],
      },
    });
    return;
  }

  if (request.method === METHODS.startRun) {
    const runId = "run-fixture";
    const sessionId = "session-fixture";
    write({
      status: "ok",
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: {
        runId,
        sessionId,
        agent: "codex",
        model: "gpt-5",
        reasons: ["fixture route"],
      },
    });
    write({
      protocolVersion: PROTOCOL_VERSION,
      runId,
      sessionId,
      event: { kind: "assistant_text", text: "hello " },
    });
    if (process.argv.includes("--exit-during-run")) {
      process.stderr.write("fixture interrupted\n");
      process.exitCode = 23;
      lines.close();
      process.stdin.destroy();
      return;
    }
    if (process.argv.includes("--hold-run")) {
      return;
    }
    write({
      protocolVersion: PROTOCOL_VERSION,
      runId,
      sessionId,
      event: { kind: "assistant_text", text: "sdk" },
    });
    write({
      protocolVersion: PROTOCOL_VERSION,
      runId,
      sessionId,
      result: {
        status: "completed",
        code: 0,
        signal: null,
        durationMs: 25,
        timedOut: false,
        text: "hello sdk",
        stderrTail: "",
        events: [],
      },
    });
    return;
  }

  if (request.method === METHODS.listRecentWorkspaces && process.argv.includes("--hold-run")) {
    return;
  }

  if (request.method === METHODS.cancelRun) {
    write({
      status: "ok",
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: { cancelled: true },
    });
    return;
  }

  write({
    status: "error",
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    error: {
      code: "invalidRequest",
      message: `unknown method ${request.method}`,
      retryable: false,
    },
  });
});
