import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PORT, REPO_ROOT, renderTemplate } from "./paths.mjs";
import { addManagedBlock, removeManagedBlock } from "./hosts.mjs";

const LABEL = "com.spent.app";
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), "Library", "Logs", "Spent");
const DATA_DIR = path.join(REPO_ROOT, "data");
const LSOF_PATH = fs.existsSync("/usr/sbin/lsof") ? "/usr/sbin/lsof" : "lsof";

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try {
    fs.chmodSync(LOG_DIR, 0o700);
  } catch {
    // best-effort
  }
}

function writePlist() {
  // Native dependencies such as better-sqlite3 are ABI-specific. Pin the
  // service to the exact Node executable that is running this installer.
  const nodePath = process.execPath;
  const pathEnv = `${path.dirname(nodePath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  const content = renderTemplate("com.spent.app.plist", {
    nodePath,
    repoRoot: REPO_ROOT,
    dataDir: DATA_DIR,
    port: PORT,
    pathEnv,
    logDir: LOG_DIR,
  });
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, content, { mode: 0o644 });
}

function launchctl(args, opts = {}) {
  return spawnSync("launchctl", args, {
    encoding: "utf-8",
    stdio: opts.stdio ?? "pipe",
  });
}

function bootstrap() {
  const uid = process.getuid();
  return launchctl(["bootstrap", `gui/${uid}`, PLIST_PATH]);
}

function bootout() {
  const uid = process.getuid();
  return launchctl(["bootout", `gui/${uid}/${LABEL}`]);
}

function kickstart() {
  const uid = process.getuid();
  return launchctl(["kickstart", "-k", `gui/${uid}/${LABEL}`]);
}

function launchctlDetail(result) {
  return (result.stderr || result.stdout || "").trim();
}

function assertLaunchctlSuccess(action, result) {
  if (result.status === 0) return;
  const detail = launchctlDetail(result);
  throw new Error(`${action} failed${detail ? `: ${detail}` : "."}`);
}

function isLoaded() {
  const uid = process.getuid();
  return launchctl(["print", `gui/${uid}/${LABEL}`]).status === 0;
}

function checkPortBinding() {
  const r = spawnSync(
    LSOF_PATH,
    ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN"],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) return { listening: false };
  const lines = r.stdout.split("\n").filter(Boolean);
  const onLoopback = lines.some((l) => l.includes(`127.0.0.1:${PORT}`));
  const onWildcard = lines.some(
    (l) => l.includes(`*:${PORT}`) || l.includes(`0.0.0.0:${PORT}`),
  );
  return { listening: lines.length > 0, onLoopback, onWildcard };
}

function preflight() {
  if (!fs.existsSync(path.join(REPO_ROOT, ".next", "BUILD_ID"))) {
    throw new Error(
      "Production build not found. Run `npm run build` before starting the service.",
    );
  }

  const nativeCheck = spawnSync(
    process.execPath,
    ["-e", "require('better-sqlite3')"],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (nativeCheck.status !== 0) {
    throw new Error(
      "Native dependencies do not match this Node.js runtime. " +
        "Run `npm rebuild better-sqlite3`, then start the service again.",
    );
  }
}

async function verifyStarted() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = checkPortBinding();
    if (state.onWildcard) {
      throw new Error(
        `DANGER: server is bound to a wildcard address on :${PORT}. Stop the service immediately.`,
      );
    }
    if (state.onLoopback) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Spent did not bind to 127.0.0.1:${PORT} within 30 seconds. Check ${LOG_DIR}/err.log.`,
  );
}

export async function run(cmd, { friendlyUrl, loopbackUrl }) {
  switch (cmd) {
    case "install": {
      preflight();
      ensureLogDir();
      writePlist();
      try {
        addManagedBlock();
      } catch (err) {
        console.error(`Hosts file edit failed: ${err.message}`);
        console.error("Service file is still installed. You can fix hosts later.");
      }
      const result = isLoaded() ? kickstart() : bootstrap();
      assertLaunchctlSuccess("Installing Spent service", result);
      await verifyStarted();
      console.log(`Spent is running. Open ${friendlyUrl} or ${loopbackUrl}.`);
      return;
    }
    case "uninstall": {
      bootout();
      if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
      try {
        removeManagedBlock();
      } catch (err) {
        console.error(`Hosts file cleanup failed: ${err.message}`);
      }
      console.log("Spent service removed. The repo and data/ directory are untouched.");
      return;
    }
    case "start": {
      preflight();
      ensureLogDir();
      writePlist();
      const result = isLoaded() ? kickstart() : bootstrap();
      assertLaunchctlSuccess("Starting Spent", result);
      await verifyStarted();
      console.log("Spent started.");
      return;
    }
    case "stop": {
      if (isLoaded()) {
        assertLaunchctlSuccess("Stopping Spent", bootout());
      }
      console.log("Spent stopped.");
      return;
    }
    case "status": {
      const r = launchctl(["print", `gui/${process.getuid()}/${LABEL}`]);
      const loaded = r.status === 0;
      const port = checkPortBinding();
      console.log(`LaunchAgent loaded: ${loaded ? "yes" : "no"}`);
      console.log(
        `Port ${PORT} bound: ${
          port.onLoopback
            ? "yes (127.0.0.1, ok)"
            : port.onWildcard
              ? "yes (wildcard, NOT OK)"
              : "no"
        }`,
      );
      console.log(`Plist: ${PLIST_PATH}`);
      console.log(`Logs:  ${LOG_DIR}/{out,err}.log`);
      return;
    }
    case "logs": {
      const errLog = path.join(LOG_DIR, "err.log");
      const outLog = path.join(LOG_DIR, "out.log");
      console.log(`tail -f ${errLog} ${outLog}`);
      spawnSync("tail", ["-f", errLog, outLog], { stdio: "inherit" });
      return;
    }
    case "open": {
      spawnSync("open", [friendlyUrl], { stdio: "inherit" });
      return;
    }
  }
}
