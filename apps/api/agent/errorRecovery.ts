export type ErrorCategory =
  | "typescript"
  | "syntax"
  | "dependency"
  | "build"
  | "runtime"
  | "path"
  | "tool"
  | "unknown";

export interface ErrorDiagnosis {
  category: ErrorCategory;
  priority: number;
  summary: string;
  evidence: string;
  likelyFiles: string[];
  strategy: string;
}

export function diagnoseError(output: string): ErrorDiagnosis {
  const text = output.slice(-12000);
  const fileMatches = [...text.matchAll(/(?:^|\s)([A-Za-z0-9_.-]+\/(?:[A-Za-z0-9_./-]+)|(?:src|app|pages)\/[A-Za-z0-9_./-]+):\d+(?::\d+)?/g)]
    .map((match) => match[1])
    .filter(Boolean);
  const likelyFiles = [...new Set(fileMatches.filter((file): file is string => Boolean(file)))].slice(0, 8);

  if (/(?:TS\d+|TypeScript|tsc)/i.test(text)) {
    return { category: "typescript", priority: 1, summary: "TypeScript error", evidence: text.slice(-1600), likelyFiles, strategy: "Inspect the reported file and type error, apply the smallest targeted fix, then rerun typecheck/build." };
  }
  if (/(?:parse error|syntaxerror|unexpected token|invalid unicode escape|unterminated)/i.test(text)) {
    return { category: "syntax", priority: 1, summary: "Syntax or parser error", evidence: text.slice(-1600), likelyFiles, strategy: "Read the failing file around the reported location, correct syntax/escaping, then rerun the same check." };
  }
  if (/(?:module not found|cannot find module|missing script|npm ERR|ERESOLVE|peer dep)/i.test(text)) {
    return { category: "dependency", priority: 2, summary: "Dependency or npm configuration error", evidence: text.slice(-1600), likelyFiles, strategy: "Inspect package.json and the exact missing dependency/script before changing dependencies; install only what the project requires." };
  }
  if (/(?:ENOENT|no such file|file not found|invalid path|path is not allowed)/i.test(text)) {
    return { category: "path", priority: 2, summary: "Project path or missing-file error", evidence: text.slice(-1600), likelyFiles, strategy: "Inspect the project tree and use an exact existing relative path; never invent a filesystem path." };
  }
  if (/(?:runtime|referenceerror|typeerror|uncaught|unhandledrejection)/i.test(text)) {
    return { category: "runtime", priority: 1, summary: "Runtime error", evidence: text.slice(-1600), likelyFiles, strategy: "Locate the runtime stack frame, inspect the responsible component/module, patch the smallest cause, then rerun the relevant check." };
  }
  if (/(?:build failed|failed to build|vite|webpack|rollup)/i.test(text)) {
    return { category: "build", priority: 2, summary: "Build error", evidence: text.slice(-1600), likelyFiles, strategy: "Inspect the exact build output and responsible file, make a targeted fix, then rerun the build." };
  }
  if (/(?:tool|command is not allowed|tool failed)/i.test(text)) {
    return { category: "tool", priority: 3, summary: "Tool execution error", evidence: text.slice(-1600), likelyFiles, strategy: "Validate the tool input against the active project scope and choose an allowed alternative action." };
  }
  return { category: "unknown", priority: 4, summary: "Unclassified project error", evidence: text.slice(-1600), likelyFiles, strategy: "Inspect the latest failed action and relevant files before attempting another change." };
}
