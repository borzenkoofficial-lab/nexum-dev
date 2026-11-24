import assert from "node:assert/strict";
import { test } from "node:test";
import { projectLockKey } from "./chatJobStore.js";

test("project lock identity is scoped by both tenant and project", () => {
  const sameProjectDifferentUsers = [
    projectLockKey("tenant-a", "nexum"),
    projectLockKey("tenant-b", "nexum"),
  ];
  assert.notEqual(sameProjectDifferentUsers[0], sameProjectDifferentUsers[1]);
  assert.equal(projectLockKey("tenant-a", "project-1"), projectLockKey("tenant-a", "project-1"));
  assert.notEqual(projectLockKey("tenant-a", "project-1"), projectLockKey("tenant-a", "project-2"));
});
