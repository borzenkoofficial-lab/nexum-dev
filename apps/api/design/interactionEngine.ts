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
  return spec.interactions.length ? spec.interactions : [
    {id:"primary-action",component:"Button",event:"click",action:"execute-primary-action"},
    {id:"form-submit",component:"Form",event:"submit",action:"submit-form"},
    {id:"field-change",component:"Input",event:"change",action:"update-form-state"},
    {id:"navigation",component:"Navigation",event:"navigate",action:"navigate"},
  ];
}
