import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CheckpointManager } from "./checkpoint.js";

describe("CheckpointManager", () => {
  it("creates a snapshot and restores modified, added, and deleted files", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexum-checkpoint-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "original", "utf8");
    const manager = new CheckpointManager(root);

    const checkpoint = await manager.create("p1", root, "before agent");
    await writeFile(join(root, "src", "app.ts"), "changed", "utf8");
    await writeFile(join(root, "src", "new.ts"), "new", "utf8");

    await manager.rollback("p1", root, checkpoint.id);

    expect(await readFile(join(root, "src", "app.ts"), "utf8")).toBe("original");
    await expect(readFile(join(root, "src", "new.ts"), "utf8")).rejects.toThrow();
  });

  it("does not snapshot protected runtime dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexum-checkpoint-"));
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "node_modules", "ignored.txt"), "ignored", "utf8");
    const manager = new CheckpointManager(root);
    const checkpoint = await manager.create("p2", root);
    expect(checkpoint.files.some((file) => file.path.startsWith("node_modules/"))).toBe(false);
  });
});
