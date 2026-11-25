import test from "node:test";
import assert from "node:assert/strict";
import { canManageOrganization } from "./organizationService.js";

test("only owners and admins can manage organization settings", () => {
  assert.equal(canManageOrganization("owner"), true);
  assert.equal(canManageOrganization("admin"), true);
  assert.equal(canManageOrganization("member"), false);
  assert.equal(canManageOrganization("viewer"), false);
});
