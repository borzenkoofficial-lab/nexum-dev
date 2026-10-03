export type AgentFailure =
  | "MODEL_FAILURE"
  | "NETWORK_FAILURE"
  | "TOOL_FAILURE"
  | "VALIDATION_FAILURE"
  | "TIMEOUT"
  | "CANCELLATION"
  | "CORRUPTED_CHECKPOINT";

const active = process.env.NODE_ENV !== "production" && process.env.NEXUM_E2E_FAILURE_INJECTION === "true";
const enabled = new Set<AgentFailure>(
  (process.env.NEXUM_AGENT_FAILURES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is AgentFailure => [
      "MODEL_FAILURE","NETWORK_FAILURE","TOOL_FAILURE","VALIDATION_FAILURE","TIMEOUT","CANCELLATION","CORRUPTED_CHECKPOINT",
    ].includes(value as AgentFailure)),
);

export const agentFailureInjection = {
  active,
  isEnabled(name: AgentFailure) {
    return active && enabled.has(name);
  },
  list() {
    return active ? [...enabled] : [];
  },
};
