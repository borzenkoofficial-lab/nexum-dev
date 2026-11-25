import { useCallback, useEffect, useState } from "react";
import "./AdminControlCenter.css";

type Role = "super_admin" | "admin" | "support" | "finance" | "developer" | "auditor";
type Section = "overview" | "users" | "organizations" | "roles" | "sessions" | "audit";
type Identity = { role: Role; permissions: string[]; user: { id: string } };
type Assignment = { user_id: string; role: Role; updated_at: string };
type Session = { id: string; user_id: string; email: string; mfa_verified: boolean; last_seen_at: string; expires_at: string };
type Event = { id: string; actor_user_id: string | null; action: string; target_type: string; target_id: string; created_at: string };
type UserRow = { id: string; email: string; name: string; created_at: string; admin_role: Role | null; organizations_count: number; projects_count: number };
type OrganizationRow = { id: string; name: string; slug: string; created_at: string; members_count: number; agents_count: number; workforces_count: number; owner_email: string | null };
type MemberRow = { id: string; email: string; name: string; role: string; joined_at: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(body.error || "Запрос не выполнен") as Error & { code?: string };
    error.code = body.code;
    throw error;
  }
  return body as T;
}
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function AdminControlCenter() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [directorySearch, setDirectorySearch] = useState("");
  const [selectedOrganization, setSelectedOrganization] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uuid, setUuid] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaOpen, setMfaOpen] = useState(false);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const me = await request<Identity>("/api/admin/me");
      setIdentity(me);
      if (section === "users" && me.permissions.includes("users.read")) setUsers((await request<{ users: UserRow[] }>("/api/admin/users?limit=50&search=" + encodeURIComponent(directorySearch))).users);
      if (section === "organizations" && me.permissions.includes("organizations.read")) setOrganizations((await request<{ organizations: OrganizationRow[] }>("/api/admin/organizations?limit=50&search=" + encodeURIComponent(directorySearch))).organizations);
      if (section === "roles" && me.permissions.includes("roles.manage")) setAssignments((await request<{ assignments: Assignment[] }>("/api/admin/roles")).assignments);
      if (section === "sessions" && me.permissions.includes("sessions.manage")) setSessions((await request<{ sessions: Session[] }>("/api/admin/sessions")).sessions);
      if (section === "audit" && me.permissions.includes("audit.read")) setEvents((await request<{ events: Event[] }>("/api/admin/audit")).events);
      if (section === "overview") await request("/api/admin/overview");
    } catch (err) { setError(err instanceof Error ? err.message : "Ошибка загрузки"); }
    finally { setLoading(false); }
  }, [section, directorySearch]);
  useEffect(() => { void refresh(); }, [refresh]);

  const can = (permission: string) => Boolean(identity?.permissions.includes(permission));
  async function mutate(action: () => Promise<void>) {
    try { await action(); await refresh(); }
    catch (err) {
      const failure = err as Error & { code?: string };
      if (failure.code === "MFA_STEP_UP_REQUIRED") { setPending(() => action); setMfaOpen(true); }
      else setError(failure.message);
    }
  }
  async function confirmMfa(event: React.FormEvent) {
    event.preventDefault();
    try {
      await request("/api/auth/admin-mfa/step-up", { method: "POST", body: JSON.stringify({ code: mfaCode }) });
      const action = pending;
      setMfaOpen(false); setMfaCode(""); setPending(null);
      if (action) await action();
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "MFA verification failed"); }
  }

  if (loading) return <div className="kvard-admin-loading">Загружаем административный контур…</div>;
  const items: Array<{ id: Section; title: string }> = [
    { id: "overview", title: "Обзор" },
    { id: "users", title: "Пользователи" },
    { id: "organizations", title: "Организации" },
    { id: "roles", title: "Доступы" },
    { id: "sessions", title: "Сессии" },
    { id: "audit", title: "Аудит" },
  ];
  return <div className="kvard-admin">
    <aside className="kvard-admin-rail">
      <a className="kvard-admin-brand" href="/"><b>К</b><span>КВАРД<small>CONTROL CENTER</small></span></a>
      <label>УПРАВЛЕНИЕ</label>
      <nav>{items.map(item => {
        const allowed = item.id === "overview" || (item.id === "users" && can("users.read")) || (item.id === "organizations" && can("organizations.read")) || (item.id === "roles" && can("roles.manage")) || (item.id === "sessions" && can("sessions.manage")) || (item.id === "audit" && can("audit.read"));
        return allowed ? <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>{item.title}</button> : null;
      })}</nav>
      <footer><span>● Защищённая сессия</span><a href="/">Вернуться в КВАРД ↗</a></footer>
    </aside>
    <main className="kvard-admin-main">
      <header><div><small>КВАРД / ADMIN</small><h1>{items.find(x => x.id === section)?.title}</h1><p>Административный контур платформы</p></div><div><span>{identity?.role.replace("_", " ")}</span><button onClick={() => void refresh()}>Обновить ↻</button></div></header>
      {error && <div className="kvard-admin-error" role="alert">{error}</div>}
      {section === "overview" && <section>
        <div className="kvard-admin-hero"><small>ADMIN CONTROL CENTER</small><h2>Контроль платформы<br/>в одном пространстве.</h2><p>Доступы, безопасность и системные события КВАРД.</p></div>
        <div className="kvard-admin-stats"><article><small>ВАША РОЛЬ</small><strong>{identity?.role.replace("_", " ")}</strong><span>Определена сервером</span></article><article><small>РАЗРЕШЕНИЯ</small><strong>{identity?.permissions.length ?? 0}</strong><span>Активные permissions</span></article><article><small>ЗАЩИТА</small><strong>MFA</strong><span>Проверяется сервером</span></article></div>
        <div className="kvard-admin-panel"><small>ИСТОЧНИКИ ДАННЫХ</small><h3>Только реальные показатели</h3><p>Неподключённые метрики не заменяются демонстрационными значениями. Состояние обзора получено из защищённого API.</p></div>
      </section>}

      {section === "users" && can("users.read") && <section>
        <div className="kvard-admin-panel"><small>USER DIRECTORY</small><h3>Пользователи платформы</h3><div className="kvard-admin-form"><input value={directorySearch} onChange={event => setDirectorySearch(event.target.value)} placeholder="Поиск по имени, email или UUID"/><button onClick={() => void refresh()}>Найти</button></div>
          <div className="kvard-admin-table"><table><thead><tr><th>Пользователь</th><th>Регистрация</th><th>Организации</th><th>Проекты</th><th>Админ-доступ</th></tr></thead><tbody>{users.map(x => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.email}</small><small>{x.id}</small></td><td>{date(x.created_at)}</td><td>{x.organizations_count}</td><td>{x.projects_count}</td><td>{x.admin_role ?? "Нет"}</td></tr>)}</tbody></table></div>
          {!users.length && <p>Пользователи не найдены.</p>}
        </div>
      </section>}
      {section === "organizations" && can("organizations.read") && <section>
        <div className="kvard-admin-panel"><small>ORGANIZATION DIRECTORY</small><h3>Организации и рабочие пространства</h3><div className="kvard-admin-form"><input value={directorySearch} onChange={event => setDirectorySearch(event.target.value)} placeholder="Поиск по названию, slug или UUID"/><button onClick={() => void refresh()}>Найти</button></div>
          <div className="kvard-admin-table"><table><thead><tr><th>Организация</th><th>Владелец</th><th>Участники</th><th>Агенты</th><th>Workforces</th><th/></tr></thead><tbody>{organizations.map(x => <tr key={x.id}><td><strong>{x.name}</strong><small>{x.slug}</small><small>{x.id}</small></td><td>{x.owner_email ?? "Не указан"}</td><td>{x.members_count}</td><td>{x.agents_count}</td><td>{x.workforces_count}</td><td><button onClick={async () => { try { const data = await request<{ members: MemberRow[] }>("/api/admin/organizations/" + x.id + "/members"); setMembers(data.members); setSelectedOrganization(x.name); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить участников"); } }}>Участники</button></td></tr>)}</tbody></table></div>
          {!organizations.length && <p>Организации не найдены.</p>}
        </div>
        {selectedOrganization && <div className="kvard-admin-panel"><div className="kvard-admin-panel-title"><h3>Участники: {selectedOrganization}</h3><button onClick={() => setSelectedOrganization(null)}>Закрыть</button></div><div className="kvard-admin-table"><table><thead><tr><th>Участник</th><th>Роль</th><th>Добавлен</th></tr></thead><tbody>{members.map(x => <tr key={x.id}><td>{x.name}<small>{x.email}</small></td><td>{x.role}</td><td>{date(x.joined_at)}</td></tr>)}</tbody></table></div></div>}
      </section>}
      {section === "roles" && can("roles.manage") && <section>
        <div className="kvard-admin-panel"><small>RBAC</small><h3>Назначить роль</h3><form className="kvard-admin-form" onSubmit={event => { event.preventDefault(); void mutate(async () => { await request("/api/admin/roles/" + encodeURIComponent(uuid.trim()), { method: "PUT", body: JSON.stringify({ role }) }); setUuid(""); }); }}><input value={uuid} onChange={event => setUuid(event.target.value)} placeholder="UUID пользователя" required/><select value={role} onChange={event => setRole(event.target.value as Role)}>{(["admin","support","finance","developer","auditor","super_admin"] as Role[]).map(x => <option key={x}>{x}</option>)}</select><button>Назначить</button></form></div>
        <div className="kvard-admin-panel"><small>ACCESS REGISTRY</small><h3>Текущие назначения</h3>{assignments.length ? <div className="kvard-admin-table"><table><thead><tr><th>User ID</th><th>Роль</th><th>Изменено</th><th/></tr></thead><tbody>{assignments.map(x => <tr key={x.user_id}><td>{x.user_id}</td><td>{x.role}</td><td>{date(x.updated_at)}</td><td><button className="danger" onClick={() => void mutate(() => request("/api/admin/roles/" + encodeURIComponent(x.user_id), { method: "DELETE" }).then(() => undefined))}>Отозвать</button></td></tr>)}</tbody></table></div> : <p>Назначений нет.</p>}</div>
      </section>}
      {section === "sessions" && can("sessions.manage") && <section><div className="kvard-admin-panel"><small>SESSION REGISTRY</small><h3>Активные сессии</h3>{sessions.length ? <div className="kvard-admin-table"><table><thead><tr><th>Пользователь</th><th>MFA</th><th>Активность</th><th>Истекает</th><th/></tr></thead><tbody>{sessions.map(x => <tr key={x.id}><td>{x.email}<small>{x.user_id}</small></td><td>{x.mfa_verified ? "Да" : "Нет"}</td><td>{date(x.last_seen_at)}</td><td>{date(x.expires_at)}</td><td><button className="danger" onClick={() => void mutate(() => request("/api/admin/sessions/" + encodeURIComponent(x.id), { method: "DELETE" }).then(() => undefined))}>Отозвать</button></td></tr>)}</tbody></table></div> : <p>Нет активных сессий.</p>}</div></section>}
      {section === "audit" && can("audit.read") && <section><div className="kvard-admin-panel"><small>APPEND-ONLY LOG</small><h3>Журнал действий</h3>{events.length ? <div className="kvard-admin-table"><table><thead><tr><th>Событие</th><th>Актор</th><th>Объект</th><th>Время</th></tr></thead><tbody>{events.map(x => <tr key={x.id}><td>{x.action}</td><td>{x.actor_user_id ?? "system"}</td><td>{x.target_type}: {x.target_id}</td><td>{date(x.created_at)}</td></tr>)}</tbody></table></div> : <p>Событий пока нет.</p>}</div></section>}
    </main>
    {mfaOpen && <div className="kvard-admin-modal"><form onSubmit={confirmMfa}><small>SECURITY CHECK</small><h2>Подтвердите действие</h2><p>Введите новый код аутентификатора или неиспользованный резервный код. Подтверждение действует 10 минут.</p><input autoFocus value={mfaCode} onChange={event => setMfaCode(event.target.value)} placeholder="Код MFA" required/><div><button type="button" onClick={() => { setMfaOpen(false); setPending(null); setMfaCode(""); }}>Отмена</button><button>Подтвердить</button></div></form></div>}
  </div>;
}
