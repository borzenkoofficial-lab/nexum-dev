import test from "node:test";
import assert from "node:assert/strict";
import { deriveDesignSpec } from "./designSpec.js";
import { deriveInteractionContract, allowedInteraction, createInteractionRecord, resolveInteraction } from "./interactionEngine.js";

test("interaction engine accepts contracted events and resolves state",()=>{
  const spec={...deriveDesignSpec({features:["modal"]}),interactions:[]} as any;
  spec.interactions=deriveInteractionContract(spec);
  const event={projectId:"p1",type:"click" as const,target:"button",timestamp:Date.now(),action:"execute-primary-action"};
  assert.equal(allowedInteraction(spec,event),true);
  const record=resolveInteraction(createInteractionRecord(event),true);
  assert.equal(record.state,"success");
  assert.ok(record.resolvedAt);
});

test("interaction engine rejects unsupported action target",()=>{
  const spec={...deriveDesignSpec({}),interactions:[{id:"x",component:"Button",event:"click" as const,action:"save",target:"save-button"}]};
  const event={projectId:"p1",type:"click" as const,target:"other-button",timestamp:Date.now()};
  assert.equal(allowedInteraction(spec,event),false);
});
