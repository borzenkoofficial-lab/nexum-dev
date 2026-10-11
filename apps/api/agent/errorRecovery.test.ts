import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseError, getPrioritizedRecoveryActions } from "./errorRecovery.js";

test("diagnoses TypeScript errors and extracts file hints", () => {
  const diagnosis = diagnoseError("src/App.tsx:42:7 - error TS2322: Type 'string' is not assignable");
  assert.equal(diagnosis.category, "typescript");
  assert.ok(diagnosis.likelyFiles.includes("src/App.tsx"));
  assert.deepEqual(diagnosis.recoveryActions, ["inspect_evidence", "targeted_repair", "rerun_relevant_validation"]);
  assert.ok(diagnosis.strategy.indexOf("inspect_evidence") < diagnosis.strategy.indexOf("targeted_repair"));
  assert.ok(diagnosis.strategy.indexOf("targeted_repair") < diagnosis.strategy.indexOf("rerun_relevant_validation"));
});

test("diagnoses parser errors", () => {
  const diagnosis = diagnoseError("PARSE_ERROR Invalid Unicode escape sequence in src/App.tsx:42:70");
  assert.equal(diagnosis.category, "syntax");
  assert.equal(diagnosis.priority, 1);
  assert.deepEqual(diagnosis.recoveryActions, ["inspect_evidence", "targeted_repair", "rerun_relevant_validation"]);
});

test("diagnoses dependency errors", () => {
  const diagnosis = diagnoseError("npm ERR! Missing script: build");
  assert.equal(diagnosis.category, "dependency");
  assert.deepEqual(diagnosis.recoveryActions, ["inspect_manifest_lockfile", "minimal_dependency_repair", "rerun_install_or_build"]);
});

test("permission and cancellation errors prioritize stopping over retries", () => {
  const permission = diagnoseError("EACCES: permission denied");
  const cancellation = diagnoseError("AbortError: operation cancelled");
  assert.equal(permission.recoveryActions[0], "stop");
  assert.equal(cancellation.recoveryActions[0], "stop");
  assert.equal(permission.recoveryActions.includes("bounded_retry_if_transient"), false);
  assert.equal(cancellation.recoveryActions.includes("bounded_retry_or_provider_fallback"), false);
});

test("network errors prioritize bounded retry or provider fallback", () => {
  const diagnosis = diagnoseError("429 rate limit exceeded");
  assert.equal(diagnosis.category, "network");
  assert.deepEqual(diagnosis.recoveryActions, ["bounded_retry_or_provider_fallback", "inspect_provider_status"]);
});

test("recovery action plans are returned as defensive copies", () => {
  const first = getPrioritizedRecoveryActions("validation");
  first.reverse();
  assert.deepEqual(getPrioritizedRecoveryActions("validation"), ["inspect_failed_criteria", "targeted_repair", "rerun_validation"]);
});
