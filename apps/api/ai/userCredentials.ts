import { query } from "../db.js";
import { decryptMfaSecret, encryptMfaSecret } from "../mfaEncryption.js";
import type { KeyVerificationProvider } from "./keyProviderResolution.js";

export interface UserCredential { providerId: KeyVerificationProvider; secret: string }

/**
 * Durable storage of a user's own AI key so it survives API restarts and is
 * visible to every API instance. Secrets are persisted only encrypted; without
 * a valid AI_PROVIDER_ENCRYPTION_KEY persistence is disabled (never plaintext).
 */
export interface UserCredentialStore {
  readonly durable: boolean;
  save(userId: string, credential: UserCredential): Promise<void>;
  load(userId: string): Promise<UserCredential | null>;
}

export class MemoryUserCredentialStore implements UserCredentialStore {
  readonly durable = false;
  private readonly items = new Map<string, UserCredential>();
  async save(userId: string, credential: UserCredential): Promise<void> { this.items.set(userId, { ...credential }); }
  async load(userId: string): Promise<UserCredential | null> { const item = this.items.get(userId); return item ? { ...item } : null; }
}

export class PostgresUserCredentialStore implements UserCredentialStore {
  readonly durable = true;
  constructor(private readonly encryptionKey: string) {
    if (encryptionKey.length < 32) throw new Error("AI_PROVIDER_ENCRYPTION_KEY must contain at least 32 characters.");
  }
  async save(userId: string, credential: UserCredential): Promise<void> {
    await query(
      `INSERT INTO user_ai_credentials (user_id, provider_id, encrypted_secret) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET provider_id = EXCLUDED.provider_id, encrypted_secret = EXCLUDED.encrypted_secret, updated_at = NOW()`,
      [userId, credential.providerId, encryptMfaSecret(credential.secret, this.encryptionKey)],
    );
  }
  async load(userId: string): Promise<UserCredential | null> {
    const result = await query<{ provider_id: KeyVerificationProvider; encrypted_secret: string }>(
      "SELECT provider_id, encrypted_secret FROM user_ai_credentials WHERE user_id = $1",
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { providerId: row.provider_id, secret: decryptMfaSecret(row.encrypted_secret, this.encryptionKey) };
  }
}

export function createUserCredentialStore(env: NodeJS.ProcessEnv = process.env): UserCredentialStore {
  const key = env.AI_PROVIDER_ENCRYPTION_KEY?.trim() ?? "";
  if (env.NEXUM_DATABASE_URL?.trim() && key.length >= 32) return new PostgresUserCredentialStore(key);
  if (env.NEXUM_DATABASE_URL?.trim()) {
    console.warn("[Nexum] AI_PROVIDER_ENCRYPTION_KEY is missing or too short: user AI keys are kept in memory only.");
  }
  return new MemoryUserCredentialStore();
}
