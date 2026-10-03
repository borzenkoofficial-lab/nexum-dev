import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git','node_modules','dist','.next','.nexum','playwright-report','test-results']);
const patterns = {
  setTimeout: /\bsetTimeout\b/g, setInterval: /\bsetInterval\b/g,
  requestAnimationFrame: /\brequestAnimationFrame\b/g, addEventListener: /\baddEventListener\b/g,
  fetch: /\bfetch\b/g, WebSocket: /\bWebSocket\b/g, EventSource: /\bEventSource\b/g,
  Worker: /\bWorker\b/g, createObjectURL: /\bcreateObjectURL\b/g, subscribe: /\bsubscribe\b/g,
  spawn: /\bspawn\b/g, exec: /\bexec(?:File)?\b/g,
  Agent: /\bAgent(?:Loop|Job)?\b|agent/ig, task: /\btask\b/ig, checkpoint: /checkpoint/ig, stream: /stream/ig,
  abort: /\bAbortController\b|\babort\b/ig, cancel: /\bcancel\b/ig, retry: /\bretry\b/ig,
  validation: /validation/ig, repair: /repair/ig, plan: /\bplan\b/ig, tool: /\btool\b/ig,
  provider: /provider/ig, model: /\bmodel\b/ig
};
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(full);
  }
}
walk(root);
const counts = Object.fromEntries(Object.keys(patterns).map((name) => [name, 0]));
const hitFiles = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const hits = {};
  for (const [name, pattern] of Object.entries(patterns)) { const count = text.match(pattern)?.length ?? 0; if (count) { counts[name] += count; hits[name] = count; } }
  if (Object.keys(hits).length) hitFiles.push({ file: relative(root, file), hits });
}
const canonical = {
  agentLoop: 'apps/api/agent/loop.ts',
  runtime: 'apps/api/runtime/runtime.ts',
  chatJob: 'apps/api/chatJobStore.ts',
  modelRouting: 'apps/api/ai/orchestrator.ts',
  gateway: 'apps/api/ai/gateway.ts'
};
console.log(JSON.stringify({ canonical, scannedFiles: files.length, counts, hitFiles }, null, 2));

const serverLoops = hitFiles.filter((item) => /apps\/api\/.*(loop|agent)/i.test(item.file) && /AgentLoop/.test(readFileSync(join(root, item.file), 'utf8'))).map((item) => item.file);
if (!serverLoops.includes(canonical.agentLoop)) { console.error('Canonical AgentLoop implementation not found.'); process.exit(2); }
if (serverLoops.filter((p) => p.startsWith('apps/api/')).length > 1) {
  console.error('Potential duplicate server AgentLoop implementations:', serverLoops);
  process.exit(3);
}
