import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[NEXUM] React render error:", error, info);
    void fetch("/api/agent/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message || "React render error", stack: error.stack, source: "react-boundary", url: window.location.href }),
      keepalive: true,
    }).catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,boxSizing:"border-box",background:"#080a0d",color:"#f2f5f3",fontFamily:"Inter,system-ui,sans-serif"}}>
      <section style={{width:"min(720px,100%)",padding:28,border:"1px solid rgba(255,255,255,.12)",borderRadius:16,background:"#101419",boxShadow:"0 24px 80px rgba(0,0,0,.4)"}}>
        <div style={{color:"#d9ff4a",fontSize:11,fontWeight:800,letterSpacing:".14em"}}>NEXUM RUNTIME</div>
        <h1 style={{margin:"10px 0 8px",fontSize:24}}>Ошибка рабочего пространства</h1>
        <p style={{color:"#9aa4af",lineHeight:1.6}}>React остановил текущий экран из-за ошибки рендера. Ошибка автоматически отправлена в диагностику.</p>
        <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",margin:0,padding:14,borderRadius:10,background:"#080b0f",color:"#ffaaa4",fontSize:12}}>{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.reload()} style={{marginTop:18,minHeight:40,padding:"0 16px",border:0,borderRadius:9,background:"#d9ff4a",color:"#101500",fontWeight:800,cursor:"pointer"}}>Перезагрузить NEXUM</button>
      </section>
    </main>;
  }
}
