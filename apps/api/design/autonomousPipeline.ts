import { deriveDesignSpec, readDesignSpec, writeDesignSpec, type DesignSpec } from "./designSpec.js";
import { deriveInteractionContract } from "./interactionEngine.js";
import { componentContracts } from "./componentIntelligence.js";
import { verifyDesign, type VisualVerification } from "./visualVerification.js";
import type { NexumIntent } from "../ai/intentEngine.js";

export type PipelineStage = "intent"|"design"|"components"|"interactions"|"build"|"verify"|"live";
export interface PipelineSnapshot {
  stage: PipelineStage;
  design: DesignSpec;
  componentCount: number;
  interactionCount: number;
  verification?: VisualVerification;
  readyForLive: boolean;
}

export async function prepareAutonomousDesignPipeline(projectRoot:string,intent:NexumIntent):Promise<PipelineSnapshot> {
  const patch=deriveDesignSpec({
    domain:intent.domain,
    productType:intent.productType,
    visualDirection:intent.visualDirection.join(", "),
    audience:intent.audience,
    features:intent.features
  });
  const design=await writeDesignSpec(projectRoot,{...patch,interactions:[]});
  const interactions=deriveInteractionContract(design);
  const finalDesign=await writeDesignSpec(projectRoot,{interactions});
  const verification=await verifyDesign(projectRoot);
  return {
    stage:verification.passed?"verify":"design",
    design:finalDesign,
    componentCount:componentContracts(finalDesign).length,
    interactionCount:finalDesign.interactions.length,
    verification,
    readyForLive:verification.passed
  };
}

export async function getPipelineSnapshot(projectRoot:string):Promise<PipelineSnapshot> {
  const design=await readDesignSpec(projectRoot);
  const verification=await verifyDesign(projectRoot);
  return {
    stage:verification.passed?"verify":"design",
    design,
    componentCount:componentContracts(design).length,
    interactionCount:design.interactions.length,
    verification,
    readyForLive:verification.passed
  };
}
