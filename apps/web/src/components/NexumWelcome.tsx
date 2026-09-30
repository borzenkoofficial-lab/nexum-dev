import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import "./nexum-welcome.css";

type AuthMode = "register" | "login";
type IntroPhase = "wake" | "logo" | "hello" | "auth";
type BootPhase = "idle" | "creating" | "booting" | "ready";

interface NexumWelcomeProps { onComplete: () => void; }

export function NexumWelcome({ onComplete }: NexumWelcomeProps) {
  const [mode, setMode] = useState<AuthMode>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [intro, setIntro] = useState<IntroPhase>("wake");
  const [phase, setPhase] = useState<BootPhase>("idle");
  const [bootProgress, setBootProgress] = useState(0);
  const [error, setError] = useState("");

  const isBooting = phase === "booting" || phase === "ready";
  const title = useMemo(() => mode === "register" ? "Hello, creator." : "Welcome back.", [mode]);

  useEffect(() => {
    if (intro === "wake") { const t = window.setTimeout(() => setIntro("logo"), 900); return () => window.clearTimeout(t); }
    if (intro === "logo") { const t = window.setTimeout(() => setIntro("hello"), 1500); return () => window.clearTimeout(t); }
    if (intro === "hello") { const t = window.setTimeout(() => setIntro("auth"), 1900); return () => window.clearTimeout(t); }
  }, [intro]);

  useEffect(() => {
    if (!isBooting) return;
    const started = Date.now();
    const timer = window.setInterval(() => setBootProgress(Math.min(100, Math.round(((Date.now() - started) / 2700) * 100))), 50);
    return () => window.clearInterval(timer);
  }, [isBooting]);

  useEffect(() => {
    if (phase !== "booting") return;
    const timer = window.setTimeout(() => { setPhase("ready"); window.setTimeout(onComplete, 650); }, 2850);
    return () => window.clearTimeout(timer);
  }, [phase, onComplete]);

  function startDemoLogin() {
    if (isBooting) return;
    setError("");
    try { localStorage.setItem("nexum:onboarding-complete", "1"); } catch {}
    setPhase("booting");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "login") { startDemoLogin(); return; }
    if (isBooting) return;
    setError(""); setPhase("creating");
    try {
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: name.trim(), email: email.trim(), password }) });
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string | { message?: string } };
      if (!response.ok || !data.success) { const message = typeof data.error === "string" ? data.error : data.error?.message; throw new Error(message || "Не удалось создать сессию NEXUM."); }
      try { localStorage.setItem("nexum:onboarding-complete", "1"); } catch {}
      setPhase("booting");
    } catch (err) { setPhase("idle"); setError(err instanceof Error ? err.message : "Не удалось подключиться к NEXUM."); }
  }

  if (isBooting) {
    const ready = phase === "ready";
    return <main className={"nexum-welcome nexum-boot " + (ready ? "is-ready" : "")}><div className="nexum-boot-glow"/><div className="nexum-boot-particles" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties}/>)}</div><div className="nexum-boot-center"><div className="nexum-logo-mark" aria-label="NEXUM OS"><span>N</span></div><div className="nexum-boot-word">NEXUM <span>OS</span></div><p>{ready ? "Your workspace is ready." : "Starting your workspace…"}</p><div className="nexum-boot-progress"><i style={{ width: `${bootProgress}%` }}/></div><div className="nexum-boot-status">{ready ? "WELCOME" : bootProgress < 35 ? "INITIALIZING CORE" : bootProgress < 70 ? "LOADING WORKSPACE" : "PREPARING DESKTOP"}</div></div></main>;
  }

  const sceneClass = `nexum-welcome-scene scene-${intro}`;
  return <main className={"nexum-welcome " + sceneClass}>
    <div className="nexum-welcome-orb orb-a"/><div className="nexum-welcome-orb orb-b"/><div className="nexum-welcome-orb orb-c"/>
    <div className="nexum-liquid-rings" aria-hidden="true"><span/><span/><span/></div><div className="nexum-welcome-particles" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties}/>)}</div><div className="nexum-welcome-grain"/>
    <header className="nexum-welcome-nav"><div className="nexum-brand"><span className="nexum-logo-mark small"><span>N</span></span><b>NEXUM</b><em>OS</em></div><span className="nexum-version">NEXUM OS · 1.0</span></header>
    <section className="nexum-welcome-stage">
      <div className="nexum-welcome-copy"><div className="nexum-core-orb"><div className="nexum-core-halo"/><div className="nexum-core-glass"><span>N</span></div></div><span className="nexum-hello">HELLO</span><h1>{title}</h1><p>A new kind of workspace for building with AI.</p><div className="nexum-system-pills"><span>AI CORE</span><span>AGENT</span><span>PREVIEW</span></div><div className="nexum-scene-meta"><span>FIRST LAUNCH</span><span>● NEXUM CORE ONLINE</span></div></div>
      <section className="nexum-auth-card" aria-label={mode === "register" ? "Create NEXUM account" : "Sign in to NEXUM"}>
        <div className="nexum-auth-card-top"><div><span className="nexum-card-kicker">{mode === "register" ? "CREATE YOUR SPACE" : "SIGN IN"}</span><h2>{mode === "register" ? "Create your NEXUM ID" : "Enter NEXUM"}</h2></div><div className="nexum-secure-dot" title="Secure session"/></div>
        <form onSubmit={submit}>{mode === "register" && <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required maxLength={80}/></label>}<label><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required={mode === "register"}/></label><label><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "login" ? "Optional for demo" : "At least 8 characters"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 8 : undefined} maxLength={128} required={mode === "register"}/></label>{mode === "login" && <div className="nexum-auth-note">Demo mode — you can enter without credentials.</div>}{error && <div className="nexum-auth-error" role="alert">{error}</div>}<button className={"nexum-enter" + (phase === "creating" ? " is-loading" : "")} type="submit" disabled={phase === "creating"}><span>{phase === "creating" ? "Creating…" : mode === "register" ? "Create account" : "Sign in"}</span><b>{phase === "creating" ? "…" : "→"}</b></button></form>
        <div className="nexum-auth-switch"><span>{mode === "register" ? "Already have an account?" : "New to NEXUM?"}</span><button type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>{mode === "register" ? "Sign in" : "Create account"}</button></div><small className="nexum-auth-note">Your workspace is isolated to your NEXUM account.</small>
      </section>
    </section>
    <button type="button" className="nexum-skip-intro" onClick={() => setIntro("auth")} aria-label="Skip introduction">Skip intro <kbd>Esc</kbd></button><footer className="nexum-welcome-footer"><span>Designed for creators, developers & AI agents.</span><span>© NEXUM</span></footer>
  </main>;
}
