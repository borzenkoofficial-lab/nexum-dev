import type { NextFunction, Request, Response } from "express";
import { getAuthUser } from "../auth.js";
import { getOrganizationMembership, type Organization, type OrganizationRole } from "./organizationService.js";

declare global {
  namespace Express {
    interface Request {
      organization?: Organization;
    }
  }
}

export async function requireOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = getAuthUser(req);
    const requestedId = req.header("x-organization-id")?.trim();
    let organization: Organization | null = null;
    if (requestedId) {
      organization = await getOrganizationMembership(user.id, requestedId);
    } else {
      const { listOrganizationsForUser } = await import("./organizationService.js");
      organization = (await listOrganizationsForUser(user.id))[0] ?? null;
    }
    if (!organization) {
      res.status(403).json({ success: false, error: "No accessible organization. Create a workspace or verify membership." });
      return;
    }
    req.organization = organization;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireOrganizationRole(...allowedRoles: OrganizationRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.organization || !allowedRoles.includes(req.organization.role)) {
      res.status(403).json({ success: false, error: "Insufficient organization permissions." });
      return;
    }
    next();
  };
}
