import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export class ProjectPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPathError";
  }
}

export function resolveProjectPath(projectRoot: string, requestedPath: string): string {
  const input = requestedPath.trim();

  if (!input) {
    throw new ProjectPathError("Path must stay inside the project directory");
  }

  // AI models sometimes return the full active-project path. Accept it only
  // when it resolves inside the active project; never allow an external path.
  const resolvedPath = isAbsolute(input) ? resolve(input) : resolve(projectRoot, input);
  if (!isAbsolute(input) && input.split(/[\\/]/).includes("..")) {
    throw new ProjectPathError("Path must stay inside the project directory");
  }

  const relativePath = relative(projectRoot, resolvedPath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ProjectPathError("Path must stay inside the project directory");
  }

  return resolvedPath;
}

export async function assertExistingProjectPath(
  projectRoot: string,
  requestedPath: string,
): Promise<string> {
  const resolvedPath = resolveProjectPath(projectRoot, requestedPath);
  await access(resolvedPath);

  const [realRoot, realPath] = await Promise.all([
    realpath(projectRoot),
    realpath(resolvedPath),
  ]);
  const relativePath = relative(realRoot, realPath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ProjectPathError("Path must stay inside the project directory");
  }

  return resolvedPath;
}

export async function assertWritableProjectPath(
  projectRoot: string,
  requestedPath: string,
): Promise<string> {
  const resolvedPath = resolveProjectPath(projectRoot, requestedPath);
  const realRoot = await realpath(projectRoot);
  let existingParent = dirname(resolvedPath);

  while (true) {
    try {
      const realParent = await realpath(existingParent);
      const relativeParent = relative(realRoot, realParent);

      if (relativeParent.startsWith("..") || isAbsolute(relativeParent)) {
        throw new ProjectPathError("Path must stay inside the project directory");
      }

      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

      const parent = dirname(existingParent);
      if (parent === existingParent) {
        throw new ProjectPathError("Path must stay inside the project directory");
      }
      existingParent = parent;
    }
  }

  try {
    const realPath = await realpath(resolvedPath);
    const relativePath = relative(realRoot, realPath);

    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new ProjectPathError("Path must stay inside the project directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return resolvedPath;
}
