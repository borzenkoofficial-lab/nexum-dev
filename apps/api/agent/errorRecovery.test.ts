import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseError } from "./errorRecovery.js";

test("diagnoses TypeScript errors and extracts file hints", () => {
  const diagnosis = diagnoseError("src/App.tsx:42:7 - error TS2322: Type 'string' is not assignable");
  assert.equal(diagnosis.category, "typescript");
  assert.ok(diagnosis.likelyFiles.includes("src/App.tsx"));
});

test("diagnoses parser errors", () => {
  const diagnosis = diagnoseError("PARSE_ERROR Invalid Unicode escape sequence in src/App.tsx:42:70");
  assert.equal(diagnosis.category, "syntax");
});

test("diagnoses dependency errors", () => {
  const diagnosis = diagnoseError("npm ERR! Missing script: build");
  assert.equal(diagnosis.category, "dependency");
});
