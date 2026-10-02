/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { RuntimeEventBus } from "./EventBus.ts";
import { RuntimeDiagnostics } from "./Diagnostics.ts";
import { ResourceManager } from "./ResourceManager.ts";
test("event bus isolates handler failures",()=>{const bus=new RuntimeEventBus();let called=0;bus.on("x",()=>{called++});bus.on("x",()=>{throw new Error("boom")});bus.emit("x");assert.equal(called,1)});
test("resource manager releases exactly once",()=>{const bus=new RuntimeEventBus();const d=new RuntimeDiagnostics();const resources=new ResourceManager(bus,d);let releases=0;const id=resources.register("timer",()=>{releases++});resources.release(id);resources.release(id);assert.equal(releases,1);assert.equal(resources.snapshot()[0].status,"RELEASED")});
