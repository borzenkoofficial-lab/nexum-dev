import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const ollama = process.platform === "win32" ? "ollama.exe" : "ollama";
const root = process.cwd();
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "qwen3:4b";
const aiProvider = process.env.AI_PROVIDER?.toLowerCase() ?? "ollama";

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

  // API starts first and does not depend on Ollama.
  // This prevents the UI from reporting an API error just because the local model is offline.
  const apiProcess = spawn(npm, ["--prefix", "apps/api", "run", "start"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      AI_PROVIDER: process.env.AI_PROVIDER ?? "ollama",
      OLLAMA_BASE_URL: ollamaBaseUrl,
      OLLAMA_MODEL: ollamaModel,
    },
  });

  const children = [apiProcess];

  const apiReady = await waitForApi();
  if (!apiReady) {
    shutdown(1);
    return;
  }

  const webProcess = spawn(npm, ["--prefix", "apps/web", "run", "dev"], {
    cwd: root,
    stdio: "inherit",
  });
  children.push(webProcess);

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

  // Ollama is optional. Do not start it when OpenRouter is the selected provider.
  if (aiProvider === "ollama") {
    void (async () => {
      const ollamaReady = await ensureOllama();
      if (ollamaReady) await ensureModel();
    })();
  }

  console.log("");
  console.log("[Nexum] Web: http://localhost:5173");
  console.log("[Nexum] API: http://localhost:3001");
  console.log(aiProvider === "openrouter"
    ? `[Nexum] AI: OpenRouter / ${process.env.OPENROUTER_MODEL ?? "openrouter/free"}`
    : `[Nexum] AI: Ollama / ${ollamaModel} (optional)`);
  console.log("[Nexum] Press Ctrl+C to stop both.");
}

async function waitForApi() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3001/api/health");
      if (response.ok) {
        console.log("[Nexum] API health: OK");
        return true;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error("[Nexum] API did not become ready on port 3001. Check the API process output above.");
  return false;
}

main().catch((error) => {
  console.error("[Nexum] Startup failed:", error);
  process.exit(1);
});
