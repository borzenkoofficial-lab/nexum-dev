import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface AuthUser { id: string; email: string; name: string; createdAt: string }

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadSession() {
    try {
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const data = await response.json() as { user?: AuthUser };
        setUser(data.user ?? null);
      } else setUser(null);
    } catch { setUser(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadSession(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ email, password, ...(mode === "register" ? { name } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as { user?: AuthUser; error?: string; mfaRequired?: boolean };
      if (!response.ok) throw new Error(data.error || "Authentication failed");
      if (data.mfaRequired) { setMfaRequired(true); setPassword(""); return; }
      setUser(data.user ?? null);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally { setBusy(false); }
  }

  async function submitMfa(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/admin-mfa/challenge/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ code: mfaCode }),
      });
      const data = await response.json().catch(() => ({})) as { user?: AuthUser; error?: string };
      if (!response.ok) throw new Error(data.error || "MFA verification failed");
      setUser(data.user ?? null);
      setMfaCode("");
      setMfaRequired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "MFA verification failed");
    } finally { setBusy(false); }
  }

  if (loading) return <div className="auth-shell"><div className="auth-card"><strong>NEXUM</strong><span>Проверка сессии…</span></div></div>;
  if (user) return <>{children}</>;

  return <div className="auth-shell">
    <div className="auth-card">
      <div className="auth-brand"><span>NEXUM</span><i>DEV</i></div>
      <div className="auth-copy"><strong>{mfaRequired ? "Подтвердите вход" : mode === "login" ? "Войти в NEXUM" : "Создать аккаунт"}</strong><span>{mfaRequired ? "Введите код из приложения-аутентификатора или резервный код." : mode === "login" ? "Ваши проекты будут привязаны к аккаунту." : "Создайте рабочее пространство NEXUM."}</span></div>
      {mfaRequired ? <form onSubmit={submitMfa} className="auth-form">
        <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="Код подтверждения" autoComplete="one-time-code" inputMode="text" required autoFocus />
        {error && <div className="auth-error">{error}</div>}
        <button disabled={busy}>{busy ? "Проверка…" : "Подтвердить"}</button>
        <button type="button" className="auth-switch" onClick={() => { setMfaRequired(false); setMfaCode(""); setError(""); }}>Вернуться ко входу</button>
      </form> : <>
        <form onSubmit={submit} className="auth-form">
          {mode === "register" && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" autoComplete="name" required />}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" required />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
          {error && <div className="auth-error">{error}</div>}
          <button disabled={busy}>{busy ? "Подключение…" : mode === "login" ? "Войти" : "Создать аккаунт"}</button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Нет аккаунта? Создать" : "Уже есть аккаунт? Войти"}
        </button>
      </>}
      <small>Данные авторизации хранятся на сервере Nexum. Пароль не отправляется в браузерное хранилище.</small>
    </div>
  </div>;
}
