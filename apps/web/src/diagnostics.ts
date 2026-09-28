type DiagnosticLevel = "info" | "warn" | "error";
type DiagnosticEvent = { type: string; level?: DiagnosticLevel; message: string; projectId?: string; jobId?: string; metadata?: Record<string, unknown> };
const SESSION_KEY = "nexum:diagnostics-session";
let sessionId = "", started = false;
let originalConsoleError: typeof console.error | undefined, originalConsoleWarn: typeof console.warn | undefined, originalFetch: typeof window.fetch | undefined;
function getSessionId() {
  if (sessionId) return sessionId;
  try { sessionId = localStorage.getItem(SESSION_KEY) || crypto.randomUUID(); localStorage.setItem(SESSION_KEY, sessionId); }
  catch { sessionId = crypto.randomUUID(); }
  return sessionId;
}
function emit(event: DiagnosticEvent) {
  void fetch("/api/diagnostics/events", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...event,sessionId:getSessionId(),route:window.location.pathname}), keepalive:true }).catch(()=>{});
}
export function diagnosticsEvent(event: DiagnosticEvent) { if (started) emit(event); }
export function startDiagnostics() {
  if (started) return; started = true; getSessionId();
  const onError = (event: ErrorEvent) => emit({type:"runtime-error",level:"error",message:event.message||"Browser runtime error",metadata:{stack:event.error?.stack,source:event.filename,line:event.lineno,column:event.colno}});
  const onRejection = (event: PromiseRejectionEvent) => emit({type:"unhandled-rejection",level:"error",message:event.reason instanceof Error?event.reason.message:String(event.reason),metadata:{stack:event.reason instanceof Error?event.reason.stack:undefined}});
  originalConsoleError=console.error; originalConsoleWarn=console.warn;
  console.error=(...args)=>{ originalConsoleError?.(...args); emit({type:"console-error",level:"error",message:args.map(String).join(" ").slice(0,4000)}); };
  console.warn=(...args)=>{ originalConsoleWarn?.(...args); emit({type:"console-warn",level:"warn",message:args.map(String).join(" ").slice(0,4000)}); };
  originalFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
    const startedAt=performance.now();
    try {
      const response=await originalFetch!(...args);
      if(!response.ok){const input=args[0];const url=typeof input==="string"?input:input instanceof Request?input.url:String(input);emit({type:"http-error",level:response.status>=500?"error":"warn",message:"HTTP "+response.status+" "+response.statusText+": "+url,metadata:{status:response.status,durationMs:Math.round(performance.now()-startedAt),method:args[1]?.method||(input instanceof Request?input.method:"GET")}});}
      return response;
    } catch(error) {
      const input=args[0];const url=typeof input==="string"?input:input instanceof Request?input.url:String(input);
      emit({type:"network-error",level:"error",message:error instanceof Error?error.message:String(error),metadata:{url,durationMs:Math.round(performance.now()-startedAt)}}); throw error;
    }
  };
  window.addEventListener("error",onError); window.addEventListener("unhandledrejection",onRejection);
  emit({type:"session-start",level:"info",message:"NEXUM diagnostics session started",metadata:{userAgent:navigator.userAgent,viewport:window.innerWidth+"x"+window.innerHeight,dpr:window.devicePixelRatio}});
}
export function stopDiagnostics(){ if(!started)return; started=false; if(originalConsoleError)console.error=originalConsoleError; if(originalConsoleWarn)console.warn=originalConsoleWarn; if(originalFetch)window.fetch=originalFetch; }
export function getDiagnosticsSessionId(){ return getSessionId(); }
