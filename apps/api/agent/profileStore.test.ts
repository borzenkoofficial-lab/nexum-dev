import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProfile, deleteAgentProfile, listAgentProfiles } from "./profileStore.js";

const previousDatabaseUrl = process.env.NEXUM_DATABASE_URL;
test.before(() => { delete process.env.NEXUM_DATABASE_URL; });
test.after(() => {
  if (previousDatabaseUrl === undefined) delete process.env.NEXUM_DATABASE_URL;
  else process.env.NEXUM_DATABASE_URL = previousDatabaseUrl;
});

test("agent profiles are isolated by account", async () => {
  const userA = `profile-user-a-${Date.now()}`;
  const userB = `profile-user-b-${Date.now()}`;
  const created = await createAgentProfile(userA, {
    name: "Аналитик",
    description: "Проверяет бизнес-процессы",
    prompt: "Изучи процесс и предложи улучшения.",
  });

  assert.equal(created.userId, userA);
  assert.equal((await listAgentProfiles(userA)).some((item) => item.id === created.id), true);
  assert.equal((await listAgentProfiles(userB)).some((item) => item.id === created.id), false);
});

test("agent profile names are unique within one account", async () => {
  const userId = `profile-user-duplicate-${Date.now()}`;
  await createAgentProfile(userId, { name: "Аудитор", description: "", prompt: "Проверь проект." });
  await assert.rejects(
    () => createAgentProfile(userId, { name: "аудитор", description: "", prompt: "Проверь повторно." }),
    /уже существует/,
  );
});

test("an account can delete only its own agent profile", async () => {
  const userA = `profile-user-delete-a-${Date.now()}`;
  const userB = `profile-user-delete-b-${Date.now()}`;
  const created = await createAgentProfile(userA, { name: "Тестировщик", description: "", prompt: "Запусти тесты." });

  assert.equal(await deleteAgentProfile(userB, created.id), false);
  assert.equal(await deleteAgentProfile(userA, created.id), true);
  assert.equal((await listAgentProfiles(userA)).some((item) => item.id === created.id), false);
});
