import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { createPublicActivityQuery } from "../neon/realtimeService";
import { listRecentActivities } from "../neon/activityService";

export const activityRoutes = Router();

activityRoutes.get("/", asyncHandler(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  sendSuccess(res, { items: await listRecentActivities() });
}));

activityRoutes.post("/live", asyncHandler(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  sendSuccess(res, await createPublicActivityQuery());
}));
