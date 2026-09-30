import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import "./nexum-welcome.css";

type AuthMode = "register" | "login";
type IntroPhase = "wake" | "logo" | "boot" | "hello" | "auth";
type BootPhase = "idle" | "creating" | "booting" | "ready";

interface NexumWelcomeProps { onComplete: () => void; }

const bootSteps = [
  ["NEXUM KERNEL", "ONLINE"],
  ["AI CORE", "ONLINE"],
  ["AGENT RUNTIME", "ONLINE"],
  ["WORKSPACE", "MOUNTED"],
  ["PREVIEW ENGINE", "READY"],
  ["DESKTOP", "READY"],
] as const;

export function NexumWelcome({ onComplete }: NexumWelcomeProps) {
  const [mode, setMode] = useState<AuthMode>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [intro, setIntro] = useState<IntroPhase>("wake");
  const [phase, setPhase] = useState<BootPhase>("idle");
  const [bootProgress, setBootProgress] = useState(0);
  const [error, setError] = useState("");

  const title = useMemo(() => mode === "register" ? "Welcome to NEXUM." : "Welcome back.", [mode]);

  useEffect(() => {
    const durations: Record<IntroPhase, number> = { wake: 1100, logo: 1500, boot: 4200, hello: 1800, auth: 0 };
    if (intro === "auth") return;
    const timer = window.setTimeout(() => {
      setIntro(intro === "wake" ? "logo" : intro === "logo" ? "boot" : intro === "boot" ? "hello" : "auth");
    }, durations[intro]);
    return () => window.clearTimeout(timer);
  }, [intro]);

  useEffect(() => {
    if (intro !== "boot") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setBootProgress(Math.min(100, Math.round(((Date.now() - started) / 4000) * 100)));
    }, 40);
    return () => window.clearInterval(timer);
  }, [intro]);

  useEffect(() => {
    if (phase !== "booting") return;
    const started = Date.now();
    const progressTimer = window.setInterval(() => setBootProgress(Math.min(100, Math.round(((Date.now() - started) / 2700) * 100))), 50);
    const completeTimer = window.setTimeout(() => {
      setPhase("ready");
      window.setTimeout(onComplete, 650);
    }, 2850);
    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(completeTimer);
    };
  }, [phase, onComplete]);

  function startDemoLogin() {
    if (phase !== "idle") return;
    setError("");
    try { localStorage.setItem("nexum:onboarding-complete", "1"); } catch {}
    setPhase("booting");
    setBootProgress(0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "login") { startDemoLogin(); return; }
    if (phase !== "idle") return;
    setError("");
    setPhase("creating");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string | { message?: string } };
      if (!response.ok || !data.success) {
        const message = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(message || "Не удалось создать сессию NEXUM.");
      }
      try { localStorage.setItem("nexum:onboarding-complete", "1"); } catch {}
      setPhase("booting");
      setBootProgress(0);
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Не удалось подключиться к NEXUM.");
    }
  }

  if (phase === "booting" || phase === "ready") {
    const ready = phase === "ready";
    return (
      <main className={"nexum-welcome nexum-post-auth-boot " + (ready ? "is-ready" : "")}>
        <div className="nexum-boot-glow" />
        <div className="nexum-boot-particles" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}
        </div>
        <div className="nexum-boot-center">
          <div className="nexum-logo-mark" aria-label="NEXUM OS"><span>N</span></div>
          <div className="nexum-boot-word">NEXUM <span>OS</span></div>
          <p>{ready ? "Workspace created." : "Finishing your NEXUM workspace…"}</p>
          <div className="nexum-boot-progress"><i style={{ width: `${bootProgress}%` }} /></div>
          <div className="nexum-boot-status">{ready ? "WELCOME" : bootProgress < 40 ? "CREATING USER SPACE" : bootProgress < 78 ? "MOUNTING WORKSPACE" : "STARTING DESKTOP"}</div>
        </div>
      </main>
    );
  }

  const sceneClass = `nexum-welcome-scene scene-${intro}`;
  return (
    <main className={"nexum-welcome " + sceneClass}>
      <div className="nexum-welcome-orb orb-a" />
      <div className="nexum-welcome-orb orb-b" />
      <div className="nexum-welcome-orb orb-c" />
      <div className="nexum-welcome-particles" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}
      </div>
      <div className="nexum-liquid-rings" aria-hidden="true"><span /><span /><span /></div>
      <div className="nexum-welcome-grain" />

      <header className="nexum-welcome-nav">
        <div className="nexum-brand">
          <span className="nexum-logo-mark small"><span>N</span></span><b>NEXUM</b><em>OS</em>
        </div>
        <div className="nexum-os-session"><span className="nx-live-dot" /> SYSTEM STARTUP <b>1.0</b></div>
      </header>

      <section className="nexum-boot-sequence" aria-live="polite">
        <div className="nexum-sequence-core">
          <div className="nexum-core-halo" />
          <div className="nexum-core-glass"><span>N</span></div>
          <div className="nexum-core-orbit orbit-one" />
          <div className="nexum-core-orbit orbit-two" />
        </div>
        <div className="nexum-sequence-copy">
          <span className="nexum-sequence-eyebrow">{intro === "wake" ? "POWER" : intro === "logo" ? "NEXUM OS" : intro === "boot" ? "SYSTEM STARTUP" : "NEXUM OS"}</span>
          <h1>{intro === "wake" ? "Powering on." : intro === "logo" ? "NEXUM" : intro === "boot" ? "Starting your workspace." : title}</h1>
          <p>{intro === "wake" ? "Pressing into a new kind of workspace." : intro === "logo" ? "An operating environment for intelligence." : intro === "boot" ? "Initializing the systems that make NEXUM feel alive." : "Your workspace is ready for you."}</p>
        </div>

        <div className="nexum-boot-console">
          <div className="nexum-console-head"><span>SYSTEM CHECK</span><b>{intro === "boot" ? `${bootProgress}%` : intro === "hello" || intro === "auth" ? "100%" : "—"}</b></div>
          <div className="nexum-console-lines">
            {bootSteps.map(([label, status], index) => {
              const threshold = (index + 1) * 15;
              const online = intro === "hello" || intro === "auth" || bootProgress >= threshold;
              return <div key={label} className={online ? "online" : ""}><span>{label}</span><b>{online ? status : "WAITING"}</b></div>;
            })}
          </div>
        </div>
      </section>

      <section className="nexum-auth-window" aria-label={mode === "register" ? "Create NEXUM account" : "Sign in to NEXUM"}>
        <div className="nexum-window-chrome">
          <div className="nexum-window-dots"><i /><i /><i /></div>
          <span>NEXUM OS · SETUP</span>
          <div className="nexum-window-status"><span className="nx-live-dot" /> SECURE</div>
        </div>
        <div className="nexum-auth-content">
          <div className="nexum-auth-intro">
            <span className="nexum-card-kicker">{mode === "register" ? "FIRST USER SETUP" : "SESSION SETUP"}</span>
            <h2>{mode === "register" ? "Create your NEXUM ID" : "Enter NEXUM"}</h2>
            <p>This is your first system account. Your workspace will be created inside NEXUM OS.</p>
          </div>
          <form onSubmit={submit}>
            {mode === "register" && <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required maxLength={80} /></label>}
            <label><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required={mode === "register"} /></label>
            <label><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "login" ? "Optional for demo" : "At least 8 characters"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 8 : undefined} maxLength={128} required={mode === "register"} /></label>
            {mode === "login" && <div className="nexum-auth-note">Demo mode — you can enter without credentials.</div>}
            {error && <div className="nexum-auth-error" role="alert">{error}</div>}
            <button className={"nexum-enter" + (phase === "creating" ? " is-loading" : "")} type="submit" disabled={phase === "creating"}>
              <span>{phase === "creating" ? "Creating system account…" : mode === "register" ? "Continue" : "Enter NEXUM"}</span><b>{phase === "creating" ? "…" : "→"}</b>
            </button>
          </form>
          <div className="nexum-auth-switch"><span>{mode === "register" ? "Already have an account?" : "New to NEXUM?"}</span><button type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>{mode === "register" ? "Sign in" : "Create account"}</button></div>
        </div>
      </section>

      <button type="button" className="nexum-skip-intro" onClick={() => setIntro("auth")} aria-label="Skip introduction">Skip startup <kbd>Esc</kbd></button>
      <footer className="nexum-welcome-footer"><span>NEXUM OS · SYSTEM STARTUP</span><span>© NEXUM</span></footer>
    </main>
  );
}
