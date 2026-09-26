import type { AIProviderInfo, AIProviderStatus, AgentStage } from "./types";

interface TopBarProps {
  projectName: string;
  providers: AIProviderInfo[];
  models: string[];
  provider: string;
  model: string;
  ollamaStatus: AIProviderStatus | null;
  stage: AgentStage;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
  onToggleSidebar: () => void;
}

export function TopBar({
  projectName,
  providers,
  models,
  provider,
  model,
  ollamaStatus,
  stage,
  onProviderChange,
  onModelChange,
  onToggleSidebar,
}: TopBarProps) {
  const stageLabel = stage === "thinking" ? "Thinking..." : stage === "running" ? "Running tool..." : stage === "building" ? "Building..." : "Ready";

  return (
    <header className="header">
      <div>
        <button className="mobile-menu" type="button" aria-label="Open project drawer" onClick={onToggleSidebar}>☰</button>
        <div className="title">{projectName}</div>
        <div className="subtitle">AI development workspace</div>
      </div>
      <div className="header-tools">
        <div className="ai-controls" aria-label="AI provider and model selection">
          <label><span>Provider</span><select value={provider} aria-label="AI provider" onChange={(event) => onProviderChange(event.target.value)}>
            {providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          <label><span>Model</span><select value={model} aria-label="AI model" onChange={(event) => onModelChange(event.target.value)}>
            {(models.length > 0 ? models : [model]).map((item) => <option value={item} key={item}>{item}</option>)}
          </select></label>
          {provider === "ollama" && ollamaStatus && !ollamaStatus.available && <span className="ai-unavailable" role="status">Ollama unavailable</span>}
        </div>
        <div className={`status ${stage ? "status-working" : ""}`} role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true">●</span> {stageLabel}
        </div>
      </div>
    </header>
  );
}
