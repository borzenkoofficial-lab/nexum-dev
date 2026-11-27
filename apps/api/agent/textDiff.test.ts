import assert from "node:assert/strict";
import { test } from "node:test";
import { diffText, splitLines } from "./textDiff.js";

function render(before: string, after: string): string {
  return diffText(before, after).hunks.map((hunk) =>
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n` +
    hunk.lines.map((line) => (line.type === "add" ? "+" : line.type === "remove" ? "-" : " ") + line.text).join("\n"),
  ).join("\n");
}

test("identical text has no hunks", () => {
  const result = diffText("a\nb\n", "a\nb\n");
  assert.deepEqual(result, { hunks: [], additions: 0, deletions: 0, tooComplex: false });
});

test("a single line change yields one hunk with context", () => {
  const before = ["1", "2", "3", "4", "5", "6", "7"].join("\n");
  const after = ["1", "2", "3", "FOUR", "5", "6", "7"].join("\n");
  assert.equal(render(before, after), "@@ -1,7 +1,7 @@\n 1\n 2\n 3\n-4\n+FOUR\n 5\n 6\n 7");
});

test("distant changes produce separate hunks with correct line numbers", () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
  const lines = before.split("\n");
  lines[1] = "changed 2";
  lines[27] = "changed 28";
  const result = diffText(before, lines.join("\n"));
  assert.equal(result.hunks.length, 2);
  assert.equal(result.additions, 2);
  assert.equal(result.deletions, 2);
  assert.deepEqual([result.hunks[0]!.oldStart, result.hunks[1]!.oldStart], [1, 25]);
});

test("new and deleted files", () => {
  assert.equal(render("", "a\nb"), "@@ -0,0 +1,2 @@\n+a\n+b");
  assert.equal(render("a\nb\n", ""), "@@ -1,2 +0,0 @@\n-a\n-b");
});

test("applying the hunks to the old text reproduces the new text", () => {
  const before = "import a\nconst x = 1\nfunction f() {\n  return x\n}\nexport { f }\n";
  const after = "import a\nimport b\nconst x = 2\nfunction f() {\n  return x + 1\n}\n";
  const result = diffText(before, after);
  const rebuilt: string[] = [];
  const old = splitLines(before);
  let cursor = 0;
  for (const hunk of result.hunks) {
    const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    rebuilt.push(...old.slice(cursor, start));
    cursor = start;
    for (const line of hunk.lines) {
      if (line.type === "add") rebuilt.push(line.text);
      else { assert.equal(old[cursor], line.text); cursor += 1; if (line.type === "context") rebuilt.push(line.text); }
    }
  }
  rebuilt.push(...old.slice(cursor));
  assert.deepEqual(rebuilt, splitLines(after));
});

test("an unbounded rewrite is reported as too complex instead of hanging", () => {
  const before = Array.from({ length: 5000 }, (_, i) => `a${i}`).join("\n");
  const after = Array.from({ length: 5000 }, (_, i) => `b${i}`).join("\n");
  const started = Date.now();
  const result = diffText(before, after);
  assert.equal(result.tooComplex, true);
  assert.ok(Date.now() - started < 5000);
});
