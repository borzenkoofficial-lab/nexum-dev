import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerRuntime } from "./runtime.js";

test("runtime stress: concurrent projects remain isolated", () => {
  const r = new ServerRuntime(); r.start();
  const projects = ["A","B","C"];
  const tasks = projects.flatMap(projectId => Array.from({length:20},(_,i)=>r.createTask({projectId,operation:"stress-"+i})));
  const resources = projects.flatMap(projectId => Array.from({length:20},()=>r.registerResource("timer",()=>{}, {projectId})));
  for (const t of tasks) r.updateTask(t.id,"RUNNING");
  r.cancelProject("A");
  assert.equal(r.tasksListForTest("A").every(t=>t.status==="CANCELLED"),true);
  assert.equal(r.tasksListForTest("B").every(t=>t.status==="RUNNING"),true);
  assert.equal(r.tasksListForTest("C").every(t=>t.status==="RUNNING"),true);
  assert.equal(r.resourcesListForTest().filter(r=>r.projectId==="A").length,0);
  assert.equal(r.resourcesListForTest().filter(r=>r.projectId==="B").length,20);
  assert.equal(r.resourcesListForTest().filter(r=>r.projectId==="C").length,20);
  void resources;
});
