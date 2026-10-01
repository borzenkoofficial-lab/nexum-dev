import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission, ROLE_PERMISSIONS } from "./admin.js";

test("super admin has all declared permissions", () => {
  const permissions = ROLE_PERMISSIONS.super_admin;
  assert.equal(new Set(permissions).size, permissions.length);
  assert.equal(hasPermission("super_admin", "system.manage"), true);
  assert.equal(hasPermission("super_admin", "payments.refund"), true);
});

test("finance role is limited to financial operations", () => {
  assert.equal(hasPermission("finance", "payments.refund"), true);
  assert.equal(hasPermission("finance", "payments.export"), true);
  assert.equal(hasPermission("finance", "users.suspend"), false);
  assert.equal(hasPermission("finance", "system.manage"), false);
});

test("content manager cannot configure AI or payments", () => {
  assert.equal(hasPermission("content_manager", "content.publish"), true);
  assert.equal(hasPermission("content_manager", "ai.configure"), false);
  assert.equal(hasPermission("content_manager", "payments.refund"), false);
});
