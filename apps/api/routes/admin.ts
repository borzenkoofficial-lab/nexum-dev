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

adminRouter.get("/overview", requireAdminPermission("dashboard.read"), (_req, res) => {
  return res.json({
    success: true,
    status: "partial",
    generatedAt: new Date().toISOString(),
    metrics: {},
    notice: "Dashboard metrics are not connected yet; no demo values are returned.",
  });
});


adminRouter.get("/users", requireAdminPermission("users.read"), async (req, res) => {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page ?? 1) || 1)));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit ?? 25) || 25)));
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const offset = (page - 1) * limit;
  try {
    const result = await query(
      "SELECT u.id, u.email, u.name, u.created_at, ara.role AS admin_role, " +
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
  const parsedLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, Math.floor(parsedLimit))) : 50;
  try {
    const result = await query(
      `SELECT id, actor_user_id, action, target_type, target_id, request_id, metadata, created_at
       FROM admin_audit_log ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.json({ success: true, events: result.rows });
  } catch {
    return res.status(503).json({ success: false, error: "Administrative audit storage unavailable" });
  }
});
