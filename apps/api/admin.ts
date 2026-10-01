import type { NextFunction, Request, Response } from "express";
import { query } from "./db.js";
import { getAuthUser, type AuthUser } from "./auth.js";

export const ADMIN_ROLES = [
  "super_admin",
  "admin",
  "moderator",
  "support",
  "finance",
  "content_manager",
  "marketplace_manager",
  "ai_manager",
] as const;

export type AdminRole = typeof ADMIN_ROLES[number];
export type AdminPermission =
  | "users.view" | "users.edit" | "users.suspend"
  | "providers.view" | "providers.manage"
  | "marketplace.view" | "marketplace.manage"
  | "orders.view" | "orders.manage"
  | "payments.view" | "payments.refund" | "payments.export"
  | "moderation.view" | "moderation.manage"
  | "ai.view" | "ai.manage" | "ai.configure"
  | "content.view" | "content.create" | "content.edit" | "content.publish"
  | "support.view" | "support.manage"
  | "analytics.view"
  | "system.view" | "system.manage"
  | "audit.view";

const ALL: AdminPermission[] = [
  "users.view","users.edit","users.suspend","providers.view","providers.manage",
  "marketplace.view","marketplace.manage","orders.view","orders.manage",
  "payments.view","payments.refund","payments.export","moderation.view","moderation.manage",
  "ai.view","ai.manage","ai.configure","content.view","content.create","content.edit",
  "content.publish","support.view","support.manage","analytics.view","system.view","system.manage","audit.view",
];

export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  super_admin: ALL,
  admin: ALL.filter((p) => p !== "system.manage"),
  moderator: ["users.view","users.suspend","providers.view","providers.manage","marketplace.view","marketplace.manage","moderation.view","moderation.manage","content.view","content.edit","support.view","support.manage","analytics.view","audit.view"],
  support: ["users.view","orders.view","support.view","support.manage","audit.view"],
  finance: ["orders.view","payments.view","payments.refund","payments.export","analytics.view","audit.view"],
  content_manager: ["marketplace.view","marketplace.manage","content.view","content.create","content.edit","content.publish","analytics.view","audit.view"],
  marketplace_manager: ["providers.view","providers.manage","marketplace.view","marketplace.manage","orders.view","analytics.view","audit.view"],
  ai_manager: ["ai.view","ai.manage","ai.configure","analytics.view","audit.view"],
};

export interface AdminUser extends AuthUser {
  role: AdminRole;
}

function roleFromValue(value: unknown): AdminRole | null {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value) ? value as AdminRole : null;
}

export async function getAdminUser(user: AuthUser): Promise<AdminUser | null> {
  if (process.env.NEXUM_AUTH_ENABLED !== "true") {
    return { ...user, role: "super_admin" };
  }
  const result = await query<{ role: string }>("SELECT role FROM users WHERE id = $1 LIMIT 1", [user.id]);
  const role = roleFromValue(result.rows[0]?.role);
  return role ? { ...user, role } : null;
}

export function hasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function requireAdmin(permission?: AdminPermission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await getAdminUser(getAuthUser(req));
      if (!user) {
        res.status(403).json({ success: false, error: "Admin access required" });
        return;
      }
      req.adminUser = user;
      if (permission && !hasPermission(user.role, permission)) {
        res.status(403).json({ success: false, error: "Insufficient permission", permission });
        return;
      }
      next();
    } catch (error) {
      res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Admin authorization unavailable" });
    }
  };
}

export async function writeAuditLog(input: {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  previousData?: unknown;
  newData?: unknown;
  metadata?: unknown;
}): Promise<void> {
  await query(
    "INSERT INTO admin_audit_log (actor_user_id, action, resource_type, resource_id, previous_data, new_data, metadata) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)",
    [
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      input.previousData === undefined ? null : JSON.stringify(input.previousData),
      input.newData === undefined ? null : JSON.stringify(input.newData),
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
    ],
  );
}

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
    }
  }
}
