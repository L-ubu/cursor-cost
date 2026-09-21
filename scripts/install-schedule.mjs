#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const label = "com.lubu.cursor-cost";
const plistPath = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${label}.plist`,
);
const logDir = path.join(root, "data", "logs");
const runScript = path.join(root, "src", "fetch.mjs");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${runScript}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${root}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>8</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(logDir, "fetch.out.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logDir, "fetch.err.log")}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
`;

fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(path.dirname(plistPath), { recursive: true });
fs.writeFileSync(plistPath, plist, "utf8");

try {
  execSync(
    `launchctl bootout gui/$(id -u) "${plistPath}" 2>/dev/null || true`,
    {
      shell: "/bin/bash",
    },
  );
  execSync(`launchctl bootstrap gui/$(id -u) "${plistPath}"`, {
    shell: "/bin/bash",
  });
  console.log(`Installed LaunchAgent → ${plistPath}`);
  console.log(
    "Runs daily at 08:30 — npm run fetch (session keep-alive + usage sync)",
  );
} catch (e) {
  console.error("launchctl failed:", e.message);
  console.log(`Plist written to ${plistPath} — load manually if needed.`);
}
