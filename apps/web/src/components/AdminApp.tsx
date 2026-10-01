import { useEffect, useMemo, useState } from "react";
import "./AdminApp.css";

type Role = "super_admin" | "admin" | "moderator" | "support" | "finance" | "content_manager" | "marketplace_manager" | "ai_manager";
type AdminUser = { id:string; email:string; name:string; createdAt:string; role:Role };
type UserRow = { id:string; name:string; email:string; role:string; status:string; orders:number; createdAt:string; lastActivity:string };

const NAV = [
  ["Dashboard","⌂"],["Users","◉"],["Providers","◇"],["Companies","▦"],["Services","◈"],["Marketplace","◆"],["Orders","↗"],["Projects","□"],["Payments","₽"],["Reviews","★"],["Messages","◌"],["AI","✦"],["Content","▤"],["Moderation","⚑"],["Analytics","◒"],["Support","?"],["Notifications","♢"],["Marketing","◎"],["Settings","⚙"],["System","◫"],
] as const;

const demoUsers: UserRow[] = [
  {id:"usr_01",name:"Alex Morgan",email:"alex@example.com",role:"Client",status:"Active",orders:14,createdAt:"2026-09-28",lastActivity:"2 min ago"},
  {id:"usr_02",name:"Mia Chen",email:"mia@example.com",role:"Freelancer",status:"Active",orders:31,createdAt:"2026-09-25",lastActivity:"8 min ago"},
  {id:"usr_03",name:"Northline Studio",email:"ops@northline.io",role:"Agency",status:"Pending",orders:7,createdAt:"2026-09-22",lastActivity:"1 h ago"},
  {id:"usr_04",name:"Daniel Reed",email:"daniel@example.com",role:"Company",status:"Suspended",orders:22,createdAt:"2026-09-20",lastActivity:"3 h ago"},
  {id:"usr_05",name:"Sofia Patel",email:"sofia@example.com",role:"Client",status:"Active",orders:8,createdAt:"2026-09-18",lastActivity:"Yesterday"},
];

function Stat({label,value,delta}:{label:string;value:string;delta:string}) {
  return <div className="admin-stat"><span>{label}</span><strong>{value}</strong><em>{delta}</em></div>;
}

