import test from "node:test";
import assert from "node:assert/strict";
import { parseBootstrapUserIds, roleHasPermission } from "./adminAccess.js";

test("bootstrap user ids are normalized, deduplicated UUIDs", () => {
  assert.deepEqual(
    parseBootstrapUserIds(" 00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000001 "),
    ["00000000-0000-4000-8000-000000000001"],
  );
});

test("bootstrap user id allowlist rejects non-UUID values", () => {
  assert.throws(() => parseBootstrapUserIds("owner@example.com"));
  assert.throws(() => parseBootstrapUserIds("not-a-user-id"));
});

test("missing bootstrap allowlist grants nobody", () => {
  assert.deepEqual(parseBootstrapUserIds(undefined), []);
  assert.deepEqual(parseBootstrapUserIds(" "), []);
});

test("roles have least-privilege permission boundaries", () => {
  assert.equal(roleHasPermission("super_admin", "roles.manage"), true);
  assert.equal(roleHasPermission("admin", "roles.manage"), false);
  assert.equal(roleHasPermission("support", "billing.read"), false);
  assert.equal(roleHasPermission("finance", "billing.manage"), true);
  assert.equal(roleHasPermission("developer", "runtime.manage"), true);
  assert.equal(roleHasPermission("auditor", "billing.manage"), false);
});
