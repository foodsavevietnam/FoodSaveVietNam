import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { ERROR_CODES } from "../../constants/errors";
import { HTTP_STATUS } from "../../constants/http";
import { adminPortal4Controller } from "../../controllers/admin/adminPortal4Controller";
import { resolveApiRateLimitKey } from "../../middlewares/rateLimiter";
import { validateRequest } from "../../middlewares/validateRequest";
import { adminListQuerySchema } from "../../schemas/adminSchemas";
import { uuidParamSchema } from "../../schemas/commonSchemas";
import { asyncHandler } from "../../utils/asyncHandler";

// Giới hạn tốc độ gửi thông báo từ cổng Admin: tối đa 10 lượt / 10 phút mỗi quản trị viên.
export const adminNotifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: resolveApiRateLimitKey,
  message: {
    success: false,
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message: "Gửi thông báo quá nhanh. Vui lòng thử lại sau ít phút."
    }
  },
  statusCode: HTTP_STATUS.TOO_MANY_REQUESTS
});

const createAdminBodySchema = z.object({
  email: z.string().trim().email().max(160),
  full_name: z.string().trim().min(2).max(120),
  password: z.string().min(10).max(128)
}).strict();

const grantAdminBodySchema = z.object({
  identifier: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(3).max(500)
}).strict();

const adminStatusBodySchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().max(500).optional()
}).strict();

const revokeAdminBodySchema = z.object({
  reason: z.string().trim().min(3).max(500)
}).strict();

const sendNotificationBodySchema = z.object({
  target: z.enum(["role", "user", "users"]),
  role: z.enum(["customer", "partner", "charity"]).optional(),
  user_id: z.string().uuid().optional(),
  user_ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  title: z.string().trim().min(2).max(140),
  body: z.string().trim().min(2).max(1000),
  push: z.boolean().optional()
}).strict();

const notificationsQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc"] as const
});

const contactMessagesQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "updated_at.desc"] as const,
  statusEnum: z.enum(["open", "in_review", "in_progress", "resolved", "closed"])
});

const updateContactMessageBodySchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  admin_note: z.string().trim().max(1000).optional()
}).strict();

const applicationsQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "updated_at.desc"] as const,
  statusEnum: z.enum(["pending", "in_review", "approved", "rejected", "resolved"]),
  extra: {
    type: z.enum(["partner", "charity"]).optional()
  }
});

const updateApplicationBodySchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  admin_note: z.string().trim().max(1000).optional()
}).strict();

const settingKeyParamSchema = z.object({
  key: z.string().trim().min(1).max(80)
}).strict();

const updateSettingBodySchema = z.object({
  value: z.unknown()
}).strict();

const dashboardOverviewQuerySchema = z.object({
  days: z.enum(["7", "30"]).default("7")
}).strict();

// Đợt 4 Admin Portal system routes (admins, notifications, support, settings, dashboard overview).
export const adminSystemPortalRoutes = Router();

// A. Admins Management
adminSystemPortalRoutes.get("/admins", asyncHandler(adminPortal4Controller.listAdmins));
adminSystemPortalRoutes.post(
  "/admins",
  validateRequest({ body: createAdminBodySchema }),
  asyncHandler(adminPortal4Controller.createAdmin)
);
adminSystemPortalRoutes.post(
  "/admins/grant",
  validateRequest({ body: grantAdminBodySchema }),
  asyncHandler(adminPortal4Controller.grantAdmin)
);
adminSystemPortalRoutes.post(
  "/admins/:id/status",
  validateRequest({ params: uuidParamSchema, body: adminStatusBodySchema }),
  asyncHandler(adminPortal4Controller.updateAdminStatus)
);
adminSystemPortalRoutes.post(
  "/admins/:id/revoke",
  validateRequest({ params: uuidParamSchema, body: revokeAdminBodySchema }),
  asyncHandler(adminPortal4Controller.revokeAdmin)
);

// B. Broadcast Notifications
adminSystemPortalRoutes.post(
  "/notifications",
  adminNotifyLimiter,
  validateRequest({ body: sendNotificationBodySchema }),
  asyncHandler(adminPortal4Controller.sendNotification)
);
adminSystemPortalRoutes.get(
  "/notifications",
  validateRequest({ query: notificationsQuerySchema }),
  asyncHandler(adminPortal4Controller.listNotifications)
);
adminSystemPortalRoutes.get("/notifications/stats", asyncHandler(adminPortal4Controller.notificationStats));

// C. Support Inbox
adminSystemPortalRoutes.get(
  "/contact-messages",
  validateRequest({ query: contactMessagesQuerySchema }),
  asyncHandler(adminPortal4Controller.listContactMessages)
);
adminSystemPortalRoutes.patch(
  "/contact-messages/:id",
  validateRequest({ params: uuidParamSchema, body: updateContactMessageBodySchema }),
  asyncHandler(adminPortal4Controller.updateContactMessage)
);
adminSystemPortalRoutes.get(
  "/applications",
  validateRequest({ query: applicationsQuerySchema }),
  asyncHandler(adminPortal4Controller.listApplications)
);
adminSystemPortalRoutes.patch(
  "/applications/:id",
  validateRequest({ params: uuidParamSchema, body: updateApplicationBodySchema }),
  asyncHandler(adminPortal4Controller.updateApplication)
);

// D. System Settings & Dashboard Overview
adminSystemPortalRoutes.get("/settings", asyncHandler(adminPortal4Controller.listSettings));
adminSystemPortalRoutes.put(
  "/settings/:key",
  validateRequest({ params: settingKeyParamSchema, body: updateSettingBodySchema }),
  asyncHandler(adminPortal4Controller.updateSetting)
);
adminSystemPortalRoutes.get(
  "/dashboard/overview",
  validateRequest({ query: dashboardOverviewQuerySchema }),
  asyncHandler(adminPortal4Controller.dashboardOverview)
);
