import { Router } from "express";
import { getAuthUser } from "../auth.js";
import { withDatabaseTransaction, query } from "../db.js";
import { requireAdminPermission, requireRecentMfa, type AdminRole } from "../adminAccess.js";

export const adminRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_ROLES: readonly AdminRole[] = ["super_admin", "admin", "support", "finance", "developer", "auditor"];

adminRouter.get("/me", (req, res) => {
  return res.json({
    success: true,
    user: { id: getAuthUser(req).id },
    role: req.adminRole,
    permissions: req.adminPermissions ?? [],
  });
});

adminRouter.get("/overview", requireAdminPermission("dashboard.read"), async (_req, res) => {
  try {
    const result = await query<{
      users_total: string; users_active: string; users_suspended: string; users_new_7d: string;
      organizations_total: string; projects_total: string; agents_total: string;
      runs_24h: string; runs_running: string; runs_completed_24h: string; runs_failed_24h: string;
      ai_cost_30d: string; ai_tokens_30d: string;
    }>(
      `SELECT
        (SELECT COUNT(*)::text FROM users) AS users_total,
        (SELECT COUNT(*)::text FROM users WHERE status = 'active') AS users_active,
        (SELECT COUNT(*)::text FROM users WHERE status = 'suspended') AS users_suspended,
        (SELECT COUNT(*)::text FROM users WHERE created_at >= NOW() - INTERVAL '7 days') AS users_new_7d,
        (SELECT COUNT(*)::text FROM organizations) AS organizations_total,
        (SELECT COUNT(*)::text FROM project_workspaces) AS projects_total,
        (SELECT COUNT(*)::text FROM agents WHERE status <> 'archived') AS agents_total,
        (SELECT COUNT(*)::text FROM agent_runs WHERE created_at >= NOW() - INTERVAL '24 hours') AS runs_24h,
        (SELECT COUNT(*)::text FROM agent_runs WHERE status IN ('queued','initializing','planning','running','waiting_approval')) AS runs_running,
        (SELECT COUNT(*)::text FROM agent_runs WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '24 hours') AS runs_completed_24h,
        (SELECT COUNT(*)::text FROM agent_runs WHERE status IN ('failed','timed_out','limit_reached') AND created_at >= NOW() - INTERVAL '24 hours') AS runs_failed_24h,
        (SELECT COALESCE(SUM(estimated_cost), 0)::text FROM usage_records WHERE created_at >= NOW() - INTERVAL '30 days') AS ai_cost_30d,
        (SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::text FROM usage_records WHERE created_at >= NOW() - INTERVAL '30 days') AS ai_tokens_30d`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("Dashboard query returned no result.");
    const numeric = (value: string) => Number(value);
    return res.json({
      success: true,
      status: "live",
      generatedAt: new Date().toISOString(),
      metrics: {
        users: { total: numeric(row.users_total), active: numeric(row.users_active), suspended: numeric(row.users_suspended), new7d: numeric(row.users_new_7d) },
        organizations: numeric(row.organizations_total),
        projects: numeric(row.projects_total),
        agents: numeric(row.agents_total),
        runs: { last24h: numeric(row.runs_24h), active: numeric(row.runs_running), completed24h: numeric(row.runs_completed_24h), failed24h: numeric(row.runs_failed_24h) },
        ai: { cost30d: row.ai_cost_30d, tokens30d: numeric(row.ai_tokens_30d) },
      },
    });
  } catch {
    return res.status(503).json({ success: false, error: "Live dashboard metrics are unavailable." });
  }
});


adminRouter.get("/users", requireAdminPermission("users.read"), async (req, res) => {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page ?? 1) || 1)));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit ?? 25) || 25)));
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const offset = (page - 1) * limit;
  try {
    const result = await query(
      "SELECT u.id, u.email, u.name, u.created_at, u.status, u.suspended_at, u.suspension_reason, ara.role AS admin_role, " +
      "COUNT(DISTINCT om.organization_id)::int AS organizations_count, COUNT(DISTINCT p.id)::int AS projects_count " +
      "FROM users u LEFT JOIN admin_role_assignments ara ON ara.user_id = u.id " +
      "LEFT JOIN organization_members om ON om.user_id = u.id LEFT JOIN project_workspaces p ON p.user_id = u.id " +
      "WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%' OR u.id::text = $1) " +
      "GROUP BY u.id, ara.role ORDER BY u.created_at DESC, u.id LIMIT $2 OFFSET $3",
      [search, limit, offset],
    );
    const count = await query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM users u WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%' OR u.id::text = $1)",
      [search],
    );
    return res.json({ success: true, users: result.rows, pagination: { page, limit, total: Number(count.rows[0]?.total ?? 0) } });
  } catch {
    return res.status(503).json({ success: false, error: "User directory unavailable." });
  }
});



