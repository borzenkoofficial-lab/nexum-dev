import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void fetch("/api/agent/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "nexum",
        message: error.message,
        stack: error.stack,
        source: "app-error-boundary",
        componentStack: info.componentStack,
      }),
      keepalive: true,
    }).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 32, fontFamily: "system-ui, sans-serif", background: "#f5f6f8", color: "#15181d" }}>
        <section style={{ width: "min(720px, 100%)", padding: 28, border: "1px solid #e1e5ea", borderRadius: 16, background: "#fff" }}>
          <strong>NEXUM не смог отрисовать интерфейс</strong>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#697386" }}>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()} style={{ minHeight: 42, padding: "0 16px", border: "1px solid #d7ad00", borderRadius: 8, background: "#f2c400", cursor: "pointer" }}>
            Перезагрузить
          </button>
        </section>
      </main>
    );
  }
}
