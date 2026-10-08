/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { RuntimeEventBus } from "./EventBus.ts";
import { RuntimeDiagnostics } from "./Diagnostics.ts";
import { ResourceManager } from "./ResourceManager.ts";
test("event bus isolates handler failures",()=>{const bus=new RuntimeEventBus();let called=0;bus.on("x",()=>{called++});bus.on("x",()=>{throw new Error("boom")});bus.emit("x");assert.equal(called,1)});
test("resource manager releases exactly once",()=>{const bus=new RuntimeEventBus();const d=new RuntimeDiagnostics();const resources=new ResourceManager(bus,d);let releases=0;const id=resources.register("timer",()=>{releases++});resources.release(id);resources.release(id);assert.equal(releases,1);assert.equal(resources.snapshot()[0].status,"RELEASED")});

test("task state machine rejects terminal resurrection",async()=>{const {TaskManager}=await import("./TaskManager.ts");const bus=new RuntimeEventBus();const d=new RuntimeDiagnostics();const tasks=new TaskManager(bus,d);const task=tasks.create();tasks.update(task.id,"RUNNING");tasks.update(task.id,"CANCELLED");tasks.update(task.id,"RUNNING");assert.equal(tasks.get(task.id)?.status,"CANCELLED");assert.ok(d.list().some(item=>item.message.includes("Invalid task transition")))});
test("runtime lifecycle rejects shutdown resurrection",async()=>{const {NexumRuntime}=await import("./Runtime.ts");const runtime=new NexumRuntime();await runtime.start();await runtime.shutdown();runtime.setBusy(true);assert.equal(runtime.getLifecycle(),"SHUTTING_DOWN")});


test("cancellation race cannot mark task completed",async()=>{const {TaskManager}=await import("./TaskManager.ts");const bus=new RuntimeEventBus();const d=new RuntimeDiagnostics();const tasks=new TaskManager(bus,d);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});const run=tasks.run(async(signal)=>{await gate;return signal.aborted;});const task=tasks.list()[0]!;tasks.cancel(task.id);release();await assert.rejects(run,/Task cancelled/i);assert.equal(tasks.get(task.id)?.status,"CANCELLED")});
