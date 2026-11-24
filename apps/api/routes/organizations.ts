import { Router } from "express";
import { getAuthUser } from "../auth.js";
import { createOrganization, listOrganizationsForUser } from "../organizations/organizationService.js";
import { requireOrganization, requireOrganizationRole } from "../organizations/organizationMiddleware.js";
import { getOrganizationUsage } from "../billing/quotaService.js";

export const organizationsRouter = Router();

organizationsRouter.get("/", async (req, res, next) => {
  try {
    const organizations = await listOrganizationsForUser(getAuthUser(req).id);
    return res.json({ success: true, organizations });
  } catch (error) { return next(error); }
});

organizationsRouter.post("/", async (req, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const organization = await createOrganization(getAuthUser(req).id, name);
    return res.status(201).json({ success: true, organization });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Organization name")) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return next(error);
  }
});

organizationsRouter.get("/current", requireOrganization, (req, res) => {
  return res.json({ success: true, organization: req.organization });
});

organizationsRouter.get("/current/usage", requireOrganization, async (req, res, next) => { try { return res.json({ success: true, ...(await getOrganizationUsage(req.organization!.id)) }); } catch (error) { return next(error); } });

organizationsRouter.get("/current/permissions", requireOrganization, requireOrganizationRole("owner", "admin"), (_req, res) => {
  return res.json({ success: true, canManageMembers: true, canManageBilling: true });
});
