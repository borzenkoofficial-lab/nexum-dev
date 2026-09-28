import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { extractIntent } from "../ai/intentEngine.js";
import { finalizeAutonomousDesignPipeline, getPipelineSnapshot, prepareAutonomousDesignPipeline } from "./autonomousPipeline.js";

test("autonomous pipeline derives design, interactions and verification", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-pipeline-"));
  try {
    await writeFile(resolve(root, "index.html"), `<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui}</style></head><body><button type="button">Создать</button></body></html>`, "utf8");
    const intent = extractIntent("создай приложение доставки с формой заказа и картой");
    const prepared = await prepareAutonomousDesignPipeline(root, intent);
    assert.equal(prepared.interactionCount > 0, true);
    assert.equal(prepared.componentCount > 0, true);
    assert.equal(prepared.verification?.passed, true);
    assert.equal(prepared.readyForLive, true);

    const snapshot = await getPipelineSnapshot(root);
    assert.equal(snapshot.readyForLive, true);
    assert.equal(snapshot.completed, false);

    await mkdir(resolve(root, "dist"), { recursive: true });
    await writeFile(resolve(root, "dist", "index.html"), await readFileCompat(resolve(root, "index.html")), "utf8");
    const finalized = await finalizeAutonomousDesignPipeline(root, "p1", true);
    assert.equal(finalized.stage, "done");
    assert.equal(finalized.completed, true);
    assert.equal(finalized.buildVerified, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function readFileCompat(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}
