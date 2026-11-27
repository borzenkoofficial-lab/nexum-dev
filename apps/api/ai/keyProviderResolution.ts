export type KeyVerificationProvider = "openai" | "openrouter" | "anymodel" | "orcarouter";

const SUPPORTED = new Set<KeyVerificationProvider>(["openai", "openrouter", "anymodel", "orcarouter"]);

/**
 * Picks the single provider a user-supplied API key may be sent to for
 * verification. A key is a secret for one vendor: it must never be "tried"
 * against several third-party services. Returns null when the provider is
 * neither stated explicitly nor identifiable from an unambiguous key prefix.
 */
export function resolveKeyVerificationProvider(requested: unknown, apiKey: string): KeyVerificationProvider | null {
  const explicit = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (SUPPORTED.has(explicit as KeyVerificationProvider)) return explicit as KeyVerificationProvider;
  if (/^sk-orca-/i.test(apiKey)) return "orcarouter";
  if (/^sk-or-/i.test(apiKey)) return "openrouter";
  if (/^sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}$/.test(apiKey)) return "openai";
  return null;
}
