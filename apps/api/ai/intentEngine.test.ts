import assert from "node:assert/strict";
import { test } from "node:test";
import { extractIntent, intentSummary } from "./intentEngine.js";

test("locks construction domain instead of falling back to generic SaaS", () => {
  const intent = extractIntent("Создай сайт строительной компании по демонтажу фасадов");
  assert.equal(intent.domain, "construction");
  assert.equal(intent.mode, "create");
  assert.match(intent.productType, /строитель/);
  assert.match(intent.audience, /заказчик/);
});

test("extracts automotive intent and does not confuse it with construction", () => {
  const intent = extractIntent("Сделай сайт автосервиса: ремонт двигателей, диагностика и запись");
  assert.equal(intent.domain, "automotive");
  assert.equal(intent.mode, "create");
  assert.ok(intent.features.includes("форма заявки"));
});

test("keeps modification separate from creation", () => {
  const intent = extractIntent("Добавь в CRM поиск клиентов и фильтр");
  assert.equal(intent.domain, "crm");
  assert.equal(intent.mode, "modify");
  assert.ok(intent.features.includes("поиск и фильтрация"));
});

test("debug intent has higher priority than a generic build keyword", () => {
  const intent = extractIntent("Исправь ошибку сборки сайта");
  assert.equal(intent.mode, "debug");
});

test("summary is compact and machine-readable", () => {
  const summary = intentSummary(extractIntent("Создай светлый сайт строительной компании с формой заявки"));
  assert.match(summary, /domain=construction/);
  assert.match(summary, /visual=светлая визуальная система/);
});
