import { randomUUID } from "node:crypto";
import { query } from "../db.js";

export interface AgentProfile {
  id: string;
  userId: string;
  name: string;
  description: string;
  prompt: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
}

type ProfileRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  prompt: string;
  kind: string;
  created_at: string | number;
  updated_at: string | number;
};

const memoryProfiles = new Map<string, AgentProfile[]>();
let initialized: Promise<void> | null = null;

export function agentProfilesUseDatabase(): boolean {
  return Boolean(process.env.NEXUM_DATABASE_URL?.trim());
}

async function ensureTable(): Promise<void> {
  if (!initialized) {
    initialized = query(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'Мой профиль',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_user_name_idx
        ON agent_profiles (user_id, lower(name));
      CREATE INDEX IF NOT EXISTS agent_profiles_user_updated_idx
        ON agent_profiles (user_id, updated_at DESC);
    `).then(() => undefined).catch((error) => {
      initialized = null;
      throw error;
    });
  }
  await initialized;
}

function fromRow(row: ProfileRow): AgentProfile {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    kind: row.kind,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function listAgentProfiles(userId: string): Promise<AgentProfile[]> {
  if (!agentProfilesUseDatabase()) return (memoryProfiles.get(userId) ?? []).map((profile) => ({ ...profile }));
  await ensureTable();
  const result = await query<ProfileRow>(
    "SELECT id, user_id, name, description, prompt, kind, created_at, updated_at FROM agent_profiles WHERE user_id=$1 ORDER BY updated_at DESC",
    [userId],
  );
  return result.rows.map(fromRow);
}

export async function createAgentProfile(userId: string, input: { name: string; description: string; prompt: string; kind?: string }): Promise<AgentProfile> {
  const now = Date.now();
  const profile: AgentProfile = {
    id: randomUUID(),
    userId,
    name: input.name,
    description: input.description,
    prompt: input.prompt,
    kind: input.kind || "Мой профиль",
    createdAt: now,
    updatedAt: now,
  };
  if (!agentProfilesUseDatabase()) {
    const existing = memoryProfiles.get(userId) ?? [];
    if (existing.some((item) => item.name.toLocaleLowerCase() === profile.name.toLocaleLowerCase())) {
      throw new Error("Профиль с таким названием уже существует.");
    }
    memoryProfiles.set(userId, [...existing, profile]);
    return { ...profile };
  }
  await ensureTable();
  const result = await query<ProfileRow>(
    "INSERT INTO agent_profiles (id,user_id,name,description,prompt,kind,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id,user_id,name,description,prompt,kind,created_at,updated_at",
    [profile.id, userId, profile.name, profile.description, profile.prompt, profile.kind, now],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Не удалось сохранить профиль агента.");
  return fromRow(row);
}

export async function deleteAgentProfile(userId: string, profileId: string): Promise<boolean> {
  if (!agentProfilesUseDatabase()) {
    const existing = memoryProfiles.get(userId) ?? [];
    const next = existing.filter((profile) => profile.id !== profileId);
    if (next.length === existing.length) return false;
    memoryProfiles.set(userId, next);
    return true;
  }
  await ensureTable();
  const result = await query<{ id: string }>("DELETE FROM agent_profiles WHERE id=$1 AND user_id=$2 RETURNING id", [profileId, userId]);
  return result.rows.length > 0;
}
