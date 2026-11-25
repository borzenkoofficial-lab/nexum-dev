import test from "node:test";
import assert from "node:assert/strict";
import {
  createAgentDefinition,
  deleteAgentDefinition,
  listAgentDefinitions,
  updateAgentDefinition,
} from "./agentDefinitionStore.js";

const previousDatabaseUrl = process.env.NEXUM_DATABASE_URL;
test.before(() => { delete process.env.NEXUM_DATABASE_URL; });
test.after(() => {
  if (previousDatabaseUrl === undefined) delete process.env.NEXUM_DATABASE_URL;
  else process.env.NEXUM_DATABASE_URL = previousDatabaseUrl;
});

function input(name: string) {
  return {
    name,
    description: "Проверяет рабочие процессы",
    systemPrompt: "Ты специализированный агент. Выполняй задачу безопасно.",
    allowedTools: ["listFiles", "readFile"],
    approvalPolicy: "always" as const,
    status: "active" as const,
  };
}

test("agent definitions are persisted and isolated by account", async () => {
  const userA = `agent-user-a-${Date.now()}`;
  const userB = `agent-user-b-${Date.now()}`;
  const created = await createAgentDefinition(userA, input("Аналитик"));
  assert.equal(created.userId, userA);
  assert.equal((await listAgentDefinitions(userA)).some((item) => item.id === created.id), true);
  assert.equal((await listAgentDefinitions(userB)).some((item) => item.id === created.id), false);
});

test("agent names are unique case-insensitively within an account", async () => {
  const userId = `agent-user-duplicate-${Date.now()}`;
  await createAgentDefinition(userId, input("Аудитор"));
  await assert.rejects(() => createAgentDefinition(userId, input("аудитор")), /уже существует/);
});

test("agent update changes only supplied fields and is owner-scoped", async () => {
  const userA = `agent-user-update-a-${Date.now()}`;
  const userB = `agent-user-update-b-${Date.now()}`;
  const created = await createAgentDefinition(userA, input("Разработчик"));
  assert.equal(await updateAgentDefinition(userB, created.id, { name: "Чужой" }), null);
  const updated = await updateAgentDefinition(userA, created.id, { status: "paused" });
  assert.ok(updated);
  assert.equal(updated.status, "paused");
  assert.equal(updated.name, "Разработчик");
  assert.equal(updated.systemPrompt, created.systemPrompt);
});

test("agent deletion is owner-scoped", async () => {
  const userA = `agent-user-delete-a-${Date.now()}`;
  const userB = `agent-user-delete-b-${Date.now()}`;
  const created = await createAgentDefinition(userA, input("Тестировщик"));
  assert.equal(await deleteAgentDefinition(userB, created.id), false);
  assert.equal(await deleteAgentDefinition(userA, created.id), true);
  assert.equal((await listAgentDefinitions(userA)).some((item) => item.id === created.id), false);
});

test("agent definitions reject tools without a registered security policy", async () => {
  await assert.rejects(
    () => createAgentDefinition(`agent-user-tool-${Date.now()}`, { ...input("Интегратор"), allowedTools: ["unknownDangerousTool"] }),
    /No security policy registered/,
  );
});

test("agent definitions reject unsupported AI providers", async () => {
  await assert.rejects(
    () => createAgentDefinition(`agent-user-provider-${Date.now()}`, { ...input("Провайдер"), provider: "unknown-provider" }),
    /Неподдерживаемый провайдер/,
  );
});

test("agent definitions reject empty names and system prompts", async () => {
  await assert.rejects(
    () => createAgentDefinition(`agent-user-empty-${Date.now()}`, { ...input(""), name: " " }),
    /Название агента обязательно/,
  );
  const userId = `agent-user-empty-patch-${Date.now()}`;
  const created = await createAgentDefinition(userId, input("Секретарь"));
  await assert.rejects(() => updateAgentDefinition(userId, created.id, { systemPrompt: " " }), /Системная инструкция обязательна/);
});

test("autonomous agent definitions accept read-only tools and reject write or execute tools", async () => {
  const userId = `agent-user-autonomous-${Date.now()}`;
  const safe = await createAgentDefinition(userId, {
    ...input("Только чтение"),
    approvalPolicy: "autonomous",
    allowedTools: ["listFiles", "readFile", "searchFiles", "git"],
  });
  assert.equal(safe.approvalPolicy, "autonomous");
  await assert.rejects(
    () => createAgentDefinition(userId, {
      ...input("Опасный автономный"),
      approvalPolicy: "autonomous",
      allowedTools: ["writeFile"],
    }),
    /автономном режиме разрешены только инструменты чтения/i,
  );
});
