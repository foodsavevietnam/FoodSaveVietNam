import { Router } from "express";
import { supportController } from "../controllers/supportController";
import { optionalAuthMiddleware } from "../middlewares/authMiddleware";
import { authRateLimiter } from "../middlewares/rateLimiter";
import { validateRequest } from "../middlewares/validateRequest";
import { createApplicationBodySchema, createContactMessageBodySchema } from "../schemas/supportSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const supportRoutes = Router();

supportRoutes.post("/contact", authRateLimiter, optionalAuthMiddleware, validateRequest({ body: createContactMessageBodySchema }), asyncHandler(supportController.createContactMessage));
supportRoutes.post("/applications", authRateLimiter, optionalAuthMiddleware, validateRequest({ body: createApplicationBodySchema }), asyncHandler(supportController.createApplication));
