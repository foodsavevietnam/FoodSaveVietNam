import { Router } from "express";
import { catalogController } from "../controllers/catalogController";
import { authMiddleware, requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { asyncHandler } from "../utils/asyncHandler";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { createStoreBodySchema, storeListQuerySchema, updateStoreBodySchema } from "../schemas/catalogSchemas";

// NOTE: /products and /vouchers routes were removed along with public.products and
// public.vouchers in the 014 migration (no more customer-facing marketplace).
export const catalogRoutes = Router();

catalogRoutes.get("/stores", validateRequest({ query: storeListQuerySchema }), asyncHandler(catalogController.listStores));
catalogRoutes.get("/stores/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(catalogController.getStore));

catalogRoutes.post("/stores", authMiddleware, requireRoles("partner", "admin"), validateRequest({ body: createStoreBodySchema }), asyncHandler(catalogController.createStore));
catalogRoutes.patch("/stores/:id", authMiddleware, requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: updateStoreBodySchema }), asyncHandler(catalogController.updateStore));
