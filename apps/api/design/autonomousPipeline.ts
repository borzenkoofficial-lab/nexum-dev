import { deriveDesignSpec, readDesignSpec, writeDesignSpec, type DesignSpec } from "./designSpec.js";
import { deriveInteractionContract } from "./interactionEngine.js";
import { componentContracts } from "./componentIntelligence.js";
import { verifyDesign, type VisualVerification } from "./visualVerification.js";
import { inspectLiveUpdate, type LiveUpdateManifest } from "./liveUpdate.js";
import { deriveStateSpec, readStateSpec, writeStateSpec, type StateSpec } from "./stateEngine.js";
import type { NexumIntent } from "../ai/intentEngine.js";

export type PipelineStage = "intent" | "design" | "components" | "interactions" | "build" | "verify" | "live" | "done" | "failed";

export type PipelineGate = {
  name:string;
  passed:boolean;
  detail:string;
};

export function evaluatePipelineGates(snapshot:Pick<PipelineSnapshot,"design"|"componentCount"|"interactionCount"|"verification"|"live"|"buildVerified">):PipelineGate[] {
  return [
    {name:"design",passed:snapshot.design.version===1 && snapshot.design.components.length>0,detail:"DesignSpec exists with components"},
    {name:"components",passed:snapshot.componentCount>0,detail:"Component contracts are available"},
    {name:"interactions",passed:snapshot.interactionCount>0,detail:"Interaction contract is executable"},
    {name:"verification",passed:snapshot.verification?.passed===true,detail:"Visual/domain verification passed"},
    {name:"build",passed:snapshot.buildVerified,detail:"Production build was verified"},
    {name:"live",passed:snapshot.live?.buildReady===true,detail:"Preview entry is available"},
  ];
}

export interface PipelineSnapshot {
  stage: PipelineStage;
  design: DesignSpec;
  componentCount: number;
  interactionCount: number;
  verification?: VisualVerification;
  live?: LiveUpdateManifest;
  state?: StateSpec;
  buildVerified: boolean;
  readyForLive: boolean;
  completed: boolean;
}

export async function prepareAutonomousDesignPipeline(
  projectRoot: string,
  intent: NexumIntent,
): Promise<PipelineSnapshot> {
  const patch = deriveDesignSpec({
    domain: intent.domain,
    productType: intent.productType,
    visualDirection: intent.visualDirection.join(", "),
    audience: intent.audience,
    features: intent.features,
  });
  const design = await writeDesignSpec(projectRoot, { ...patch, interactions: [] });
  const interactions = deriveInteractionContract(design);
  const finalDesign = await writeDesignSpec(projectRoot, { interactions });
  const state = await writeStateSpec(projectRoot, deriveStateSpec(finalDesign.components, finalDesign.interactions.map((item) => ({ event: item.event, action: item.action }))));
  const verification = await verifyDesign(projectRoot);
  const live = await inspectLiveUpdate(projectRoot, "pending");

  const base = {
    design: finalDesign,
    componentCount: componentContracts(finalDesign).length,
    interactionCount: finalDesign.interactions.length,
    state,
    verification,
    live,
    buildVerified: live.buildReady && live.mode === "built-app",
  };
  const gates=evaluatePipelineGates(base);
  const allGates=gates.every((gate)=>gate.passed);
  return {
    stage: allGates ? "done" : gates.find((gate)=>!gate.passed)?.name === "build" ? "build" : "verify",
    ...base,
    readyForLive: allGates,
    completed: allGates,
  };
}

export async function finalizeAutonomousDesignPipeline(
  projectRoot: string,
  projectId: string,
  buildVerified: boolean,
): Promise<PipelineSnapshot> {
  const design = await readDesignSpec(projectRoot);
  const state = await readStateSpec(projectRoot);
  const verification = await verifyDesign(projectRoot);
  const live = await inspectLiveUpdate(projectRoot, projectId);
  const buildReady = buildVerified && (live.mode === "built-app" || live.mode === "static");

  const base = {design,componentCount:componentContracts(design).length,interactionCount:design.interactions.length,state,verification,live,buildVerified};
  const gates=evaluatePipelineGates(base);
  const allGates=gates.every((gate)=>gate.passed);
  return {
    stage: !verification.passed ? "failed" : allGates ? "done" : "build",
    ...base,
    readyForLive: allGates && buildReady,
    completed: allGates && buildReady,
  };
}

export async function getPipelineSnapshot(projectRoot: string): Promise<PipelineSnapshot> {
  const design = await readDesignSpec(projectRoot);
  const verification = await verifyDesign(projectRoot);
  const live = await inspectLiveUpdate(projectRoot, "pending");
  const buildVerified = live.mode === "built-app";

  const base = {
    design,
    componentCount: componentContracts(design).length,
    interactionCount: design.interactions.length,
    verification,
    live,
    buildVerified,
  };
  const gates = evaluatePipelineGates(base);
  const failedGate = gates.find((gate) => !gate.passed);
  return {
    stage: failedGate?.name === "design" ? "design" : failedGate?.name === "components" ? "components" : failedGate?.name === "interactions" ? "interactions" : failedGate?.name === "verification" ? "verify" : failedGate?.name === "build" ? "build" : failedGate?.name === "live" ? "live" : "done",
    ...base,
    readyForLive: gates.every((gate) => gate.passed),
    completed: gates.every((gate) => gate.passed),
  };
}
