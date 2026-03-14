#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const platform = process.platform;
const arch = process.arch;

const binaryMap = {
  "linux-x64": "docs-mirror-linux-x64",
  "linux-arm64": "docs-mirror-linux-arm64",
  "darwin-x64": "docs-mirror-darwin-x64",
  "darwin-arm64": "docs-mirror-darwin-arm64",
  "win32-x64": "docs-mirror-windows-x64.exe",
};

const key = `${platform}-${arch}`;
const binaryName = binaryMap[key];

if (!binaryName) {
  console.error(`Unsupported platform: ${platform}-${arch}`);
  console.error(`Supported: ${Object.keys(binaryMap).join(", ")}`);
  process.exit(1);
}

const binaryPath = join(__dirname, "bin", binaryName);

if (!existsSync(binaryPath)) {
  console.error(`Binary not found: ${binaryPath}`);
  console.error("Try reinstalling: npm install -g docs-mirror");
  process.exit(1);
}

try {
  execFileSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
} catch (error) {
  if (error.status !== undefined) {
    process.exit(error.status);
  }
  throw error;
}
