import type { DesignSpec } from "./designSpec.js";
import type { InteractionEvent } from "./interactionContract.js";

export type InteractionState = "idle"|"pending"|"success"|"error";

export interface InteractionRecord {
  id: string;
  event: InteractionEvent;
  state: InteractionState;
  action: string;
  target?: string;
  createdAt: number;
  resolvedAt?: number;
}

export function createInteractionRecord(event: InteractionEvent, action = event.action ?? event.type): InteractionRecord {
  return { id: crypto.randomUUID(), event, state:"pending", action, target:event.target, createdAt:Date.now() };
}

export function resolveInteraction(record: InteractionRecord, success: boolean): InteractionRecord {
  return {...record,state:success?"success":"error",resolvedAt:Date.now()};
}

export function allowedInteraction(spec: DesignSpec, event: InteractionEvent): boolean {
  if (!["click","submit","change","navigate"].includes(event.type)) return true;
  return spec.interactions.some(item => item.event === event.type && (!item.target || item.target === event.target));
}

export function deriveInteractionContract(spec: DesignSpec): DesignSpec["interactions"] {
  if (spec.interactions.length) return spec.interactions;
  const interactions: DesignSpec["interactions"] = [];
  const add = (id:string, component:string, event:DesignSpec["interactions"][number]["event"], action:string) =>
    interactions.push({id,component,event,action});
  if (spec.components.includes("Button")) add("primary-action","Button","click","execute-primary-action");
  if (spec.components.includes("Form")) add("form-submit","Form","submit","submit-form");
  if (spec.components.includes("Input")) add("field-change","Input","change","update-form-state");
  if (spec.components.includes("Search")) {
    add("search-submit","Search","submit","execute-search");
    add("search-change","Search","change","update-search");
  }
  if (spec.components.includes("Filter")) add("filter-change","Filter","change","update-filter");
  if (spec.components.includes("Navigation")) add("navigation","Navigation","navigate","navigate");
  if (spec.components.includes("Card")) add("card-click","Card","click","open-card");
  if (spec.components.includes("List")) add("list-click","List","click","open-list-item");
  if (spec.components.includes("Table")) add("table-click","Table","click","open-table-item");
  if (spec.components.includes("Modal")) add("modal-close","Modal","click","close-modal");
  if (spec.components.includes("Map")) add("map-click","Map","click","select-map-item");
  if (spec.components.includes("Calendar")) add("calendar-change","Calendar","change","update-calendar");
  return interactions;
}
