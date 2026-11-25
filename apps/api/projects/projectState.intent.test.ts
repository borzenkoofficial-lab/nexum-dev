import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyProjectDomain } from "../agent/domainIntent.js";
import { ProjectStateManager } from "./projectState.js";

test("classifies common product domains", () => {
  assert.equal(classifyProjectDomain("Создай сайт автосервиса с диагностикой и ремонтом").domain, "automotive");
  assert.equal(classifyProjectDomain("Сайт компании по демонтажу фасадов").domain, "construction");
});

test("persists classified product intent", async () => {
  const root = await mkdtemp(join(tmpdir(), "kvard-state-"));
  try {
    const state = await new ProjectStateManager(root, "intent-test")
      .refresh("Создай сайт автосервиса с диагностикой и ремонтом");
    assert.equal(state.intentDomain, "automotive");
    assert.equal(state.intentProductType, "автосервис или автомобильный бизнес");
    assert.equal(state.intentAudience, "владельцы автомобилей");
    assert.equal((await new ProjectStateManager(root, "intent-test").read())?.intentDomain, "automotive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
