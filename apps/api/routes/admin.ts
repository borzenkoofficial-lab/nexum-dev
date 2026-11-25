import { Router } from "express";
import { getAuthUser } from "../auth.js";
import { requireAdminPermission } from "../adminAccess.js";

export const adminRouter = Router();

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
    status: "connected",
    generatedAt: new Date().toISOString(),
    metrics: {},
    notice: "Dashboard metrics are not connected yet; no demo values are returned.",
  });
});
