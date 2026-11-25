import type { Buffer } from "node:buffer";

export interface ObjectMetadata {
  key: string;
  sizeBytes: number;
  sha256: string;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, expectedSha256?: string): Promise<ObjectMetadata>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<ObjectMetadata | null>;
  delete(key: string): Promise<void>;
}

export function validateObjectKey(key: string): string {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\\0") ||
    key.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Object key is invalid");
  }
  return key;
}
