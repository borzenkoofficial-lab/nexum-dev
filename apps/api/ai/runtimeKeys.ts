import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { query } from "../db.js";

type RuntimeProvider = "openai" | "openrouter" | "orcarouter";
type StoredKey = { provider: RuntimeProvider; ciphertext: string; iv: string; tag: string };

const memoryKeys = new Map<string, Partial<Record<RuntimeProvider, string>>>();
let tableReady: Promise<boolean> | null = null;

function secretKey(): Buffer | null {
  const secret = process.env.NEXUM_AUTH_SECRET?.trim();
  return secret && secret.length >= 32 ? createHash("sha256").update(secret).digest() : null;
}

async function ensureTable(): Promise<boolean> {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS user_ai_keys (
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          ciphertext TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, provider)
        )
      `);
      return true;
    } catch (error) {
      console.warn("[Nexum] AI key persistence unavailable:", error instanceof Error ? error.message : error);
      return false;
    }
  })();
  return tableReady;
}

function encrypt(value: string): { ciphertext: string; iv: string; tag: string } | null {
  const key = secretKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64url"), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

function decrypt(row: StoredKey): string | null {
  const key = secretKey();
  if (!key) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(row.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function loadRuntimeKeys(userId: string): Promise<Partial<Record<RuntimeProvider, string>>> {
  const cached = memoryKeys.get(userId) ?? {};
  if (!await ensureTable()) return cached;
  try {
    const result = await query<StoredKey>(
      "SELECT provider, ciphertext, iv, auth_tag AS tag FROM user_ai_keys WHERE user_id = $1",
      [userId],
    );
    const loaded = { ...cached };
    for (const row of result.rows) {
      if (row.provider === "openai" || row.provider === "openrouter" || row.provider === "orcarouter") {
        const key = decrypt(row);
        if (key) loaded[row.provider] = key;
      }
    }
    memoryKeys.set(userId, loaded);
    return loaded;
  } catch {
    return cached;
  }
}

export async function saveRuntimeKey(userId: string, provider: RuntimeProvider, apiKey: string): Promise<void> {
  const cached = memoryKeys.get(userId) ?? {};
  memoryKeys.set(userId, { ...cached, [provider]: apiKey });
  const encrypted = encrypt(apiKey);
  if (!encrypted || !await ensureTable()) return;
  try {
    await query(
    `INSERT INTO user_ai_keys (user_id, provider, ciphertext, iv, auth_tag, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, updated_at = NOW()`,
    [userId, provider, encrypted.ciphertext, encrypted.iv, encrypted.tag],
    );
  } catch (error) {
    console.warn("[Nexum] Failed to persist AI key:", error instanceof Error ? error.message : error);
  }
}

export function clearRuntimeMemory(userId: string): void {
  memoryKeys.delete(userId);
}
