import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { LocalFileObjectStore } from "./localObjectStore.js";
import { validateObjectKey } from "./objectStore.js";

test("object keys reject traversal and ambiguous paths", () => {
  for (const key of ["", "/absolute", "../escape", "a/../b", "a//b", "a\\b", "a/./b"]) {
    assert.throws(() => validateObjectKey(key));
  }
  assert.equal(validateObjectKey("users/u1/revisions/1/file.txt"), "users/u1/revisions/1/file.txt");
});

test("local object store writes, reads, verifies and deletes objects", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-object-store-"));
  try {
    const store = new LocalFileObjectStore(root);
    const body = new TextEncoder().encode("durable object contract");
    const metadata = await store.put("workspace/revision/file.txt", body);
    assert.equal(metadata.sizeBytes, body.byteLength);
    assert.deepEqual(await store.get(metadata.key), body);
    assert.deepEqual(await store.head(metadata.key), metadata);
    await assert.rejects(store.put("workspace/revision/file.txt", body, "0".repeat(64)), /checksum mismatch/i);
    await store.delete(metadata.key);
    assert.equal(await store.get(metadata.key), null);
    assert.equal(await store.head(metadata.key), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local object store refuses symlinked object targets and parent directories", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "nexum-object-store-"));
  const outside = await mkdtemp(resolve(tmpdir(), "nexum-object-outside-"));
  try {
    const store = new LocalFileObjectStore(root);
    await writeFile(resolve(outside, "target"), "outside");
    await symlink(resolve(outside, "target"), resolve(root, "linked-file"));
    await assert.rejects(store.get("linked-file"), /regular file/i);
    await symlink(outside, resolve(root, "linked-dir"));
    await assert.rejects(store.put("linked-dir/new-file", new Uint8Array([1])), /unsafe directory/i);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
