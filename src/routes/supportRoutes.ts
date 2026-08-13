import { Router } from "express";
import { supportController } from "../controllers/supportController";
import { validateRequest } from "../middlewares/validateRequest";
import { createContactMessageBodySchema } from "../schemas/supportSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const supportRoutes = Router();

supportRoutes.post("/contact", validateRequest({ body: createContactMessageBodySchema }), asyncHandler(supportController.createContactMessage));
