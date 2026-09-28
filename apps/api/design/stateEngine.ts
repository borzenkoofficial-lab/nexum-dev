import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export type StateValue = string | number | boolean | null | string[] | Record<string, unknown>;

export type StateField = {
  id: string;
  initial: StateValue;
  type: "string" | "number" | "boolean" | "array" | "object" | "nullable";
  persisted: boolean;
};

export type StateAction = {
  id: string;
  event: "click" | "submit" | "change" | "navigate";
  sets?: Record<string, StateValue>;
  loadingField?: string;
  successField?: string;
  errorField?: string;
};

export type StateSpec = {
  version: 1;
  fields: StateField[];
  actions: StateAction[];
  updatedAt: string;
};

const defaults = (): StateSpec => ({
  version: 1,
  fields: [
    { id: "loading", initial: false, type: "boolean", persisted: false },
    { id: "error", initial: null, type: "nullable", persisted: false },
    { id: "success", initial: false, type: "boolean", persisted: false },
  ],
  actions: [],
  updatedAt: new Date().toISOString(),
});

export async function readStateSpec(projectRoot: string): Promise<StateSpec> {
  const file = resolve(projectRoot, ".nexum", "state.json");
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<StateSpec>;
    return {
      ...defaults(),
      ...raw,
      fields: Array.isArray(raw.fields) ? raw.fields : defaults().fields,
      actions: Array.isArray(raw.actions) ? raw.actions : [],
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return defaults();
  }
}

export async function writeStateSpec(projectRoot: string, patch: Partial<StateSpec>): Promise<StateSpec> {
  const current = await readStateSpec(projectRoot);
  const next: StateSpec = {
    ...current,
    ...patch,
    fields: patch.fields ?? current.fields,
    actions: patch.actions ?? current.actions,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(resolve(projectRoot, ".nexum"), { recursive: true });
  await writeFile(resolve(projectRoot, ".nexum", "state.json"), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function deriveStateSpec(components: string[], interactions: Array<{ event: StateAction["event"]; action: string }>): StateSpec {
  const base = defaults();
  const fields = [...base.fields];
  if (components.includes("Input") || components.includes("Search")) {
    fields.push({ id: "formValues", initial: {}, type: "object", persisted: false });
  }
  if (components.includes("Filter")) {
    fields.push({ id: "filters", initial: {}, type: "object", persisted: true });
  }
  if (components.includes("Navigation")) {
    fields.push({ id: "route", initial: "/", type: "string", persisted: false });
  }
  const actions: StateAction[] = interactions.map((item, index) => ({
    id: item.action || `interaction-${index + 1}`,
    event: item.event,
    sets: item.event === "navigate" ? { route: "/*" } : undefined,
    loadingField: item.event === "submit" ? "loading" : undefined,
    successField: item.event === "submit" ? "success" : undefined,
    errorField: item.event === "submit" ? "error" : undefined,
  }));
  return { version: 1, fields, actions, updatedAt: new Date().toISOString() };
}

export function validateStateTransition(spec: StateSpec, actionId: string): { allowed: boolean; reason?: string } {
  if (spec.actions.some((action) => action.id === actionId)) return { allowed: true };
  return { allowed: false, reason: `Unknown state action: ${actionId}` };
}
