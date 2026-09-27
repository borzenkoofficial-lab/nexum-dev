import type { AIProviderStatus } from "./types";

interface StatusBarProps {
  projectName: string;
  provider: string;
  aiStatus: AIProviderStatus | null;
  previewOnline: boolean;
}

export function StatusBar({ projectName, provider, aiStatus, previewOnline }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-brand">NEXUM.DEV</span>
      <span>Проект: {projectName}</span>
      <span>Ветка: main</span>
      <span>ИИ: {aiStatus?.available ? `${provider} · онлайн` : `${provider} · офлайн`}</span>
      <span>Предпросмотр: {previewOnline ? "РАБОТАЕТ" : "ОФЛАЙН"}</span>
      <span>Проблемы: 0</span>
      <span>Тесты: 22 пройдено</span>
      <span>Среда: Codespace</span>
        </footer>
  );
}
