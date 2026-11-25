import type { NextFunction, Request, Response } from "express";
import { query } from "./db.js";

export type AdminRole = "super_admin" | "admin" | "support" | "finance" | "developer" | "auditor";
export type AdminPermission =
  | "dashboard.read"
  | "users.read"
  | "users.manage"
  | "organizations.read"
  | "billing.read"
  | "billing.manage"
  | "runtime.read"
  | "runtime.manage"
  | "audit.read"
  | "roles.manage";

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ["dashboard.read", "users.read", "users.manage", "organizations.read", "billing.read", "billing.manage", "runtime.read", "runtime.manage", "audit.read", "roles.manage"],
  admin: ["dashboard.read", "users.read", "users.manage", "organizations.read", "runtime.read", "audit.read"],
  support: ["dashboard.read", "users.read", "organizations.read"],
  finance: ["dashboard.read", "billing.read", "billing.manage"],
  developer: ["dashboard.read", "runtime.read", "runtime.manage"],
  auditor: ["dashboard.read", "users.read", "organizations.read", "billing.read", "runtime.read", "audit.read"],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare global {
  namespace Express {
    interface Request {
      adminRole?: AdminRole;
      adminPermissions?: readonly AdminPermission[];
    }
  }
}

export function parseBootstrapUserIds(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const values = raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (values.some((value) => !UUID_PATTERN.test(value))) {
    throw new Error("KVARD_SUPER_ADMIN_USER_IDS must contain comma-separated UUIDs.");
  }
  return [...new Set(values)];
}

export function roleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

async function bootstrapSuperAdmins(): Promise<void> {
  const ids = parseBootstrapUserIds(process.env.KVARD_SUPER_ADMIN_USER_IDS);
  if (ids.length === 0) return;
  await query(
    `WITH changed AS (
       INSERT INTO admin_role_assignments (user_id, role)
       SELECT id, 'super_admin' FROM users WHERE id = ANY($1::uuid[])
       ON CONFLICT (user_id) DO UPDATE
         SET role = 'super_admin', updated_at = NOW()
         WHERE admin_role_assignments.role <> 'super_admin'
       RETURNING user_id
     )
     INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
     SELECT NULL, 'admin.bootstrap.super_admin', 'user', user_id::text,
       '{"source":"KVARD_SUPER_ADMIN_USER_IDS"}'::jsonb
     FROM changed`,
    [ids],
  );
}

export async function requireAdminAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  // MFA is not implemented in the current authentication flow. Keep production
  // administration closed even if an operator accidentally configures the bootstrap list.
  if (process.env.NODE_ENV === "production") {
    res.status(503).json({ success: false, error: "Administrative access is disabled until MFA is enforced." });
    return;
  }
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  try {
    await bootstrapSuperAdmins();
    const result = await query<{ role: AdminRole }>(
      "SELECT role FROM admin_role_assignments WHERE user_id = $1 LIMIT 1",
      [userId],
    );
    const role = result.rows[0]?.role;
    if (!role || !ROLE_PERMISSIONS[role]) {
      res.status(403).json({ success: false, error: "Administrative access denied" });
      return;
    }
    req.adminRole = role;
    req.adminPermissions = ROLE_PERMISSIONS[role];
    next();
  } catch (error) {
    console.error("[КВАРД] Admin authorization failed closed", error);
    res.status(503).json({ success: false, error: "Administrative authorization unavailable" });
  }
}

export function requireAdminPermission(permission: AdminPermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.adminRole || !req.adminPermissions?.includes(permission)) {
      res.status(403).json({ success: false, error: "Insufficient administrative permissions" });
      return;
    }
    next();
  };
}
