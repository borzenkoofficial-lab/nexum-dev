import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { validateObjectKey, type ObjectMetadata, type ObjectStore } from "./objectStore.js";

/**
 * Local development/test adapter only. Production must use a durable object store.
 * The adapter intentionally does not silently select itself from environment config.
 */
export class LocalFileObjectStore implements ObjectStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, body: Uint8Array, expectedSha256?: string): Promise<ObjectMetadata> {
    const target = this.resolveKey(key);
    const bytes = Buffer.from(body);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (expectedSha256 && expectedSha256 !== sha256) {
      throw new Error("Object checksum mismatch");
    }

    await this.ensureSafeParent(dirname(target));
    try {
      const current = await lstat(target);
      if (current.isSymbolicLink() || !current.isFile()) {
        throw new Error("Object target must be a regular file");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const temporary = resolve(dirname(target), `.tmp-${randomUUID()}`);
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    return { key, sizeBytes: bytes.byteLength, sha256 };
  }

  async get(key: string): Promise<Uint8Array | null> {
    const target = this.resolveKey(key);
    try {
      const details = await lstat(target);
      if (details.isSymbolicLink() || !details.isFile()) {
        throw new Error("Stored object is not a regular file");
      }
      return new Uint8Array(await readFile(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const body = await this.get(key);
    if (!body) return null;
    return {
      key,
      sizeBytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveKey(key);
    try {
      const details = await lstat(target);
      if (details.isSymbolicLink() || !details.isFile()) {
        throw new Error("Stored object is not a regular file");
      }
      await rm(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private resolveKey(key: string): string {
    const validKey = validateObjectKey(key);
    const target = resolve(this.root, ...validKey.split("/"));
    const rel = relative(this.root, target);
    if (!rel || rel.startsWith(`..${sep}`) || rel === "..") {
      throw new Error("Object key escapes storage root");
    }
    return target;
  }

  private async ensureSafeParent(parent: string): Promise<void> {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const rel = relative(this.root, parent);
    let current = this.root;
    for (const segment of rel.split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      const details = await lstat(current);
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw new Error("Object storage path contains an unsafe directory");
      }
    }
  }
}
