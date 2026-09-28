import type { DesignSpec } from "./designSpec.js";

export type ComponentState = "idle"|"hover"|"focus"|"active"|"disabled"|"loading"|"error"|"success"|"empty";

export interface ComponentContract {
  name: string;
  category: "layout"|"input"|"feedback"|"navigation"|"data"|"overlay";
  props: string[];
  states: ComponentState[];
  events: Array<"click"|"submit"|"change"|"navigate">;
  tokenBindings: string[];
  accessibility: { keyboard: boolean; focusVisible: boolean; ariaRequired: boolean };
}

const BASE: ComponentContract[] = [
  {name:"Button",category:"input",props:["variant","size","disabled","loading"],states:["idle","hover","focus","active","disabled","loading"],events:["click"],tokenBindings:["colors.primary","colors.accent","radius.sm","motion.duration"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}},
  {name:"Input",category:"input",props:["name","value","placeholder","disabled","required"],states:["idle","focus","disabled","error","success"],events:["change"],tokenBindings:["colors.surface","colors.text","colors.border","radius.sm"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}},
  {name:"Form",category:"input",props:["onSubmit","validation"],states:["idle","loading","error","success"],events:["submit"],tokenBindings:["spacing.unit","motion.duration"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}},
  {name:"Card",category:"layout",props:["variant","interactive"],states:["idle","hover","focus","active"],events:["click"],tokenBindings:["colors.surface","colors.border","radius.md"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:false}},
  {name:"Navigation",category:"navigation",props:["items","activeRoute"],states:["idle","focus","active"],events:["navigate"],tokenBindings:["colors.background","colors.text","spacing.unit"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}},
  {name:"Modal",category:"overlay",props:["open","title","onClose"],states:["idle","active"],events:["click","navigate"],tokenBindings:["colors.surface","radius.lg","motion.duration"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}},
  {name:"Table",category:"data",props:["columns","rows","loading","empty"],states:["idle","loading","empty","error"],events:["click","navigate"],tokenBindings:["colors.surface","colors.border","spacing.unit"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}},
  {name:"List",category:"data",props:["items","loading","empty"],states:["idle","loading","empty","error"],events:["click","navigate"],tokenBindings:["colors.surface","colors.border","spacing.unit"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:false}},
  {name:"Search",category:"input",props:["value","placeholder","loading"],states:["idle","focus","loading","error"],events:["change","submit"],tokenBindings:["colors.surface","colors.text","colors.border","radius.pill"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}},
  {name:"Filter",category:"input",props:["options","value","multiple"],states:["idle","focus","active","disabled"],events:["change"],tokenBindings:["colors.surface","colors.border","radius.sm"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}},
  {name:"Map",category:"data",props:["markers","center","zoom"],states:["idle","loading","error","empty"],events:["click","navigate"],tokenBindings:["colors.surface","colors.border"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:false}},
  {name:"Calendar",category:"data",props:["value","min","max","events"],states:["idle","focus","disabled","error"],events:["change","navigate"],tokenBindings:["colors.surface","colors.border","radius.md"],accessibility:{keyboard:true,focusVisible:true,ariaRequired:true}}
];

export function componentContracts(spec: DesignSpec): ComponentContract[] {
  const wanted = new Set(spec.components);
  return BASE.filter(component => wanted.has(component.name));
}

export function componentContract(spec: DesignSpec, name: string): ComponentContract | undefined {
  return componentContracts(spec).find(component => component.name === name);
}

export function validateComponentUsage(spec: DesignSpec, usage: Array<{name:string;events?:string[];states?:string[]}>): string[] {
  const errors: string[] = [];
  for (const item of usage) {
    const contract = componentContract(spec, item.name);
    if (!contract) { errors.push(`Unknown component: ${item.name}`); continue; }
    for (const event of item.events ?? []) if (!(contract.events as string[]).includes(event)) errors.push(`${item.name} does not support event ${event}`);
    for (const state of item.states ?? []) if (!(contract.states as string[]).includes(state)) errors.push(`${item.name} does not support state ${state}`);
  }
  return errors;
}
