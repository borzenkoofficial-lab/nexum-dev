interface StatusBarProps {
  projectName: string;
  provider: string;
  previewOnline: boolean;
  onOpenTerminal: () => void;
}

export function StatusBar({ projectName, provider, previewOnline, onOpenTerminal }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-brand">NEXUM.DEV</span>
      <span>Project: {projectName}</span>
      <span>Branch: main</span>
      <span>AI: {provider === "ollama" ? "Ollama" : "Mock"}</span>
      <span>Preview: {previewOnline ? "LIVE" : "OFFLINE"}</span>
      <span>Problems: 0</span>
      <span>Tests: 22 passed</span>
      <span>Environment: Codespace</span>
      <button type="button" className="status-terminal" onClick={onOpenTerminal}>Open Terminal</button>
    </footer>
  );
}
