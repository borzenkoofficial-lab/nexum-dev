import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import "./nexum-welcome.css";

type AuthMode = "register" | "login";
type IntroPhase = "wake" | "logo" | "boot" | "hello" | "auth";
type BootPhase = "idle" | "creating" | "booting" | "ready";

interface NexumWelcomeProps { onComplete: () => void; }

const bootSteps = [
  ["ЯДРО NEXUM", "ГОТОВО"],
  ["AI CORE", "ГОТОВ"],
  ["АГЕНТ", "ГОТОВ"],
  ["РАБОЧЕЕ ПРОСТРАНСТВО", "ПОДКЛЮЧЕНО"],
  ["ПРЕДПРОСМОТР", "ГОТОВ"],
  ["РАБОЧИЙ СТОЛ", "ГОТОВ"],
] as const;

const scenes: Record<IntroPhase, { eyebrow: string; title: string; description: string }> = {
  wake: { eyebrow: "ЗАПУСК", title: "Включение.", description: "NEXUM OS запускается." },
  logo: { eyebrow: "NEXUM OS", title: "NEXUM", description: "Операционная среда для работы с интеллектом." },
  boot: { eyebrow: "ЗАГРУЗКА СИСТЕМЫ", title: "Запуск системы.", description: "Проверяем компоненты и подготавливаем рабочее пространство." },
  hello: { eyebrow: "NEXUM OS", title: "Добро пожаловать.", description: "Система готова. Осталось создать ваш первый профиль." },
  auth: { eyebrow: "ПЕРВИЧНАЯ НАСТРОЙКА", title: "Добро пожаловать.", description: "Создайте учётную запись — рабочее пространство будет создано внутри NEXUM OS." },
};

