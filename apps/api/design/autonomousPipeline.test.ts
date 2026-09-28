import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { extractIntent } from "../ai/intentEngine.js";
import { evaluatePipelineGates, finalizeAutonomousDesignPipeline, getPipelineSnapshot, prepareAutonomousDesignPipeline } from "./autonomousPipeline.js";

test("autonomous pipeline derives design, interactions and verification", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-pipeline-"));
  try {
    await writeFile(resolve(root, "index.html"), `<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui}</style></head><body><button type="button" data-nexum-action="execute-primary-action">Оформить доставку</button><p>Доставка по городу и отслеживание заказа</p></body></html>`, "utf8");
    const intent = extractIntent("создай приложение доставки с формой заказа и картой");
    const prepared = await prepareAutonomousDesignPipeline(root, intent);
    assert.equal(prepared.interactionCount > 0, true);
    assert.equal(prepared.componentCount > 0, true);
    assert.equal(prepared.verification?.passed, true);
    assert.equal(prepared.readyForLive, false);
    assert.equal(prepared.completed, false);
    assert.equal(prepared.stage, "build");

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


test("pipeline gates require build, verification and live readiness", () => {
  const gates=evaluatePipelineGates({
    design:{
      version:1,productType:"auto-repair",visualDirection:"automotive service",audience:"drivers",
      tokens:{colors:{background:"#fff",surface:"#fff",text:"#111",muted:"#777",primary:"#111",accent:"#f5b800",border:"#ddd",danger:"#d00",success:"#0a0"},typography:{fontFamily:"system-ui",headingWeight:700,bodyWeight:400,baseSize:16,scale:1.25},spacing:{unit:4,section:80,container:1200},radius:{sm:8,md:14,lg:22,pill:999},motion:{enabled:true,duration:180},breakpoints:{mobile:640,tablet:768,desktop:1024}},
      components:["Button"],pages:[],responsive:{strategy:"mobile-first",required:true},accessibility:{keyboard:true,focusVisible:true,contrast:true,reducedMotion:true},interactions:[{id:"primary",component:"Button",event:"click",action:"book"}],updatedAt:new Date().toISOString()
    },
    componentCount:1,interactionCount:1,verification:{passed:true,checks:[],score:100},live:{projectId:"p",generatedAt:new Date().toISOString(),entry:"dist/index.html",buildReady:true,mode:"built-app"},buildVerified:false,
  });
  assert.equal(gates.find((gate)=>gate.name==="build")?.passed,false);
  assert.equal(gates.every((gate)=>gate.passed),false);
});


test("prepared pipeline cannot report completion without a verified production build", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-pipeline-static-"));
  try {
    await writeFile(
      resolve(root, "index.html"),
      `<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui}</style></head><body><button type="button" data-nexum-action="execute-primary-action">Открыть заказ</button><p>Доставка по городу</p></body></html>`,
      "utf8",
    );
    const intent = extractIntent("создай приложение доставки");
    const prepared = await prepareAutonomousDesignPipeline(root, intent);
    assert.equal(prepared.buildVerified, false);
    assert.equal(prepared.completed, false);
    assert.equal(prepared.readyForLive, false);
    assert.equal(prepared.stage, "build");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
