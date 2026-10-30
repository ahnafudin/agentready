import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const roots = [];
const fixtureParent = resolve(tmpdir());
const fixturePrefix = "tooling-version-lock-";
after(() => {
  for (const root of roots) {
    const target = resolve(root);
    assert.equal(dirname(target), fixtureParent, `refusing cleanup outside ${fixtureParent}`);
    assert.ok(basename(target).startsWith(fixturePrefix), `refusing cleanup of an unowned directory: ${target}`);
    rmSync(target, { recursive: true, force: true });
  }
});

function fixture(lock) {
  const root = mkdtempSync(join(fixtureParent, fixturePrefix));
  roots.push(root);
  cpSync(fileURLToPath(new URL("../", import.meta.url)), join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "fixture", version: "1.2.3", type: "module", tooling: { gates: { lint: "node --version" } },
  }));
  if (lock !== undefined) writeFileSync(join(root, "package-lock.json"), typeof lock === "string" ? lock : JSON.stringify(lock));
  return root;
}

function run(root, script, ...args) {
  return spawnSync(process.execPath, [join(root, "scripts", script), ...args], { cwd: root, encoding: "utf8" });
}

const lockfile = (version = "1.2.3", projectVersion = "1.2.3", lockfileVersion = 3) => ({
  version, lockfileVersion, packages: { "": { version: projectVersion }, "node_modules/example": { version: "0.1.0" } },
});

describe("version-lock CLI integration", () => {
  it("includes the lockfile in the hook's manifest list and synchronizes it on a bump", () => {
    const root = fixture(lockfile());
    const listed = run(root, "version.mjs", "manifests");
    assert.equal(listed.status, 0, listed.stderr);
    assert.ok(listed.stdout.split(/\r?\n/).includes("package-lock.json"));
    const bumped = run(root, "version.mjs", "patch");
    assert.equal(bumped.status, 0, bumped.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "1.2.4");
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")), lockfile("1.2.4", "1.2.4"));
  });

  it("accepts an absent optional lockfile without creating one", () => {
    const root = fixture();
    const result = run(root, "check-version-sync.mjs");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(root, "package-lock.json")), false);
  });

  for (const version of [2, 3]) {
    it(`accepts synchronized v${version} lockfiles`, () => {
      const result = run(fixture(lockfile("1.2.3", "1.2.3", version)), "check-version-sync.mjs");
      assert.equal(result.status, 0, result.stderr);
    });
  }

  for (const [field, lock] of [["root", lockfile("0.1.0")], ["root package", lockfile("1.2.3", "0.1.0")]]) {
    it(`rejects ${field} version drift without writing either manifest`, () => {
      const root = fixture(lock);
      const pkgBefore = readFileSync(join(root, "package.json"), "utf8");
      const lockBefore = readFileSync(join(root, "package-lock.json"), "utf8");
      const result = run(root, "check-version-sync.mjs");
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /package-lock\.json/);
      assert.match(result.stderr, /version:sync/);
      assert.equal(readFileSync(join(root, "package.json"), "utf8"), pkgBefore);
      assert.equal(readFileSync(join(root, "package-lock.json"), "utf8"), lockBefore);
    });
  }

  for (const [name, lock] of [
    ["malformed JSON", "{ invalid"],
    ["an unsupported future lockfile version", lockfile("1.2.3", "1.2.3", 4)],
    ["a missing root version", { lockfileVersion: 3, packages: { "": { version: "1.2.3" } } }],
    ["a missing root-package version", { version: "1.2.3", lockfileVersion: 3, packages: { "": {} } }],
  ]) {
    it(`rejects ${name} in an existing lockfile with a repair instruction`, () => {
      const result = run(fixture(lock), "check-version-sync.mjs");
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /package-lock\.json/);
      assert.match(result.stderr, /regenerate/i);
    });
  }

  it("leaves unsupported v1 lockfiles alone", () => {
    const root = fixture({ version: "0.1.0", lockfileVersion: 1, dependencies: { example: { version: "0.1.0" } } });
    const before = readFileSync(join(root, "package-lock.json"), "utf8");
    const result = run(root, "check-version-sync.mjs");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /v1.*skip/i);
    assert.equal(readFileSync(join(root, "package-lock.json"), "utf8"), before);
  });

  it("rejects a package manifest with no canonical version even when the lockfile is absent", () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    const result = run(root, "check-version-sync.mjs");
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /package\.json.*version/);
  });

  it("keeps the drift guard after stack regeneration and stops before application gates", () => {
    const root = fixture(lockfile("0.1.0"));
    const applied = run(root, "stacks.mjs", "apply");
    assert.equal(applied.status, 0, applied.stderr);
    const result = run(root, "gate.mjs");
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /FAILED at `version-sync`/);
    assert.doesNotMatch(result.stderr, /\$ npm run lint/);
  });
});
