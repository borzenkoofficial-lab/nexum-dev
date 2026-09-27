import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const root = process.cwd();

function runInstall(dir) {
  const packageJson = `${root}/${dir}/package.json`;
  const nodeModules = `${root}/${dir}/node_modules`;

  if (!existsSync(packageJson)) {
    console.error(`[Nexum] Missing ${dir}/package.json`);
    process.exit(1);
  }

  if (!existsSync(nodeModules)) {
    console.log(`[Nexum] Installing dependencies for ${dir}...`);
    const result = spawnSync(npm, ["install"], {
      cwd: `${root}/${dir}`,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

console.log("[Nexum] Starting local development environment...");
runInstall("apps/api");
runInstall("apps/web");

const children = [
  spawn(npm, ["--prefix", "apps/api", "run", "dev"], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(npm, ["--prefix", "apps/web", "run", "dev"], {
    cwd: root,
    stdio: "inherit",
  }),
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill();
  }

  setTimeout(() => process.exit(code), 100);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!shuttingDown && code && code !== 0) {
      shutdown(code);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("");
console.log("[Nexum] Web: http://localhost:5173");
console.log("[Nexum] API: http://localhost:3001");
console.log("[Nexum] Press Ctrl+C to stop both.");