adminRouter.get("/users/:userId", requireAdminPermission("users.read"), async (req, res) => {
  const userId = typeof req.params.userId === "string" ? req.params.userId : "";
  if (!UUID_PATTERN.test(userId)) return res.status(400).json({ success: false, error: "A valid user UUID is required." });
  try {
    const userResult = await query(
      "SELECT u.id, u.email, u.name, u.created_at, u.status, u.suspended_at, u.suspended_by, u.suspension_reason, ara.role AS admin_role " +
      "FROM users u LEFT JOIN admin_role_assignments ara ON ara.user_id = u.id WHERE u.id = $1 LIMIT 1",
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ success: false, error: "User not found." });

    const [organizations, projects, subscriptions, usage, runs] = await Promise.all([
      query(
        "SELECT o.id, o.name, o.slug, om.role, om.created_at AS joined_at " +
        "FROM organization_members om JOIN organizations o ON o.id = om.organization_id " +
        "WHERE om.user_id = $1 ORDER BY om.created_at DESC",
        [userId],
      ),
      query(
        "SELECT id, project_id, name, project_type, status, created_at, updated_at " +
        "FROM project_workspaces WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50",
        [userId],
      ),
      query(
        "SELECT o.id AS organization_id, o.name AS organization_name, p.id AS plan_id, p.name AS plan_name, " +
        "s.status, s.period_start, s.period_end " +
        "FROM organization_members om JOIN organizations o ON o.id = om.organization_id " +
        "JOIN LATERAL (SELECT os.* FROM organization_subscriptions os WHERE os.organization_id = o.id ORDER BY os.created_at DESC LIMIT 1) s ON TRUE " +
        "JOIN subscription_plans p ON p.id = s.plan_id WHERE om.user_id = $1 ORDER BY o.name ASC",
        [userId],
      ),
      query<{ records: string; input_tokens: string; output_tokens: string; estimated_cost: string; last_used_at: string | null }>(
        "SELECT COUNT(*)::text AS records, COALESCE(SUM(input_tokens),0)::text AS input_tokens, " +
        "COALESCE(SUM(output_tokens),0)::text AS output_tokens, COALESCE(SUM(estimated_cost),0)::text AS estimated_cost, " +
        "MAX(created_at) AS last_used_at FROM usage_records WHERE user_id = $1",
        [userId],
      ),
      query<{ total: string; completed: string; failed: string; last_run_at: string | null }>(
        "SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE status = 'completed')::text AS completed, " +
        "COUNT(*) FILTER (WHERE status IN ('failed','timed_out','limit_reached'))::text AS failed, MAX(created_at) AS last_run_at " +
        "FROM agent_runs WHERE created_by = $1",
        [userId],
      ),
    ]);
    return res.json({
      success: true,
      user,
      organizations: organizations.rows,
      projects: projects.rows,
      subscriptions: subscriptions.rows,
      usage: usage.rows[0] ?? null,
      runs: runs.rows[0] ?? null,
    });
  } catch {
    return res.status(503).json({ success: false, error: "User details are temporarily unavailable." });
  }
});