export function NexumWelcome({ onComplete }: NexumWelcomeProps) {
  const [mode, setMode] = useState<AuthMode>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [intro, setIntro] = useState<IntroPhase>("wake");
  const [phase, setPhase] = useState<BootPhase>("idle");
  const [bootProgress, setBootProgress] = useState(0);
  const [error, setError] = useState("");

  const scene = useMemo(() => scenes[intro], [intro]);

  useEffect(() => {
    const durations: Record<IntroPhase, number> = { wake: 1400, logo: 1800, boot: 5200, hello: 2200, auth: 0 };
    if (intro === "auth") return;
    const timer = window.setTimeout(() => {
      setIntro(intro === "wake" ? "logo" : intro === "logo" ? "boot" : intro === "boot" ? "hello" : "auth");
    }, durations[intro]);
    return () => window.clearTimeout(timer);
  }, [intro]);

  useEffect(() => {
    if (intro !== "boot") return;
    const started = Date.now();
    const timer = window.setInterval(() => setBootProgress(Math.min(100, Math.round(((Date.now() - started) / 5000) * 100))), 45);
    return () => window.clearInterval(timer);
  }, [intro]);

  useEffect(() => {
    if (phase !== "booting") return;
    const started = Date.now();
    const progressTimer = window.setInterval(() => setBootProgress(Math.min(100, Math.round(((Date.now() - started) / 3000) * 100))), 50);
    const completeTimer = window.setTimeout(() => {
      setPhase("ready");
      window.setTimeout(onComplete, 900);
    }, 3150);
    return () => { window.clearInterval(progressTimer); window.clearTimeout(completeTimer); };
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
        throw new Error(message || "Не удалось создать учётную запись NEXUM.");
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
        <div className="nexum-boot-particles" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</div>
        <div className="nexum-boot-center">
          <div className="nexum-logo-mark" aria-label="NEXUM OS"><span>N</span></div>
          <div className="nexum-boot-word">NEXUM <span>OS</span></div>
          <p>{ready ? "Рабочий стол готов." : "Запуск рабочего пространства…"}</p>
          <div className="nexum-boot-progress"><i style={{ width: `${bootProgress}%` }} /></div>
          <div className="nexum-boot-status">{ready ? "СИСТЕМА ГОТОВА" : bootProgress < 32 ? "ЗАПУСК ЯДРА" : bootProgress < 62 ? "ЗАГРУЗКА ПРОСТРАНСТВА" : bootProgress < 90 ? "ПОДГОТОВКА РАБОЧЕГО СТОЛА" : "ПОЧТИ ГОТОВО"}</div>
        </div>
      </main>
    );
  }

  const sceneClass = `nexum-welcome-scene scene-${intro}`;
  return (
    <main className={"nexum-welcome " + sceneClass}>
      <div className="nx-cinematic-noise" aria-hidden="true" />
      <div className="nx-cinematic-vignette" aria-hidden="true" />
      <div className="nx-scan-beam" aria-hidden="true" />
      <div className="nx-light-streak streak-a" aria-hidden="true" />
      <div className="nx-light-streak streak-b" aria-hidden="true" />
      <div className="nx-light-streak streak-c" aria-hidden="true" />
      <div className="nx-system-grid" aria-hidden="true" />
      <div className="nx-system-pulse pulse-a" aria-hidden="true" />
      <div className="nx-system-pulse pulse-b" aria-hidden="true" />
      <div className="nexum-welcome-orb orb-a" /><div className="nexum-welcome-orb orb-b" /><div className="nexum-welcome-orb orb-c" />
      <div className="nexum-welcome-particles" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</div>
      <div className="nexum-liquid-rings" aria-hidden="true"><span /><span /><span /></div>
      <div className="nexum-welcome-grain" />

      <header className="nexum-welcome-nav">
        <div className="nexum-brand"><span className="nexum-logo-mark small"><span>N</span></span><b>NEXUM</b><em>OS</em></div>
        <div className="nexum-os-session"><span className="nx-live-dot" /> ЗАПУСК СИСТЕМЫ <b>1.0</b></div>
      </header>

      <section className="nexum-boot-sequence" aria-live="polite">
        <div className="nexum-sequence-core"><div className="nexum-core-halo" /><div className="nexum-core-glass"><span>N</span></div><div className="nexum-core-orbit orbit-one" /><div className="nexum-core-orbit orbit-two" /></div>
        <div className="nexum-sequence-copy">
          <span className="nexum-sequence-eyebrow" key={scene.eyebrow}>{scene.eyebrow}</span>
          <h1 key={scene.title}>{scene.title}</h1>
          <p key={scene.description}>{scene.description}</p>
        </div>
        <div className="nexum-boot-console">
          <div className="nexum-console-head"><span>СОСТОЯНИЕ СИСТЕМЫ</span><b>{intro === "boot" ? `${bootProgress}%` : intro === "hello" || intro === "auth" ? "100%" : "—"}</b></div>
          <div className="nexum-console-lines">{bootSteps.map(([label, status], index) => { const online = intro === "hello" || intro === "auth" || bootProgress >= (index + 1) * 15; return <div key={label} className={online ? "online" : ""}><span>{label}</span><b>{online ? status : "ОЖИДАНИЕ"}</b></div>; })}</div>
        </div>
      </section>

      <section className="nexum-auth-window" aria-label={mode === "register" ? "Регистрация NEXUM" : "Вход в NEXUM"}>
        <div className="nexum-window-chrome"><div className="nexum-window-dots"><i /><i /><i /></div><span>NEXUM OS · НАСТРОЙКА</span><div className="nexum-window-status"><span className="nx-live-dot" /> ЗАЩИЩЕНО</div></div>
        <div className="nexum-auth-content">
          <div className="nexum-auth-intro"><span className="nexum-card-kicker">{mode === "register" ? "ПЕРВЫЙ ЗАПУСК" : "СЕАНС NEXUM"}</span><h2>{mode === "register" ? "Создайте профиль NEXUM" : "Войдите в NEXUM"}</h2><p>{mode === "register" ? "Это первая учётная запись системы. После регистрации будет создано ваше рабочее пространство." : "Войдите, чтобы продолжить работу в NEXUM OS."}</p></div>
          <form onSubmit={submit}>
            {mode === "register" && <label><span>Имя</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" autoComplete="name" required maxLength={80} /></label>}
            <label><span>Электронная почта</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required={mode === "register"} /></label>
            <label><span>Пароль</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "login" ? "Можно пропустить в демо-режиме" : "Не менее 8 символов"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 8 : undefined} maxLength={128} required={mode === "register"} /></label>
            {mode === "login" && <div className="nexum-auth-note">Демо-режим — можно войти без учётных данных.</div>}
            {error && <div className="nexum-auth-error" role="alert">{error}</div>}
            <button className={"nexum-enter" + (phase === "creating" ? " is-loading" : "")} type="submit" disabled={phase === "creating"}><span>{phase === "creating" ? "Создаём системный профиль…" : mode === "register" ? "Продолжить" : "Войти в NEXUM"}</span><b>{phase === "creating" ? "…" : "→"}</b></button>
          </form>
          <div className="nexum-auth-switch"><span>{mode === "register" ? "Уже есть аккаунт?" : "Впервые в NEXUM?"}</span><button type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>{mode === "register" ? "Войти" : "Создать профиль"}</button></div>
        </div>
      </section>

      <button type="button" className="nexum-skip-intro" onClick={() => setIntro("auth")} aria-label="Пропустить запуск">Пропустить <kbd>Esc</kbd></button>
      <footer className="nexum-welcome-footer"><span>NEXUM OS · ЗАПУСК СИСТЕМЫ</span><span>© NEXUM</span></footer>
    </main>
  );
}
