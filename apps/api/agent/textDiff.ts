/**
 * Line-based diff (Myers O(ND)) producing unified-diff style hunks. Used to
 * show what an Agent job changed (checkpoint snapshot vs current files).
 * Bounded: callers must pre-check size; the edit distance is capped too.
 */
export interface DiffLine { type: "context" | "add" | "remove"; text: string }
export interface DiffHunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }
export interface TextDiff { hunks: DiffHunk[]; additions: number; deletions: number; tooComplex: boolean }

/** Memory is O(D^2) int32 in the worst case: 1000 edits stay under ~8 MB per file. */
export const MAX_DIFF_EDIT_DISTANCE = 1_000;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Op = { type: DiffLine["type"]; oldIndex: number; newIndex: number };

/** Returns the edit script, or null when the distance exceeds the cap. */
function myers(a: string[], b: string[], maxD: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(next);
        return backtrack(trace, a, b, offset);
      }
    }
    v = next;
  }
  return null;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], offset: number): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 2; d >= 0; d -= 1) {
    const v = trace[d]!;
    const k = x - y;
    const prevK = (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : v[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x -= 1; y -= 1; ops.push({ type: "context", oldIndex: x, newIndex: y }); }
    if (d === 0) break;
    if (x === prevX) { y -= 1; ops.push({ type: "add", oldIndex: x, newIndex: y }); }
    else { x -= 1; ops.push({ type: "remove", oldIndex: x, newIndex: y }); }
  }
  while (x > 0 && y > 0) { x -= 1; y -= 1; ops.push({ type: "context", oldIndex: x, newIndex: y }); }
  return ops.reverse();
}

export function diffText(before: string, after: string, context = 3): TextDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = myers(a, b, MAX_DIFF_EDIT_DISTANCE);
  if (!ops) return { hunks: [], additions: 0, deletions: 0, tooComplex: true };
  const additions = ops.filter((op) => op.type === "add").length;
  const deletions = ops.filter((op) => op.type === "remove").length;
  const hunks: DiffHunk[] = [];
  let index = 0;
  while (index < ops.length) {
    while (index < ops.length && ops[index]!.type === "context") index += 1;
    if (index >= ops.length) break;
    let start = Math.max(0, index - context);
    let end = index;
    // Extend while changes are within 2*context of each other.
    while (end < ops.length) {
      if (ops[end]!.type !== "context") { end += 1; continue; }
      let run = end;
      while (run < ops.length && ops[run]!.type === "context") run += 1;
      if (run >= ops.length || run - end > context * 2) { end = Math.min(ops.length, end + context); break; }
      end = run;
    }
    const slice = ops.slice(start, end);
    const first = slice[0]!;
    const oldLines = slice.filter((op) => op.type !== "add").length;
    const newLines = slice.filter((op) => op.type !== "remove").length;
    hunks.push({
      oldStart: oldLines === 0 ? first.oldIndex : first.oldIndex + 1,
      oldLines,
      newStart: newLines === 0 ? first.newIndex : first.newIndex + 1,
      newLines,
      lines: slice.map((op) => ({ type: op.type, text: op.type === "add" ? b[op.newIndex]! : a[op.oldIndex]! })),
    });
    index = end;
    start = end;
  }
  return { hunks, additions, deletions, tooComplex: false };
}
