import { Router } from "express";
import { getAuthUser } from "../auth.js";
import { withDatabaseTransaction, query } from "../db.js";
import { requireAdminPermission, type AdminRole } from "../adminAccess.js";

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

adminRouter.put("/roles/:userId", requireAdminPermission("roles.manage"), async (req, res) => {
  const targetUserId = req.params.userId;
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
      await client.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata)
         VALUES ($1, 'admin.role.upsert', 'user', $2, $3, $4::jsonb)`,
        [actor.id, targetUserId, req.header("x-request-id") ?? null, JSON.stringify({ role })],
      );
      return row;
    });
    if (!assignment) return res.status(404).json({ success: false, error: "Target user not found." });
    return res.json({ success: true, assignment });
  } catch {
    return res.status(503).json({ success: false, error: "Administrative role update failed." });
  }
});

adminRouter.delete("/roles/:userId", requireAdminPermission("roles.manage"), async (req, res) => {
  const targetUserId = req.params.userId;
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
      await client.query(
        `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, request_id, metadata)
         VALUES ($1, 'admin.role.revoke', 'user', $2, $3, $4::jsonb)`,
        [actor.id, targetUserId, req.header("x-request-id") ?? null, JSON.stringify({ previousRole: assignment.role })],
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
