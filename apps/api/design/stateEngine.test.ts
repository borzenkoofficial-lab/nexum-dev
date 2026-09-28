import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStateSpec, readStateSpec, validateStateTransition, writeStateSpec } from "./stateEngine.js";

test("state engine derives runtime state from UI components and interactions", async () => {
  const spec = deriveStateSpec(["Button", "Input", "Form", "Filter", "Navigation"], [
    { event: "change", action: "update-form-state" },
    { event: "submit", action: "submit-form" },
    { event: "navigate", action: "navigate" },
  ]);
  assert.ok(spec.fields.some((field) => field.id === "formValues"));
  assert.ok(spec.fields.some((field) => field.id === "filters"));
  assert.ok(spec.fields.some((field) => field.id === "route"));
  assert.equal(validateStateTransition(spec, "submit-form").allowed, true);
  assert.equal(validateStateTransition(spec, "missing").allowed, false);
});

test("state engine persists a project contract", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-state-"));
  try {
    const written = await writeStateSpec(root, { actions: [{ id: "open", event: "click" }] });
    const loaded = await readStateSpec(root);
    assert.equal(loaded.actions[0]?.id, "open");
    assert.equal(written.version, 1);
    assert.ok((await readFile(resolve(root, ".nexum", "state-spec.json"), "utf8")).includes('"open"'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
