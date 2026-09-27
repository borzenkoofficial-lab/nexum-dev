import type { AIProviderStatus } from "./types";

interface StatusBarProps {
  projectName: string;
  provider: string;
  aiStatus: AIProviderStatus | null;
  previewOnline: boolean;
  onOpenTerminal: () => void;
}

export function StatusBar({ projectName, provider, aiStatus, previewOnline, onOpenTerminal }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-brand">NEXUM.DEV</span>
      <span>Project: {projectName}</span>
      <span>Branch: main</span>
      <span>AI: {aiStatus?.available ? `${provider} · online` : `${provider} · offline`}</span>
      <span>Preview: {previewOnline ? "LIVE" : "OFFLINE"}</span>
      <span>Problems: 0</span>
      <span>Tests: 22 passed</span>
      <span>Environment: Codespace</span>
      <button type="button" className="status-terminal" onClick={onOpenTerminal}>Open Terminal</button>
    </footer>
  );
}
