import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const ollama = process.platform === "win32" ? "ollama.exe" : "ollama";
const scriptDir = new URL(".", import.meta.url);
const root = new URL("../", scriptDir).pathname.replace(/\/$/, "");
const envFile = `${root}/.env`;
if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "qwen3:4b";
const requestedProvider = process.env.AI_PROVIDER?.toLowerCase();
const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY?.trim());
const ollamaRequested = requestedProvider === "ollama" || (!requestedProvider && !hasOpenRouter);
const aiProvider = requestedProvider === "openrouter" || (!requestedProvider && hasOpenRouter)
  ? "openrouter"
  : requestedProvider === "mock"
    ? "mock"
    : ollamaRequested
      ? "ollama"
      : "mock";

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
  console.log(`[Ollama] Downloading ${ollamaModel} automatically...`);

  const result = spawnSync(ollama, ["pull", ollamaModel], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.status !== 0) {
    console.error(`[Ollama] Failed to download ${ollamaModel}.`);
    return false;
  }

  console.log(`[Ollama] Model downloaded: ${ollamaModel}`);
  return true;
}

async function main() {
  console.log("[Nexum] Starting local development environment...");
  runInstall("apps/api");
  runInstall("apps/web");

  // Ollama must be ready before the API starts so the selected model status is accurate.
  let ollamaProcess = null;
  if (aiProvider === "ollama") {
    const ollamaReady = await ensureOllama();
    if (!ollamaReady || !(await ensureModel())) {
      if (requestedProvider === "ollama") {
        console.error("[Nexum] AI_PROVIDER=ollama was requested but Ollama/model is unavailable.");
        process.exit(1);
      }
      console.warn("[Nexum] Ollama is unavailable. Starting with the mock AI provider so the UI/API remain usable.");
      process.env.AI_PROVIDER = "mock";
    }
  }

  const apiProcess = spawn(npm, ["--prefix", "apps/api", "run", "start"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      AI_PROVIDER: process.env.AI_PROVIDER ?? aiProvider,
      OLLAMA_BASE_URL: ollamaBaseUrl,
      OLLAMA_MODEL: ollamaModel,
    },
  });

  const children = [apiProcess];

  const apiReady = await waitForApi();
  if (!apiReady) {
    console.error("[Nexum] API startup failed. Stopping local environment.");
    process.exit(1);
  }


  const webProcess = spawn(npm, ["--prefix", "apps/web", "run", "dev"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, BROWSER: "none" },
  });
  children.push(webProcess);

  const webReady = await waitForWeb();
  if (!webReady) {
    console.error("[Nexum] Web startup failed. Stopping local environment.");
    shutdown(1);
    return;
  }

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
  const codespacesDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  const forwardedWebUrl = codespacesDomain
    ? `https://5173-${process.env.CODESPACE_NAME}.${codespacesDomain}`
    : "http://localhost:5173";
  console.log(`[Nexum] Web: ${forwardedWebUrl}`);
  console.log("[Nexum] API: http://localhost:3001");
  console.log(aiProvider === "openrouter"
    ? `[Nexum] AI: OpenRouter / ${process.env.OPENROUTER_MODEL ?? "openrouter/free"}`
    : `[Nexum] AI: Ollama / ${ollamaModel} (optional)`);
  console.log("[Nexum] Press Ctrl+C to stop both.");
}

async function waitForWeb() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:5173/");
      if (response.ok) {
        console.log("[Nexum] Web health: OK");
        return true;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error("[Nexum] Web did not become ready on port 5173. Check the Vite output above.");
  return false;
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
