import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareAutonomousDesignPipeline } from "./autonomousPipeline.js";
import { extractIntent } from "../ai/intentEngine.js";

test("autonomous design pipeline derives components and interactions", async()=>{
  const root=await mkdtemp(join(tmpdir(),"nexum-pipeline-"));
  await writeFile(join(root,"index.html"),'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width"></head><body><button>OK</button></body></html>');
  const result=await prepareAutonomousDesignPipeline(root,extractIntent("создай CRM для строительной компании с dashboard и modal"));
  assert.ok(result.componentCount>=5);
  assert.ok(result.interactionCount>=4);
  assert.equal(result.readyForLive,true);
});
