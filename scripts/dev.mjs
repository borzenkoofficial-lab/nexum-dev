import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const ollama = process.platform === "win32" ? "ollama.exe" : "ollama";
const root = process.cwd();
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "qwen3:4b";

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

async function ensureOllama() {
  try {
    const response = await fetch(ollamaBaseUrl + "/api/tags");
    if (response.ok) {
      console.log("[Ollama] Already running.");
      return true;
    }
  } catch {}

  console.log("[Ollama] Starting Ollama...");
  let processHandle;
  try {
    processHandle = spawn(ollama, ["serve"], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {
    console.log("[Ollama] Not installed or not available in PATH.");
    return false;
  }

  processHandle.on("error", () => {
    console.log("[Ollama] Could not start. Install Ollama and restart Nexum.");
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(ollamaBaseUrl + "/api/tags");
      if (response.ok) {
        console.log("[Ollama] Ready.");
        return true;
      }
    } catch {}
  }

  console.log("[Ollama] Server did not become ready.");
  return false;
}

async function ensureModel() {
  try {
    const response = await fetch(ollamaBaseUrl + "/api/tags");
    if (!response.ok) return false;
    const data = await response.json();
    const models = Array.isArray(data.models)
      ? data.models.map((item) => item?.name).filter(Boolean)
      : [];

    if (models.some((name) => name === ollamaModel || name.startsWith(ollamaModel + ":"))) {
      console.log(`[Ollama] Model ready: ${ollamaModel}`);
      return true;
    }
  } catch {}

  console.log(`[Ollama] Model missing: ${ollamaModel}`);
  console.log(`[Ollama] Run once: ollama pull ${ollamaModel}`);
  return false;
}

async function main() {
  console.log("[Nexum] Starting local development environment...");
  runInstall("apps/api");
  runInstall("apps/web");

  const ollamaReady = await ensureOllama();
  if (ollamaReady) await ensureModel();

  const children = [
    spawn(npm, ["--prefix", "apps/api", "run", "dev"], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        AI_PROVIDER: process.env.AI_PROVIDER ?? "ollama",
        OLLAMA_BASE_URL: ollamaBaseUrl,
        OLLAMA_MODEL: ollamaModel,
      },
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
  console.log(`[Nexum] AI: Ollama / ${ollamaModel}`);
  console.log("[Nexum] Press Ctrl+C to stop both.");
}

main().catch((error) => {
  console.error("[Nexum] Startup failed:", error);
  process.exit(1);
});
