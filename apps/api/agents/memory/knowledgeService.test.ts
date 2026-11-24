import test from"node:test";import assert from"node:assert/strict";import{splitKnowledgeText}from"./knowledgeService.js";
test("knowledge text chunking covers full input with bounded chunks",()=>{const source="A".repeat(4200);const chunks=splitKnowledgeText(source,1000,100);assert.ok(chunks.length>4);assert.ok(chunks.every(x=>x.length<=1000));assert.ok(chunks.join("").length>=source.length-500);});
test("empty knowledge text creates no chunks",()=>{assert.deepEqual(splitKnowledgeText("   "),[]);});
