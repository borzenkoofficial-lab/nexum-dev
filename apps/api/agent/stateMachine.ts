import type { AgentState } from "./types.js";

const ALLOWED: Record<AgentState, AgentState[]> = {
  IDLE: ["UNDERSTANDING", "FAILED", "CANCELLED"],
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

export class AgentStateMachine {
  private state: AgentState = "IDLE";
  private readonly history: Array<{ from: AgentState; to: AgentState; at: number }> = [];

  constructor(private readonly onInvalid?: (from: AgentState, to: AgentState) => void) {}

  getState(): AgentState { return this.state; }
  getHistory(): Array<{ from: AgentState; to: AgentState; at: number }> { return this.history.slice(); }

  canTransition(to: AgentState): boolean {
    return this.state === to || ALLOWED[this.state].includes(to);
  }

  transition(to: AgentState): boolean {
    if (this.state === to) return true;
    if (!this.canTransition(to)) {
      this.onInvalid?.(this.state, to);
      return false;
    }
    const from = this.state;
    this.state = to;
    this.history.push({ from, to, at: Date.now() });
    return true;
  }
}

export function allowedAgentTransitions(state: AgentState): AgentState[] {
  return [...ALLOWED[state]];
}
