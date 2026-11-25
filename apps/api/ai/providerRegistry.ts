import type { AIGateway } from "./gateway.js";
import { query, withDatabaseTransaction } from "../db.js";
import { encryptMfaSecret, decryptMfaSecret } from "../mfaEncryption.js";

export const PLATFORM_KEYED_PROVIDERS = ["openai", "anthropic", "openrouter", "orcarouter", "anymodel"] as const;
export type PlatformKeyedProvider = typeof PLATFORM_KEYED_PROVIDERS[number];

let gateway: AIGateway | null = null;
let loadPromise: Promise<void> | null = null;

export function bindPlatformAIGateway(value: AIGateway): void {
  gateway = value;
}

function encryptionKey(): string {
  const value = process.env.AI_PROVIDER_ENCRYPTION_KEY?.trim() ?? "";
  if (value.length < 32) throw new Error("AI_PROVIDER_ENCRYPTION_KEY must contain at least 32 characters.");
  return value;
}

export function isPlatformKeyedProvider(value: string): value is PlatformKeyedProvider {
  return (PLATFORM_KEYED_PROVIDERS as readonly string[]).includes(value);
}

export async function loadPlatformProviderCredentials(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!gateway || !process.env.NEXUM_DATABASE_URL?.trim()) return;
    const key = encryptionKey();
    const result = await query<{ provider_id: string; encrypted_secret: string }>(
      "SELECT provider_id, encrypted_secret FROM ai_provider_credentials",
    );
    for (const row of result.rows) {
      if (!isPlatformKeyedProvider(row.provider_id)) continue;
      const secret = decryptMfaSecret(row.encrypted_secret, key);
      gateway.setRuntimeProviderApiKey(row.provider_id, secret);
    }
  })().catch((error) => {
    loadPromise = null;
    console.error("[КВАРД] Platform AI credentials could not be loaded; provider access remains unavailable.", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  });
  return loadPromise;
}

export async function listPlatformProviders() {
  if (!gateway) throw new Error("Platform AI Gateway is not initialized.");
  const stored = await query<{ provider_id: string; status: string; last_verified_at: string | null; updated_at: string }>(
    "SELECT provider_id, status, last_verified_at, updated_at FROM ai_provider_credentials",
  );
  const byId = new Map(stored.rows.map((row) => [row.provider_id, row]));
  return gateway.getProviders().filter((provider) => isPlatformKeyedProvider(provider.id)).map((provider) => {
    const saved = byId.get(provider.id);
    const runtimeConfigured = gateway!.hasRuntimeProviderApiKey(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      defaultModel: provider.model,
      isDefault: provider.isDefault,
      protocol: provider.protocol ?? null,
      legacyProtocol: provider.legacyProtocol ?? null,
      adapterVersion: provider.adapterVersion ?? null,
      adapterMode: provider.adapterMode,
      configured: Boolean(saved) || runtimeConfigured,
      runtimeReady: runtimeConfigured,
      source: saved ? "database" : runtimeConfigured ? "environment" : "missing",
      status: saved?.status ?? (runtimeConfigured ? "environment_configured" : "missing"),
      lastVerifiedAt: saved?.last_verified_at ?? null,
      updatedAt: saved?.updated_at ?? null,
    };
  });
}

export async function savePlatformProviderCredential(
  providerId: PlatformKeyedProvider,
  apiKey: string,
  actorUserId: string,
  requestId: string | null,
): Promise<void> {
  if (!gateway) throw new Error("Platform AI Gateway is not initialized.");
  const secret = apiKey.trim();
  if (secret.length < 8 || secret.length > 4096) throw new Error("API key length is invalid.");
  const key = encryptionKey();
  // Validate that this provider supports runtime credentials before persisting anything.
  gateway.setRuntimeProviderApiKey(providerId, secret);
  const encrypted = encryptMfaSecret(secret, key);
  await withDatabaseTransaction(async (client) => {
    await client.query(
      `INSERT INTO ai_provider_credentials (provider_id, encrypted_secret, status, configured_by)
       VALUES ($1, $2, 'configured', $3)
       ON CONFLICT (provider_id) DO UPDATE SET encrypted_secret = EXCLUDED.encrypted_secret,
         status = 'configured', configured_by = EXCLUDED.configured_by,
         last_verified_at = NULL, updated_at = NOW()`,
      [providerId, encrypted, actorUserId],
    );
    await client.query(
      `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata)
       VALUES ($1, 'ai.provider.credential.rotate', 'ai_provider', $2, $3, '{"secretStored":true}'::jsonb)`,
      [actorUserId, providerId, requestId],
    );
  });
}

export async function verifyPlatformProvider(providerId: PlatformKeyedProvider, actorUserId: string, requestId: string | null) {
  if (!gateway) throw new Error("Platform AI Gateway is not initialized.");
  const status = await gateway.getStatus(providerId);
  await withDatabaseTransaction(async (client) => {
    await client.query(
      "UPDATE ai_provider_credentials SET status = $2, last_verified_at = CASE WHEN $2 = 'verified' THEN NOW() ELSE last_verified_at END, updated_at = NOW() WHERE provider_id = $1",
      [providerId, status.available ? "verified" : "invalid"],
    );
    await client.query(
      `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata)
       VALUES ($1, 'ai.provider.verify', 'ai_provider', $2, $3, $4::jsonb)`,
      [actorUserId, providerId, requestId, JSON.stringify({ available: status.available, latencyMs: status.latencyMs })],
    );
  });
  return { available: status.available, model: status.model, latencyMs: status.latencyMs, error: status.available ? undefined : "Provider verification failed." };
}
