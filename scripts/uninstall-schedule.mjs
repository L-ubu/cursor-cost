#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const label = "com.lubu.cursor-cost";
const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);

try {
  execSync(`launchctl bootout gui/$(id -u) "${plistPath}" 2>/dev/null || true`, {
    shell: "/bin/bash",
  });
} catch {
  // ignore
}
if (fs.existsSync(plistPath)) {
  fs.unlinkSync(plistPath);
  console.log(`Removed ${plistPath}`);
} else {
  console.log("LaunchAgent not installed.");
}
