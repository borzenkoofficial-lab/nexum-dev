export type AgentState =
  | "IDLE"
  | "UNDERSTANDING"
  | "PLANNING"
  | "EXECUTING"
  | "OBSERVING"
  | "VALIDATING"
  | "REPAIRING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

const transitions: Record<AgentState, readonly AgentState[]> = {
  IDLE: ["UNDERSTANDING", "CANCELLED", "FAILED"],
  UNDERSTANDING: ["PLANNING", "FAILED", "CANCELLED"],
  PLANNING: ["EXECUTING", "FAILED", "CANCELLED"],
  EXECUTING: ["OBSERVING", "FAILED", "CANCELLED"],
  OBSERVING: ["EXECUTING", "VALIDATING", "FAILED", "CANCELLED"],
  VALIDATING: ["VERIFYING", "REPAIRING", "FAILED", "CANCELLED"],
  REPAIRING: ["EXECUTING", "VALIDATING", "FAILED", "CANCELLED"],
  VERIFYING: ["COMPLETED", "REPAIRING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionAgentState(from: AgentState, to: AgentState): boolean {
  return from === to || transitions[from].includes(to);
}

export class AgentStateMachine {
  private current: AgentState = "IDLE";

  get state(): AgentState {
    return this.current;
  }

  transition(next: AgentState): void {
    if (!canTransitionAgentState(this.current, next)) {
      throw new Error(`Invalid Agent state transition: ${this.current} -> ${next}`);
    }
    this.current = next;
  }

  reset(): void {
    this.current = "IDLE";
  }
}
