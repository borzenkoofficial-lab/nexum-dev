import assert from "node:assert/strict";
import test from "node:test";
import { TestProjectTool } from "./testProject.js";

test("exposes the tester tool contract", () => {
  assert.equal(TestProjectTool.prototype.constructor.name, "TestProjectTool");
  assert.match(TestProjectTool.prototype.execute.toString(), /validateStatic|run/);
});