adminRouter.post("/users/:userId/suspend", requireAdminPermission("users.manage"), requireRecentMfa, async (req, res) => {
  const targetUserId = typeof req.params.userId === "string" ? req.params.userId : "";
  const reasonValue = (req.body as { reason?: unknown } | undefined)?.reason;
  const reason = typeof reasonValue === "string" ? reasonValue.trim().slice(0, 500) : "";
  if (!UUID_PATTERN.test(targetUserId) || reason.length < 5) {
    return res.status(400).json({ success: false, error: "A valid user UUID and a suspension reason of at least 5 characters are required." });
  }
  const actor = getAuthUser(req);
  if (targetUserId === actor.id) return res.status(409).json({ success: false, error: "You cannot suspend your own account." });
  try {
    const result = await withDatabaseTransaction(async (client) => {
      const target = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM users WHERE id = $1 FOR UPDATE", [targetUserId],
      );
      if (!target.rows[0]) return null;
      const updated = await client.query(
        "UPDATE users SET status = 'suspended', suspended_at = NOW(), suspended_by = $2, suspension_reason = $3 WHERE id = $1 RETURNING id, status, suspended_at, suspension_reason",
        [targetUserId, actor.id, reason],
      );
      const revoked = await client.query(
        "UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id",
        [targetUserId],
      );
      await client.query(
        "INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata) VALUES ($1, 'user.suspend', 'user', $2, $3, $4::jsonb)",
        [actor.id, targetUserId, req.header("x-request-id") ?? null, JSON.stringify({ reason, previousStatus: target.rows[0].status, revokedSessions: revoked.rows.length })],
      );
      return { user: updated.rows[0], revokedSessions: revoked.rows.length };
    });
    if (!result) return res.status(404).json({ success: false, error: "User not found." });
    return res.json({ success: true, ...result });
  } catch {
    return res.status(503).json({ success: false, error: "Account suspension failed." });
  }
});

adminRouter.post("/users/:userId/activate", requireAdminPermission("users.manage"), requireRecentMfa, async (req, res) => {
  const targetUserId = typeof req.params.userId === "string" ? req.params.userId : "";
  if (!UUID_PATTERN.test(targetUserId)) return res.status(400).json({ success: false, error: "A valid user UUID is required." });
  const actor = getAuthUser(req);
  if (targetUserId === actor.id) return res.status(409).json({ success: false, error: "Self-reactivation is not allowed through the admin endpoint." });
  try {
    const result = await withDatabaseTransaction(async (client) => {
      const target = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM users WHERE id = $1 FOR UPDATE", [targetUserId],
      );
      if (!target.rows[0]) return null;
      const updated = await client.query(
        "UPDATE users SET status = 'active', suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL WHERE id = $1 RETURNING id, status",
        [targetUserId],
      );
      await client.query(
        "INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata) VALUES ($1, 'user.activate', 'user', $2, $3, $4::jsonb)",
        [actor.id, targetUserId, req.header("x-request-id") ?? null, JSON.stringify({ previousStatus: target.rows[0].status })],
      );
      return updated.rows[0];
    });
    if (!result) return res.status(404).json({ success: false, error: "User not found." });
    return res.json({ success: true, user: result, note: "The user must sign in again; previous sessions were revoked on suspension." });
  } catch {
    return res.status(503).json({ success: false, error: "Account reactivation failed." });
  }
});

