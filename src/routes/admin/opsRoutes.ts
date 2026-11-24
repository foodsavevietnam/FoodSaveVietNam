import { Router } from "express";
import { z } from "zod";
import { adminPortal3Controller } from "../../controllers/admin/adminPortal3Controller";
import { validateRequest } from "../../middlewares/validateRequest";
import { adminListQuerySchema } from "../../schemas/adminSchemas";
import { queryBooleanSchema, uuidParamSchema } from "../../schemas/commonSchemas";
import { asyncHandler } from "../../utils/asyncHandler";

const isoDateFilterSchema = z.string().trim().min(10).max(64).refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
  "Thời gian lọc phải theo định dạng ISO 8601"
);

const ordersQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "total_cents.desc", "total_cents.asc"] as const,
  statusEnum: z.enum(["awaiting_payment", "pending", "confirmed", "ready", "completed", "cancelled", "no_show"]),
  extra: {
    payment_status: z.enum(["pending", "paid", "refunded", "failed"]).optional(),
    settlement_status: z.enum(["none", "held", "released", "forfeited", "refunded", "partially_refunded"]).optional(),
    store_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    from: isoDateFilterSchema.optional(),
    to: isoDateFilterSchema.optional(),
    has_complaint: queryBooleanSchema.optional()
  }
});

const orderStatusBodySchema = z.object({
  status: z.enum(["cancelled", "no_show", "completed"]),
  reason: z.string().trim().min(3).max(500)
}).strict();

const orderNoteBodySchema = z.object({
  note: z.string().trim().min(3).max(1000)
}).strict();

const donationsQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "expires_at.asc"] as const,
  statusEnum: z.enum(["open", "accepted", "in_route", "completed", "rejected", "cancelled"]),
  extra: {
    store_id: z.string().uuid().optional(),
    charity_id: z.string().uuid().optional()
  }
});

const cancelDonationBodySchema = z.object({
  reason: z.string().trim().min(3).max(500)
}).strict();

const productsQuerySchema = adminListQuerySchema({
  sortKeys: [
    "created_at.desc",
    "created_at.asc",
    "expires_at.asc",
    "expires_at.desc",
    "price_cents.asc",
    "price_cents.desc",
    "stock_quantity.desc",
    "stock_quantity.asc"
  ] as const,
  extra: {
    label: z.enum(["green", "yellow", "red"]).optional(),
    store_id: z.string().uuid().optional(),
    visibility: z.enum(["all", "visible", "hidden"]).optional()
  }
});

const visibilityBodySchema = z.object({
  action: z.enum(["hide", "unhide"]),
  reason: z.string().trim().max(500).optional()
}).strict();

const paymentsQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "amount_cents.desc", "amount_cents.asc"] as const,
  statusEnum: z.enum(["received", "processed", "rejected", "ignored", "pending", "paid", "failed", "refunded"]),
  extra: {
    provider: z.string().trim().min(1).max(40).optional(),
    from: isoDateFilterSchema.optional(),
    to: isoDateFilterSchema.optional()
  }
});

const paymentsSummaryQuerySchema = z.object({
  from: isoDateFilterSchema.optional(),
  to: isoDateFilterSchema.optional()
}).strict();

const reviewsQuerySchema = adminListQuerySchema({
  sortKeys: ["created_at.desc", "created_at.asc", "rating.asc", "rating.desc"] as const,
  extra: {
    store_id: z.string().uuid().optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    visibility: z.enum(["all", "visible", "hidden"]).optional()
  }
});

// Đợt 3 Admin Portal operational routes (orders, donations, products, payments, reviews).
export const adminOpsPortalRoutes = Router();

// 1. Orders
adminOpsPortalRoutes.get("/orders", validateRequest({ query: ordersQuerySchema }), asyncHandler(adminPortal3Controller.listOrders));
adminOpsPortalRoutes.get("/orders/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(adminPortal3Controller.getOrder));
adminOpsPortalRoutes.post(
  "/orders/:id/status",
  validateRequest({ params: uuidParamSchema, body: orderStatusBodySchema }),
  asyncHandler(adminPortal3Controller.updateOrderStatus)
);
adminOpsPortalRoutes.post(
  "/orders/:id/note",
  validateRequest({ params: uuidParamSchema, body: orderNoteBodySchema }),
  asyncHandler(adminPortal3Controller.addOrderNote)
);

// 2. Donations
adminOpsPortalRoutes.get("/donations", validateRequest({ query: donationsQuerySchema }), asyncHandler(adminPortal3Controller.listDonations));
adminOpsPortalRoutes.get("/donations/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(adminPortal3Controller.getDonation));
adminOpsPortalRoutes.post(
  "/donations/:id/cancel",
  validateRequest({ params: uuidParamSchema, body: cancelDonationBodySchema }),
  asyncHandler(adminPortal3Controller.cancelDonation)
);

// 3. Products
adminOpsPortalRoutes.get("/products", validateRequest({ query: productsQuerySchema }), asyncHandler(adminPortal3Controller.listProducts));
adminOpsPortalRoutes.get("/products/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(adminPortal3Controller.getProduct));
adminOpsPortalRoutes.post(
  "/products/:id/visibility",
  validateRequest({ params: uuidParamSchema, body: visibilityBodySchema }),
  asyncHandler(adminPortal3Controller.updateProductVisibility)
);

// 4. Payments
adminOpsPortalRoutes.get(
  "/payments/summary",
  validateRequest({ query: paymentsSummaryQuerySchema }),
  asyncHandler(adminPortal3Controller.getPaymentsSummary)
);
adminOpsPortalRoutes.get("/payments", validateRequest({ query: paymentsQuerySchema }), asyncHandler(adminPortal3Controller.listPayments));

// 5. Reviews
adminOpsPortalRoutes.get("/reviews", validateRequest({ query: reviewsQuerySchema }), asyncHandler(adminPortal3Controller.listReviews));
adminOpsPortalRoutes.post(
  "/reviews/:id/visibility",
  validateRequest({ params: uuidParamSchema, body: visibilityBodySchema }),
  asyncHandler(adminPortal3Controller.updateReviewVisibility)
);
