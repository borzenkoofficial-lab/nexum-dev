import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDesignSpec, writeDesignSpec, deriveDesignSpec } from "./designSpec.js";
import { interactionScript } from "./interactionContract.js";
import { verifyDesign } from "./visualVerification.js";
import { writeFile } from "node:fs/promises";

test("design spec persists and derives from domain", async () => {
  const root=await mkdtemp(join(tmpdir(),"nexum-design-"));
  const derived=deriveDesignSpec({domain:"construction",productType:"construction-site",features:["dashboard","modal"]});
  const saved=await writeDesignSpec(root,derived);
  const loaded=await readDesignSpec(root);
  assert.equal(loaded.productType,"construction-site");
  assert.equal(loaded.components.includes("Table"),true);
  assert.equal(saved.updatedAt,loaded.updatedAt);
});

test("interaction bridge emits runtime interaction contract", () => {
  const script=interactionScript("p1");
  assert.match(script,/nexum-preview/);
  assert.match(script,/eventType:"click"/);
  assert.match(script,/eventType:"submit"/);
  assert.match(script,/nexum-host/);
});

test("visual verification checks responsive document basics", async () => {
  const root=await mkdtemp(join(tmpdir(),"nexum-visual-"));
  await writeFile(join(root,"index.html"),'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width"><style>button{padding:8px}</style></head><body><button>OK</button></body></html>');
  await writeDesignSpec(root,{...deriveDesignSpec({features:["modal"]}),interactions:[{id:"primary",component:"Button",event:"click",action:"execute-primary-action"}]});
  const result=await verifyDesign(root);
  assert.equal(result.passed,true);
  assert.equal(result.score,100);
});
