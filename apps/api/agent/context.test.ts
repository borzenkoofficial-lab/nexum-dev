import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentContext, formatAgentContext } from "./context.js";

test("agent context loads persistent NEXUM contracts and role instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexum-contract-"));
  await mkdir(join(root, ".nexum", "agents"), { recursive: true });
  await writeFile(join(root, ".nexum", "AI.md"), "OPERATING-CONTRACT", "utf8");
  await writeFile(join(root, ".nexum", "PROJECT.md"), "PROJECT-CONTRACT", "utf8");
  await writeFile(join(root, ".nexum", "ARCHITECTURE.md"), "ARCH-CONTRACT", "utf8");
  await writeFile(join(root, ".nexum", "RULES.md"), "RULES-CONTRACT", "utf8");
  await writeFile(join(root, ".nexum", "agents", "debugger.md"), "DEBUGGER-CONTRACT", "utf8");

  const context = await buildAgentContext(root, [], "Исправь ошибку сборки", "debugger");
  const formatted = formatAgentContext(context);

  assert.match(formatted, /OPERATING-CONTRACT/);
  assert.match(formatted, /PROJECT-CONTRACT/);
  assert.match(formatted, /ARCH-CONTRACT/);
  assert.match(formatted, /RULES-CONTRACT/);
  assert.match(formatted, /DEBUGGER-CONTRACT/);
});