function Sparkline({points}:{points:number[]}) {
  const max=Math.max(...points), min=Math.min(...points), w=420, h=110;
  const d=points.map((p,i)=>`${(i/(points.length-1))*w},${h-((p-min)/(max-min||1))*h}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="admin-spark"><polyline points={d} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg>;
}

function Dashboard() {
  return <div className="admin-page">
    <div className="admin-page-head"><div><div className="admin-eyebrow">CONTROL CENTER / OVERVIEW</div><h1>Platform overview</h1><p>Operational state across NEXUM Digital.</p></div><select defaultValue="30 days"><option>Today</option><option>7 days</option><option>30 days</option><option>3 months</option><option>12 months</option><option>Custom</option></select></div>
    <div className="admin-stats"><Stat label="Total users" value="24,892" delta="+8.4%"/><Stat label="Active users" value="18,420" delta="+4.1%"/><Stat label="Active orders" value="1,284" delta="+12.8%"/><Stat label="Revenue" value="$482.6K" delta="+18.2%"/><Stat label="Marketplace GMV" value="$1.18M" delta="+11.6%"/><Stat label="AI requests" value="842K" delta="+27.3%"/></div>
    <div className="admin-grid admin-grid-main">
      <section className="admin-card admin-chart-card"><div className="admin-card-head"><div><strong>Platform activity</strong><span>Orders, revenue and AI usage</span></div><div className="admin-legend"><i/>Orders <i/>Revenue <i/>AI</div></div><div className="admin-chart"><div className="admin-y"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div className="admin-chart-body"><div className="admin-gridlines"><i/><i/><i/><i/><i/></div><Sparkline points={[32,45,40,55,48,67,63,71,68,82,79,91,87]}/><div className="admin-x"><span>01</span><span>07</span><span>14</span><span>21</span><span>30</span></div></div></div></section>
      <section className="admin-card"><div className="admin-card-head"><div><strong>System status</strong><span>Live service health</span></div><b className="status-live">Operational</b></div><div className="admin-status-list"><div><span>API</span><b>99.99%</b><i className="dot ok"/></div><div><span>Database</span><b>99.98%</b><i className="dot ok"/></div><div><span>AI Gateway</span><b>99.94%</b><i className="dot ok"/></div><div><span>Marketplace</span><b>99.99%</b><i className="dot ok"/></div><div><span>Payments</span><b>99.97%</b><i className="dot ok"/></div></div></section>
    </div>
    <div className="admin-grid admin-grid-secondary">
      <section className="admin-card"><div className="admin-card-head"><div><strong>Recent orders</strong><span>Latest marketplace activity</span></div><button>View all</button></div><div className="admin-mini-list">{["#NX-84291 · Brand identity"," #NX-84290 · AI integration"," #NX-84289 · Landing page"," #NX-84288 · 3D assets"].map((x,i)=><div key={x}><span>{x}</span><b>{["$1,240","$3,800","$920","$2,450"][i]}</b><em>{["In progress","Review","Completed","In progress"][i]}</em></div>)}</div></section>
      <section className="admin-card"><div className="admin-card-head"><div><strong>Moderation queue</strong><span>Requires attention</span></div><b className="queue-count">18</b></div><div className="admin-queue"><div><span>Services</span><b>8</b></div><div><span>Reviews</span><b>5</b></div><div><span>Providers</span><b>3</b></div><div><span>Reports</span><b>2</b></div></div></section>
      <section className="admin-card"><div className="admin-card-head"><div><strong>Support</strong><span>Open tickets</span></div><b className="queue-count">42</b></div><div className="admin-support"><div><span>High priority</span><b>6</b></div><div><span>Waiting</span><b>14</b></div><div><span>In progress</span><b>22</b></div></div></section>
    </div>
  </div>;
}

function Users() {
  const [query,setQuery]=useState(""); const [status,setStatus]=useState("All"); const [selected,setSelected]=useState<UserRow|null>(null);
  const rows=demoUsers.filter(u=>(status==="All"||u.status===status)&&(`${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase())));
  return <div className="admin-page">
    <div className="admin-page-head"><div><div className="admin-eyebrow">IDENTITY / USERS</div><h1>Users</h1><p>Manage platform accounts, access and activity.</p></div><button className="admin-primary">Export</button></div>
    <div className="admin-toolbar"><label>⌕<input placeholder="Search users…" value={query} onChange={e=>setQuery(e.target.value)}/></label><select value={status} onChange={e=>setStatus(e.target.value)}><option>All</option><option>Active</option><option>Pending</option><option>Suspended</option><option>Blocked</option></select><button>Role</button><button>Last activity</button></div>
    <section className="admin-card admin-table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Orders</th><th>Registered</th><th>Last activity</th><th/></tr></thead><tbody>{rows.map(u=><tr key={u.id} onClick={()=>setSelected(u)}><td><div className="admin-user"><span>{u.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><div><strong>{u.name}</strong><small>{u.email}</small></div></div></td><td>{u.role}</td><td><b className={`badge badge-${u.status.toLowerCase()}`}>{u.status}</b></td><td>{u.orders}</td><td>{u.createdAt}</td><td>{u.lastActivity}</td><td>›</td></tr>)}</tbody></table>{rows.length===0&&<div className="admin-empty">No users match the current filters.</div>}<div className="admin-pagination"><span>{rows.length} of 24,892 users</span><button>‹</button><button className="active">1</button><button>2</button><button>3</button><button>›</button></div></section>
    {selected&&<div className="admin-drawer-backdrop" onClick={()=>setSelected(null)}><aside className="admin-drawer" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><span className="drawer-avatar">{selected.name.slice(0,2).toUpperCase()}</span><div><h2>{selected.name}</h2><p>{selected.email}</p></div></div><button onClick={()=>setSelected(null)}>×</button></div><div className="drawer-section"><span>ACCOUNT</span><div className="drawer-row"><b>Role</b><em>{selected.role}</em></div><div className="drawer-row"><b>Status</b><em>{selected.status}</em></div><div className="drawer-row"><b>Orders</b><em>{selected.orders}</em></div><div className="drawer-row"><b>Registered</b><em>{selected.createdAt}</em></div></div><div className="drawer-tabs"><button className="active">Activity</button><button>Orders</button><button>Projects</button><button>Payments</button><button>Security</button></div><div className="drawer-timeline"><div><i/>Signed in <small>2 min ago</small></div><div><i/>Order #NX-84291 opened <small>1 h ago</small></div><div><i/>Profile updated <small>Yesterday</small></div></div><div className="drawer-actions"><button>Change role</button><button className="danger">Suspend</button></div></aside></div>}
  </div>;
}

