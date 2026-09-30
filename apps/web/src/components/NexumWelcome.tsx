import { FormEvent, useEffect, useMemo, useState } from "react";
import "./nexum-welcome.css";

type AuthMode = "register" | "login";
type BootPhase = "idle" | "creating" | "booting" | "ready";

interface NexumWelcomeProps {
  onComplete: () => void;
}

export function NexumWelcome({ onComplete }: NexumWelcomeProps) {
  const [mode, setMode] = useState<AuthMode>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<BootPhase>("idle");
  const [bootProgress, setBootProgress] = useState(0);
  const [error, setError] = useState("");

  const isBooting = phase !== "idle";
  const title = useMemo(() => mode === "register" ? "Hello, creator." : "Welcome back.", [mode]);

  useEffect(() => {
    if (!isBooting) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - started;
      setBootProgress(Math.min(100, Math.round((elapsed / 2700) * 100)));
    }, 50);
    return () => window.clearInterval(timer);
  }, [isBooting]);

  useEffect(() => {
    if (phase !== "booting") return;
    const timer = window.setTimeout(() => {
      setPhase("ready");
      window.setTimeout(onComplete, 650);
    }, 2850);
    return () => window.clearTimeout(timer);
  }, [phase, onComplete]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBooting) return;
    setError("");
    setPhase("creating");
    try {
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = mode === "register" ? { name: name.trim(), email: email.trim(), password } : { email: email.trim(), password };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string | { message?: string } };
      if (!response.ok || !data.success) {
        const message = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(message || "Не удалось создать сессию NEXUM.");
      }
      try { localStorage.setItem("nexum:onboarding-complete", "1"); } catch {}
      setPhase("booting");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Не удалось подключиться к NEXUM.");
    }
  }

  if (isBooting) {
    const ready = phase === "ready";
    return (
      <main className={"nexum-welcome nexum-boot " + (ready ? "is-ready" : "")}>
        <div className="nexum-boot-glow" />
        <div className="nexum-boot-center">
          <div className="nexum-logo-mark" aria-label="NEXUM OS"><span>N</span></div>
          <div className="nexum-boot-word">NEXUM <span>OS</span></div>
          <p>{ready ? "Your workspace is ready." : "Starting your workspace…"}</p>
          <div className="nexum-boot-progress"><i style={{ width: `${bootProgress}%` }} /></div>
          <div className="nexum-boot-status">{ready ? "WELCOME" : bootProgress < 35 ? "INITIALIZING CORE" : bootProgress < 70 ? "LOADING WORKSPACE" : "PREPARING DESKTOP"}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="nexum-welcome">
      <div className="nexum-welcome-orb orb-a" />
      <div className="nexum-welcome-orb orb-b" />
      <div className="nexum-welcome-orb orb-c" />
      <div className="nexum-welcome-grain" />
      <header className="nexum-welcome-nav">
        <div className="nexum-brand">
          <span className="nexum-logo-mark small"><span>N</span></span>
          <b>NEXUM</b><em>OS</em>
        </div>
        <span className="nexum-version">NEXUM OS · 1.0</span>
      </header>

      <section className="nexum-welcome-stage">
        <div className="nexum-welcome-copy">
          <span className="nexum-hello">HELLO</span>
          <h1>{title}</h1>
          <p>A new kind of workspace for building with AI.</p>
          <div className="nexum-system-pills">
            <span>AI CORE</span><span>AGENT</span><span>PREVIEW</span>
          </div>
        </div>

        <section className="nexum-auth-card" aria-label={mode === "register" ? "Create NEXUM account" : "Sign in to NEXUM"}>
          <div className="nexum-auth-card-top">
            <div>
              <span className="nexum-card-kicker">{mode === "register" ? "CREATE YOUR SPACE" : "SIGN IN"}</span>
              <h2>{mode === "register" ? "Create your NEXUM ID" : "Enter NEXUM"}</h2>
            </div>
            <div className="nexum-secure-dot" title="Secure session" />
          </div>
          <form onSubmit={submit}>
            {mode === "register" && (
              <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required maxLength={80} /></label>
            )}
            <label><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
            <label><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} maxLength={128} required /></label>
            {error && <div className="nexum-auth-error" role="alert">{error}</div>}
            <button className="nexum-enter" type="submit">
              <span>{mode === "register" ? "Create account" : "Continue"}</span><b>→</b>
            </button>
          </form>
          <div className="nexum-auth-switch">
            <span>{mode === "register" ? "Already have an account?" : "New to NEXUM?"}</span>
            <button type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>
              {mode === "register" ? "Sign in" : "Create account"}
            </button>
          </div>
          <small className="nexum-auth-note">Your workspace is isolated to your NEXUM account.</small>
        </section>
      </section>

      <footer className="nexum-welcome-footer">
        <span>Designed for creators, developers & AI agents.</span>
        <span>© NEXUM</span>
      </footer>
    </main>
  );
}