adminRouter.get("/organizations", requireAdminPermission("organizations.read"), async (req, res) => {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page ?? 1) || 1)));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit ?? 25) || 25)));
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const offset = (page - 1) * limit;
  try {
    const result = await query(
      "SELECT o.id, o.name, o.slug, o.created_at, o.updated_at, " +
      "COUNT(DISTINCT om.user_id)::int AS members_count, COUNT(DISTINCT a.id)::int AS agents_count, " +
      "COUNT(DISTINCT w.id)::int AS workforces_count, owner.user_id AS owner_user_id, owner_user.email AS owner_email " +
      "FROM organizations o LEFT JOIN organization_members om ON om.organization_id = o.id " +
      "LEFT JOIN organization_members owner ON owner.organization_id = o.id AND owner.role = 'owner' " +
      "LEFT JOIN users owner_user ON owner_user.id = owner.user_id " +
      "LEFT JOIN agents a ON a.organization_id = o.id LEFT JOIN workforces w ON w.organization_id = o.id " +
      "WHERE ($1 = '' OR o.name ILIKE '%' || $1 || '%' OR o.slug ILIKE '%' || $1 || '%' OR o.id::text = $1) " +
      "GROUP BY o.id, owner.user_id, owner_user.email ORDER BY o.created_at DESC, o.id LIMIT $2 OFFSET $3",
      [search, limit, offset],
    );
    const count = await query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM organizations o WHERE ($1 = '' OR o.name ILIKE '%' || $1 || '%' OR o.slug ILIKE '%' || $1 || '%' OR o.id::text = $1)",
      [search],
    );
    return res.json({ success: true, organizations: result.rows, pagination: { page, limit, total: Number(count.rows[0]?.total ?? 0) } });
  } catch {
    return res.status(503).json({ success: false, error: "Organization directory unavailable." });
  }
});

adminRouter.get("/organizations/:organizationId/members", requireAdminPermission("organizations.read"), async (req, res) => {
  const organizationId = typeof req.params.organizationId === "string" ? req.params.organizationId : "";
  if (!UUID_PATTERN.test(organizationId)) return res.status(400).json({ success: false, error: "A valid organization UUID is required." });
  try {
    const result = await query(
      "SELECT u.id, u.email, u.name, om.role, om.created_at AS joined_at " +
      "FROM organization_members om JOIN users u ON u.id = om.user_id " +
      "WHERE om.organization_id = $1 " +
      "ORDER BY CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, om.created_at ASC",
      [organizationId],
    );
    return res.json({ success: true, members: result.rows });
  } catch {
    return res.status(503).json({ success: false, error: "Organization member directory unavailable." });
  }
});

adminRouter.get("/roles", requireAdminPermission("roles.manage"), async (_req, res) => {
  try {
    const result = await query<{ user_id: string; role: AdminRole; created_at: string; updated_at: string }>(
      "SELECT user_id, role, created_at, updated_at FROM admin_role_assignments ORDER BY created_at ASC",
    );
    return res.json({ success: true, assignments: result.rows });
  } catch {
    return res.status(503).json({ success: false, error: "Administrative role storage unavailable" });
  }
});

