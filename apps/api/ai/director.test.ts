import assert from "node:assert/strict";
import { test } from "node:test";
import { NexumDirector } from "./director.js";

test("routes explicit debugging before complex build planning", () => {
  const decisions = new NexumDirector().decide("Исправь ошибку backend API и проверь сборку");
  assert.equal(decisions[0]?.role, "director");
  assert.equal(decisions[1]?.role, "debugger");
});

test("respects the runtime provider set", () => {
  const decisions = new NexumDirector().decide("Сделай сайт", "auto", undefined, ["openrouter"]);
  assert.ok(decisions.every((decision) => decision.provider === "openrouter" || decision.provider === undefined));
});

test("bounds a complex route", () => {
  const decisions = new NexumDirector().decide("С нуля сделай production marketplace с API и базой данных");
  assert.ok(decisions.length <= 3);
});