export function AdminApp() {
  const [admin,setAdmin]=useState<AdminUser|null>(null); const [loading,setLoading]=useState(true); const [active,setActive]=useState("Dashboard"); const [search,setSearch]=useState(""); const [mobileOpen,setMobileOpen]=useState(false);
  useEffect(()=>{fetch("/api/admin/me",{credentials:"include"}).then(async r=>{if(!r.ok)throw new Error("Admin access required"); const d=await r.json(); setAdmin(d.user);}).catch(()=>setAdmin(null)).finally(()=>setLoading(false));},[]);
  const nav=useMemo(()=>NAV.filter(([label])=>!search||label.toLowerCase().includes(search.toLowerCase())),[search]);
  if(loading)return <div className="admin-loading"><span>N</span><p>Authenticating Control Center…</p></div>;
  if(!admin)return <div className="admin-denied"><div><span>N</span><h1>Admin access required</h1><p>This area is protected by NEXUM RBAC. Sign in with an authorized administrator account.</p><button onClick={()=>window.location.href="/"}>Return to NEXUM</button></div></div>;
  return <div className="admin-shell">
    <aside className={`admin-sidebar ${mobileOpen?"open":""}`}><div className="admin-brand"><div><strong>NEXUM</strong><span>Digital</span></div><small>ADMIN CONTROL CENTER</small></div><nav>{nav.map(([label,icon])=><button key={label} className={active===label?"active":""} onClick={()=>{setActive(label);setMobileOpen(false)}}><i>{icon}</i><span>{label}</span>{["Moderation","Support","Notifications"].includes(label)&&<b>•</b>}</button>)}</nav><div className="admin-sidebar-foot"><div><span>{admin.name.slice(0,2).toUpperCase()}</span><div><strong>{admin.name}</strong><small>{admin.role.replaceAll("_"," ")}</small></div></div><button title="Sign out" onClick={async()=>{await fetch("/api/auth/logout",{method:"POST",credentials:"include"});window.location.href="/";}}>↪</button></div></aside>
    <main className="admin-main"><header className="admin-topbar"><button className="admin-mobile-menu" onClick={()=>setMobileOpen(v=>!v)}>☰</button><div className="admin-search"><span>⌕</span><input placeholder="Search the Control Center…" value={search} onChange={e=>setSearch(e.target.value)}/><kbd>⌘ K</kbd></div><div className="admin-top-actions"><button>◌</button><button>♢</button><div className="admin-profile"><span>{admin.name.slice(0,2).toUpperCase()}</span><div><strong>{admin.name}</strong><small>{admin.role.replaceAll("_"," ")}</small></div></div></div></header>
      {active==="Dashboard"?<Dashboard/>:active==="Users"?<Users/>:<div className="admin-page"><div className="admin-placeholder"><div className="admin-eyebrow">MODULE READY</div><h1>{active}</h1><p>The {active} module is reserved in the Control Center architecture and will be implemented in its dedicated phase. No decorative actions are exposed.</p><span>Phase 2+ · protected route architecture already established</span></div></div>}
    </main>
  </div>;
}