adminRouter.put("/roles/:userId", requireAdminPermission("roles.manage"), requireRecentMfa, async (req, res) => {
  const targetUserId = typeof req.params.userId === "string" ? req.params.userId : "";
  const role = (req.body as { role?: unknown } | undefined)?.role;
  if (!UUID_PATTERN.test(targetUserId) || typeof role !== "string" || !ADMIN_ROLES.includes(role as AdminRole)) {
    return res.status(400).json({ success: false, error: "A valid user UUID and administrative role are required." });
  }

  const actor = getAuthUser(req);
  if (targetUserId === actor.id) {
    return res.status(409).json({ success: false, error: "Self-modification of administrative roles is not allowed." });
  }

  try {
    const assignment = await withDatabaseTransaction(async (client) => {
      // Serialize all Super Admin promotion/demotion paths to protect the last owner.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('kvard_admin_super_admin_guard'))");
      const existing = await client.query<{ role: AdminRole }>(
        "SELECT role FROM admin_role_assignments WHERE user_id = $1 FOR UPDATE",
        [targetUserId],
      );
      if (existing.rows[0]?.role === "super_admin" && role !== "super_admin") {
        const count = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM admin_role_assignments WHERE role = 'super_admin'",
        );
        if (Number(count.rows[0]?.count ?? 0) <= 1) {
          throw new Error("Cannot demote the last Super Admin.");
        }
      }
      const updated = await client.query<{ user_id: string; role: AdminRole; created_at: string; updated_at: string }>(
        `INSERT INTO admin_role_assignments (user_id, role, granted_by)
         SELECT id, $2, $3 FROM users WHERE id = $1
         ON CONFLICT (user_id) DO UPDATE
           SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, updated_at = NOW()
         RETURNING user_id, role, created_at, updated_at`,
        [targetUserId, role, actor.id],
      );
      const row = updated.rows[0];
      if (!row) return null;
      // Role changes invalidate all existing sessions so privilege changes take effect immediately.
      const revokedSessions = await client.query(
        "UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id",
        [targetUserId],
      );
      await client.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata)
         VALUES ($1, 'admin.role.upsert', 'user', $2, $3, $4::jsonb)`,
        [actor.id, targetUserId, req.header("x-request-id") ?? null, JSON.stringify({ role, revokedSessions: revokedSessions.rows.length })],
      );
      return row;
    });
    if (!assignment) return res.status(404).json({ success: false, error: "Target user not found." });
    return res.json({ success: true, assignment });
  } catch (error) {
    if (error instanceof Error && error.message === "Cannot demote the last Super Admin.") {
      return res.status(409).json({ success: false, error: error.message });
    }
    return res.status(503).json({ success: false, error: "Administrative role update failed." });
  }
});

adminRouter.delete("/roles/:userId", requireAdminPermission("roles.manage"), requireRecentMfa, async (req, res) => {
  const targetUserId = typeof req.params.userId === "string" ? req.params.userId : "";
  if (!UUID_PATTERN.test(targetUserId)) {
    return res.status(400).json({ success: false, error: "A valid user UUID is required." });
  }
  const actor = getAuthUser(req);
  if (targetUserId === actor.id) {
    return res.status(409).json({ success: false, error: "Self-revocation is not allowed." });
  }

  try {
    const removed = await withDatabaseTransaction(async (client) => {
      const existing = await client.query<{ role: AdminRole }>(
        "SELECT role FROM admin_role_assignments WHERE user_id = $1 FOR UPDATE",
        [targetUserId],
      );
      const assignment = existing.rows[0];
      if (!assignment) return false;
      if (assignment.role === "super_admin") {
        // Serialize concurrent Super Admin revocations so two requests cannot remove the final pair.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('kvard_admin_super_admin_guard'))");
        const count = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM admin_role_assignments WHERE role = 'super_admin'",
        );
        if (Number(count.rows[0]?.count ?? 0) <= 1) {
          throw new Error("Cannot revoke the last Super Admin.");
        }
      }
      await client.query("DELETE FROM admin_role_assignments WHERE user_id = $1", [targetUserId]);
      const revokedSessions = await client.query(
        "UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id",
        [targetUserId],
      );
      await client.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata)
         VALUES ($1, 'admin.role.revoke', 'user', $2, $3, $4::jsonb)`,
        [actor.id, targetUserId, req.header("x-request-id") ?? null, JSON.stringify({ previousRole: assignment.role, revokedSessions: revokedSessions.rows.length })],
      );
      return true;
    });
    if (!removed) return res.status(404).json({ success: false, error: "Administrative assignment not found." });
    return res.json({ success: true, revoked: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Cannot revoke the last Super Admin.") {
      return res.status(409).json({ success: false, error: error.message });
    }
    return res.status(503).json({ success: false, error: "Administrative role revocation failed." });
  }
});

