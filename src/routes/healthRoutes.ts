import { Router } from "express";
import { healthController } from "../controllers/healthController";

export const healthRoutes = Router();

healthRoutes.get("/", healthController.getHealth);
healthRoutes.get("/ready", (req, res) => {
  void healthController.getReady(req, res);
});
