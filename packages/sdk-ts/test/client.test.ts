import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CoderelayClient } from "../src";
import packageManifest from "../package.json";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-host.ts", import.meta.url));
const clients: CoderelayClient[] = [];

function client(...args: string[]): CoderelayClient {
  const instance = new CoderelayClient({
    command: process.execPath,
    args: [FIXTURE, ...args],
  });
  clients.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((instance) => instance.close()));
});

describe("CoderelayClient", () => {
  test("performs typed requests and preserves camelCase fields", async () => {
    const sdk = client();
    const [status, discovery] = await Promise.all([
      sdk.status(),
      sdk.discoverAgents({ cwd: "/fixture/workspace" }),
    ]);

    expect(status.coreVersion).toBe(packageManifest.version);
    expect(status.protocolVersion).toBe(1);
    expect(status.transport).toBe("stdio");
    expect(discovery.defaultAgent).toBe("codex");
    expect(discovery.detected[0]?.candidates[0]?.path).toBe("/fixture/codex");
  });

  test("retries startup after a missing working directory is created", async () => {
    const root = await mkdtemp(join(tmpdir(), "coderelay-sdk-"));
    const cwd = join(root, "workspace");
    const sdk = new CoderelayClient({
      command: process.execPath,
      args: [FIXTURE],
      cwd,
    });

    try {
      await expect(sdk.status()).rejects.toThrow();
      await mkdir(cwd);
      expect((await sdk.status()).transport).toBe("stdio");
    } finally {
      await sdk.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("buffers run events even when they arrive before the caller receives the handle", async () => {
    const sdk = client();
    const run = await sdk.run({
      request: { prompt: "say hello" },
      mode: "manual",
      agent: "codex",
      model: "gpt-5",
    });

    expect(run.runId).toBe("run-fixture");
    expect(run.sessionId).toBe("session-fixture");
    expect(run.model).toBe("gpt-5");

    const observed: string[] = [];
    for await (const event of run) {
      if (event.kind === "assistant_text") {
        observed.push(event.text);
      }
    }
    expect(observed).toEqual(["hello ", "sdk"]);

    const result = await run.completed;
    expect(result.status).toBe("completed");
    expect(result.code).toBe(0);
    expect(result.text).toBe("hello sdk");
  });

  test("delegates cancellation to the host", async () => {
    const sdk = client();
    const response = await sdk.cancelRun("run-fixture");
    expect(response.cancelled).toBe(true);
  });

  test("rejects unfinished runs after the host exits and preserves buffered output", async () => {
    const sdk = client("--exit-during-run");
    const run = await sdk.run({ request: { prompt: "say hello" } });
    const iterator = run[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: "assistant_text", text: "hello " },
    });
    await expect(run.completed).rejects.toThrow("CodeRelay host exited (23)");
    await expect(iterator.next()).rejects.toThrow("fixture interrupted");
    expect((await sdk.status()).transport).toBe("stdio");
  }, 2_000);

  test("closing rejects run and request waiters without affecting a restarted host", async () => {
    const sdk = client("--hold-run");
    const run = await sdk.run({ request: { prompt: "say hello" } });
    const iterator = run[Symbol.asyncIterator]();
    await iterator.next();
    const output = iterator.next();
    const completion = run.completed;
    const request = sdk.listRecentWorkspaces();
    const pending = request;
    await Promise.resolve();
    await sdk.close();
    await expect(output).rejects.toThrow("CodeRelay client closed");
    await expect(completion).rejects.toThrow("CodeRelay client closed");
    await expect(pending).rejects.toThrow("CodeRelay client closed");
    expect((await sdk.status()).transport).toBe("stdio");
  }, 2_000);
});