adminRouter.get("/sessions", requireAdminPermission("sessions.manage"), async (req, res) => {
  const parsedLimit = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(parsedLimit) ? Math.min(250, Math.max(1, Math.floor(parsedLimit))) : 100;
  try {
    const result = await query(
      `SELECT s.id, s.user_id, u.email, s.mfa_verified, s.created_at, s.last_seen_at, s.expires_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > NOW()
         AND s.last_seen_at > NOW() - INTERVAL '30 minutes'
       ORDER BY s.last_seen_at DESC LIMIT $1`,
      [limit],
    );
    return res.json({ success: true, sessions: result.rows });
  } catch {
    return res.status(503).json({ success: false, error: "Session registry unavailable." });
  }
});

adminRouter.delete("/sessions/:sessionId", requireAdminPermission("sessions.manage"), requireRecentMfa, async (req, res) => {
  const sessionId = typeof req.params.sessionId === "string" ? req.params.sessionId : "";
  if (!UUID_PATTERN.test(sessionId)) return res.status(400).json({ success: false, error: "A valid session UUID is required." });
  const actor = getAuthUser(req);
  try {
    const revoked = await withDatabaseTransaction(async (client) => {
      const result = await client.query<{ user_id: string }>(
        "UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING user_id",
        [sessionId],
      );
      const row = result.rows[0];
      if (!row) return false;
      await client.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata)
         VALUES ($1, 'admin.session.revoke', 'auth_session', $2, $3, $4::jsonb)`,
        [actor.id, sessionId, req.header("x-request-id") ?? null, JSON.stringify({ targetUserId: row.user_id })],
      );
      return true;
    });
    if (!revoked) return res.status(404).json({ success: false, error: "Active session not found." });
    return res.json({ success: true, revoked: true });
  } catch {
    return res.status(503).json({ success: false, error: "Session revocation failed." });
  }
});

adminRouter.get("/audit", requireAdminPermission("audit.read"), async (req, res) => {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page ?? 1) || 1)));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit ?? 50) || 50)));
  const actorId = typeof req.query.actorUserId === "string" && UUID_PATTERN.test(req.query.actorUserId) ? req.query.actorUserId : null;
  if (req.query.actorUserId && !actorId) return res.status(400).json({ success: false, error: "actorUserId must be a UUID." });
  const action = typeof req.query.action === "string" ? req.query.action.trim().slice(0, 100) || null : null;
  const targetType = typeof req.query.targetType === "string" ? req.query.targetType.trim().slice(0, 80) || null : null;
  const targetId = typeof req.query.targetId === "string" ? req.query.targetId.trim().slice(0, 120) || null : null;
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if ((fromDate && !Number.isFinite(fromDate.getTime())) || (toDate && !Number.isFinite(toDate.getTime())) ||
      (fromDate && toDate && fromDate > toDate)) {
    return res.status(400).json({ success: false, error: "Audit date range is invalid." });
  }
  const filters = [actorId, action, targetType, targetId, fromDate?.toISOString() ?? null, toDate?.toISOString() ?? null];
  const offset = (page - 1) * limit;
  try {
    const where = `WHERE ($1::uuid IS NULL OR actor_user_id = $1::uuid)
      AND ($2::text IS NULL OR action ILIKE '%' || $2 || '%')
      AND ($3::text IS NULL OR target_type = $3)
      AND ($4::text IS NULL OR target_id = $4)
      AND ($5::timestamptz IS NULL OR created_at >= $5::timestamptz)
      AND ($6::timestamptz IS NULL OR created_at <= $6::timestamptz)`;
    const [result, count] = await Promise.all([
      query(
        `SELECT id, actor_user_id, action, target_type, target_id, request_id, metadata, created_at
         FROM admin_audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT $7 OFFSET $8`,
        [...filters, limit, offset],
      ),
      query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM admin_audit_log ${where}`, filters),
    ]);
    return res.json({ success: true, events: result.rows, pagination: { page, limit, total: Number(count.rows[0]?.total ?? 0) } });
  } catch {
    return res.status(503).json({ success: false, error: "Administrative audit storage unavailable" });
  }
});
