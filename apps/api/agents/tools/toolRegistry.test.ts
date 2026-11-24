import test from "node:test";import assert from "node:assert/strict";import {agentToolRegistry} from "./toolRegistry.js";
const context={organizationId:"org",userId:"user",runId:"run",signal:new AbortController().signal};
test("email draft is never sent",async()=>{const r=await agentToolRegistry.execute("email_draft",{to:"team@example.com",subject:"Proposal",body:"Hello"},context,["email_draft"]) as Record<string,unknown>;assert.equal(r.status,"draft_only");assert.equal(r.sent,false);});
test("disabled tools cannot execute",async()=>{await assert.rejects(()=>agentToolRegistry.execute("email_draft",{to:"x",subject:"y",body:"z"},context,[]),/not enabled/);});
test("JSON parser rejects malformed data",async()=>{await assert.rejects(()=>agentToolRegistry.execute("json_parse",{text:"{"},context,["json_parse"]));});
