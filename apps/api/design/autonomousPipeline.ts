import { deriveDesignSpec, readDesignSpec, writeDesignSpec, type DesignSpec } from "./designSpec.js";
import { deriveInteractionContract } from "./interactionEngine.js";
import { componentContracts } from "./componentIntelligence.js";
import { verifyDesign, type VisualVerification } from "./visualVerification.js";
import { inspectLiveUpdate, type LiveUpdateManifest } from "./liveUpdate.js";
import type { NexumIntent } from "../ai/intentEngine.js";

export type PipelineStage = "intent" | "design" | "components" | "interactions" | "build" | "verify" | "live" | "done" | "failed";

export interface PipelineSnapshot {
  stage: PipelineStage;
  design: DesignSpec;
  componentCount: number;
  interactionCount: number;
  verification?: VisualVerification;
  live?: LiveUpdateManifest;
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
  const verification = await verifyDesign(projectRoot);
  const live = await inspectLiveUpdate(projectRoot, "pending");

  return {
    stage: verification.passed ? (live.buildReady ? "live" : "verify") : "design",
    design: finalDesign,
    componentCount: componentContracts(finalDesign).length,
    interactionCount: finalDesign.interactions.length,
    verification,
    live,
    buildVerified: live.buildReady && live.mode === "built-app",
    readyForLive: verification.passed && live.buildReady,
    completed: verification.passed && live.buildReady,
  };
}

export async function finalizeAutonomousDesignPipeline(
  projectRoot: string,
  projectId: string,
  buildVerified: boolean,
): Promise<PipelineSnapshot> {
  const design = await readDesignSpec(projectRoot);
  const verification = await verifyDesign(projectRoot);
  const live = await inspectLiveUpdate(projectRoot, projectId);
  const buildReady = buildVerified && (live.mode === "built-app" || live.mode === "static");

  return {
    stage: !verification.passed ? "failed" : buildReady ? "done" : "build",
    design,
    componentCount: componentContracts(design).length,
    interactionCount: design.interactions.length,
    verification,
    live,
    buildVerified,
    readyForLive: verification.passed && buildReady,
    completed: verification.passed && buildReady,
  };
}

export async function getPipelineSnapshot(projectRoot: string): Promise<PipelineSnapshot> {
  const design = await readDesignSpec(projectRoot);
  const verification = await verifyDesign(projectRoot);
  const live = await inspectLiveUpdate(projectRoot, "pending");
  const buildVerified = live.mode === "built-app";

  return {
    stage: !verification.passed ? "design" : buildVerified ? "live" : "verify",
    design,
    componentCount: componentContracts(design).length,
    interactionCount: design.interactions.length,
    verification,
    live,
    buildVerified,
    readyForLive: verification.passed && live.buildReady,
    completed: verification.passed && buildVerified,
  };
}
