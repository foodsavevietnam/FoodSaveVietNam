import { Router } from "express";
import { z } from "zod";
import { adminPortal2Controller } from "../../controllers/admin/adminPortal2Controller";
import { validateRequest } from "../../middlewares/validateRequest";
import { adminListQuerySchema } from "../../schemas/adminSchemas";
import { queryBooleanSchema, uuidParamSchema } from "../../schemas/commonSchemas";
import { asyncHandler } from "../../utils/asyncHandler";

const accountsQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "points.desc", "points.asc", "full_name.asc", "full_name.desc", "last_login_at.desc"] as const,
  statusEnum: z.enum(["active", "pending", "suspended", "rejected"]),
  extra: {
    role: z.enum(["customer", "partner", "charity", "admin"]).optional(),
    red_banned: queryBooleanSchema.optional()
  }
});

const storesQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "rating.desc", "rating.asc", "name.asc", "name.desc"] as const,
  statusEnum: z.enum(["active", "pending", "suspended", "rejected"])
});

const storeProductsQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "expires_at.asc", "expires_at.desc", "price_cents.asc", "price_cents.desc", "stock_quantity.desc"] as const
});

const charitiesQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "name.asc", "name.desc", "beneficiaries_count.desc"] as const,
  statusEnum: z.enum(["active", "pending", "suspended", "rejected"])
});

const volunteersQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "full_name.asc", "runs.desc", "kg_collected.desc"] as const,
  statusEnum: z.enum(["new", "active", "inactive"]),
  extra: {
    charity_id: z.string().uuid().optional()
  }
});

const activeSuspendedBodySchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().max(500).optional()
}).strict();

const volunteerStatusBodySchema = z.object({
  status: z.enum(["active", "inactive"]),
  reason: z.string().trim().max(500).optional()
}).strict();

const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Nhập ít nhất 2 ký tự").max(80)
}).strict();

// Các route của cổng quản trị mới; router này được mount sau requireRoles("admin") trong adminRoutes.ts.
export const adminPortalRoutes = Router();

// Accounts (360°)
adminPortalRoutes.get("/accounts", validateRequest({ query: accountsQuerySchema }), asyncHandler(adminPortal2Controller.listAccounts));
adminPortalRoutes.get("/accounts/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(adminPortal2Controller.getAccount));
adminPortalRoutes.post(
  "/accounts/:id/status",
  validateRequest({ params: uuidParamSchema, body: activeSuspendedBodySchema }),
  asyncHandler(adminPortal2Controller.updateAccountStatus)
);

// Stores (360°)
adminPortalRoutes.get("/stores", validateRequest({ query: storesQuerySchema }), asyncHandler(adminPortal2Controller.listStores));
adminPortalRoutes.get("/stores/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(adminPortal2Controller.getStore));
adminPortalRoutes.get(
  "/stores/:id/products",
  validateRequest({ params: uuidParamSchema, query: storeProductsQuerySchema }),
  asyncHandler(adminPortal2Controller.listStoreProducts)
);
adminPortalRoutes.post(
  "/stores/:id/status",
  validateRequest({ params: uuidParamSchema, body: activeSuspendedBodySchema }),
  asyncHandler(adminPortal2Controller.updateStoreStatus)
);

// Charities & Volunteers (360°)
adminPortalRoutes.get("/charities", validateRequest({ query: charitiesQuerySchema }), asyncHandler(adminPortal2Controller.listCharities));
adminPortalRoutes.get("/charities/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(adminPortal2Controller.getCharity));
adminPortalRoutes.post(
  "/charities/:id/status",
  validateRequest({ params: uuidParamSchema, body: activeSuspendedBodySchema }),
  asyncHandler(adminPortal2Controller.updateCharityStatus)
);

adminPortalRoutes.get("/volunteers", validateRequest({ query: volunteersQuerySchema }), asyncHandler(adminPortal2Controller.listVolunteers));
adminPortalRoutes.get("/volunteers/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(adminPortal2Controller.getVolunteer));
adminPortalRoutes.post(
  "/volunteers/:id/status",
  validateRequest({ params: uuidParamSchema, body: volunteerStatusBodySchema }),
  asyncHandler(adminPortal2Controller.updateVolunteerStatus)
);

// Global Search
adminPortalRoutes.get("/search", validateRequest({ query: searchQuerySchema }), asyncHandler(adminPortal2Controller.globalSearch));
