import { randomUUID } from "node:crypto";
import { query, withDatabaseTransaction } from "../db.js";

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";
export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  created_at: string;
}

export function canManageOrganization(role: OrganizationRole): boolean {
  return role === "owner" || role === "admin";
}

export async function listOrganizationsForUser(userId: string): Promise<Organization[]> {
  const result = await query<Organization>(
    `SELECT o.id, o.name, o.slug, m.role, o.created_at
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
      WHERE m.user_id = $1
      ORDER BY o.created_at ASC`,
    [userId],
  );
  return result.rows;
}

export async function getOrganizationMembership(userId: string, organizationId: string): Promise<Organization | null> {
  const result = await query<Organization>(
    `SELECT o.id, o.name, o.slug, m.role, o.created_at
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
      WHERE m.user_id = $1 AND o.id = $2
      LIMIT 1`,
    [userId, organizationId],
  );
  return result.rows[0] ?? null;
}

export async function createOrganization(userId: string, name: string): Promise<Organization> {
  const normalizedName = name.trim().replace(/\s+/g, " ");
  if (!normalizedName || normalizedName.length > 120) throw new Error("Organization name must contain 1-120 characters.");
  const id = randomUUID();
  const slugBase = normalizedName.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
  const slug = `${slugBase}-${id.slice(0, 8)}`;
  return withDatabaseTransaction(async (client) => {
    await client.query("INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)", [id, normalizedName, slug]);
    await client.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [id, userId],
    );
    return { id, name: normalizedName, slug, role: "owner", created_at: new Date().toISOString() };
  });
}
