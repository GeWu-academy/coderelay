const ROOT = new URL("../", import.meta.url);

interface PackageManifest {
  readonly version?: unknown;
}

interface TauriManifest {
  readonly version?: unknown;
}

function requireVersion(value: unknown, source: string): string {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${source} does not contain a valid semantic version`);
  }
  return value;
}

async function readJson(path: URL): Promise<unknown> {
  return JSON.parse(await Bun.file(path).text()) as unknown;
}

const root = (await readJson(new URL("package.json", ROOT))) as PackageManifest;
const sdk = (await readJson(new URL("packages/sdk-ts/package.json", ROOT))) as PackageManifest;
const cargo = await Bun.file(new URL("Cargo.toml", ROOT)).text();
const workspaceSection = cargo.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
const cargoVersion = workspaceSection.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
const tauriConfigUrl = new URL("apps/desktop/src-tauri/tauri.conf.json", ROOT);
const tauri = (await readJson(tauriConfigUrl)) as TauriManifest;
if (typeof tauri.version !== "string" || tauri.version.trim().length === 0) {
  throw new Error("tauri.conf.json does not contain a version or version reference");
}
const tauriVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tauri.version)
  ? tauri.version
  : requireVersion(
      ((await readJson(new URL(tauri.version, tauriConfigUrl))) as PackageManifest).version,
      "version referenced by tauri.conf.json",
    );

const versions = {
  root: requireVersion(root.version, "package.json"),
  sdk: requireVersion(sdk.version, "packages/sdk-ts/package.json"),
  cargo: requireVersion(cargoVersion, "Cargo.toml [workspace.package]"),
  tauri: requireVersion(tauriVersion, "tauri.conf.json"),
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1) {
  console.error("Version mismatch:", versions);
  process.exit(1);
}

const version = Object.values(versions)[0];
if (version === undefined) {
  throw new Error("unable to resolve product version");
}

console.log(`versions aligned: ${version}`);
