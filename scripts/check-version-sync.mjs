#!/usr/bin/env node
// Check optional npm lockfile versions without modifying manifests.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { isMain, parseFlags, readJson, ROOT } from "./lib/util.mjs";

const note = (message) => process.stderr.write(`[version-sync] ${message}\n`);

/** Return a gate exit code; absent and legacy v1 lockfiles have no supported pair to compare. */
export function reportVersionSync(root = ROOT) {
  const pkg = readJson(join(root, "package.json"));
  if (typeof pkg?.version !== "string") {
    note('FAILED: package.json must contain a string "version"; restore the canonical version.');
    return 1;
  }
  const lockPath = join(root, "package-lock.json");
  if (!existsSync(lockPath)) {
    note("SKIPPED: no optional package-lock.json.");
    return 0;
  }
  const lock = readJson(lockPath);
  if (lock?.lockfileVersion === 1) {
    note("npm v1 lockfile skipped; only v2/v3 project versions are synchronized.");
    return 0;
  }
  if (![2, 3].includes(lock?.lockfileVersion) || typeof lock?.version !== "string" || typeof lock?.packages?.[""]?.version !== "string") {
    note('FAILED: package-lock.json needs valid v2/v3 JSON with both project versions; regenerate it with npm install.');
    return 1;
  }
  const problems = [];
  if (lock.version !== pkg.version) problems.push(`root version is ${JSON.stringify(lock.version)}`);
  if (lock.packages[""].version !== pkg.version) problems.push(`packages[""].version is ${JSON.stringify(lock.packages[""].version)}`);
  if (problems.length) {
    note(`FAILED: package-lock.json ${problems.join("; ")}, expected ${JSON.stringify(pkg.version)} from package.json; run npm run version:sync.`);
    return 1;
  }
  note(`OK: package.json and package-lock.json agree at v${pkg.version}.`);
  return 0;
}

if (isMain(import.meta.url)) {
  const { positional, problems } = parseFlags(process.argv.slice(2));
  if (positional.length || problems.length) {
    note(problems.join("; ") || `unexpected argument: ${positional.join(" ")}`);
    process.exitCode = 2;
  } else process.exitCode = reportVersionSync();
}
