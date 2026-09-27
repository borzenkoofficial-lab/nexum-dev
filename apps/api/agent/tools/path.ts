import { access, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export class ProjectPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPathError";
  }
}

export function resolveProjectPath(projectRoot: string, requestedPath: string): string {
  const input = requestedPath.trim();

  if (!input) {
    throw new ProjectPathError(`Path must stay inside the project directory: ${requestedPath}`);
  }

  // Normalize paths that AI models commonly return:
  // - index.html
  // - projects/<active-project>/index.html
  // - /.../projects/<active-project>/index.html
  // The final path is always forced back into the active project root.
  const normalizedInput = input.replace(/\\/g, "/");
  const normalizedRoot = projectRoot.replace(/\\/g, "/").replace(/\\/+$/, "");
  const activeProjectName = basename(normalizedRoot);
  const projectPrefix = "projects/" + activeProjectName;
  const rootMarker = normalizedRoot + "/";
  let candidate = normalizedInput;

  // Models may emit the exact absolute project path or a workspace-relative
  // path such as ./projects/nexum/index.html. Normalize both to the active root.
  if (normalizedInput.startsWith(rootMarker)) {
    candidate = normalizedInput.slice(rootMarker.length);
  } else if (!isAbsolute(normalizedInput)) {
    const relativeInput = normalizedInput.replace(/^\.\//, "");
    if (relativeInput === projectPrefix) {
      candidate = ".";
    } else if (relativeInput.startsWith(projectPrefix + "/")) {
      candidate = relativeInput.slice(projectPrefix.length + 1);
    }
  }

  if (!isAbsolute(candidate) && candidate.split("/").includes("..")) {
    throw new ProjectPathError("Path must stay inside the project directory");
  }

  const resolvedPath = isAbsolute(candidate) ? resolve(candidate) : resolve(projectRoot, candidate);

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
