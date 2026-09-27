import assert from "node:assert/strict";
import test from "node:test";
import { TestProjectTool } from "./testProject.js";

test("exposes the tester tool contract", () => {
  const tool = new TestProjectTool as unknown as { name: string; description: string };
  assert.equal(tool.name, "testProject");
  assert.match(tool.description, /automated checks/i);
});
