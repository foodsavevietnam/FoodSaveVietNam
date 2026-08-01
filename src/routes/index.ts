import { Router } from "express";
import { adminRoutes } from "./adminRoutes";
import { authMiddleware } from "../middlewares/authMiddleware";
import { authRoutes } from "./authRoutes";
import { catalogRoutes } from "./catalogRoutes";
import { charityRoutes } from "./charityRoutes";
import { donationRoutes } from "./donationRoutes";
import { ecoImpactRoutes } from "./ecoImpactRoutes";
import { healthRoutes } from "./healthRoutes";
import { notificationRoutes } from "./notificationRoutes";
import { partnerRoutes } from "./partnerRoutes";
import { profileRoutes } from "./profileRoutes";
import { sellerReputationRoutes } from "./sellerReputationRoutes";
import { supportRoutes } from "./supportRoutes";

export const apiRoutes = Router();

apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/catalog", catalogRoutes);
apiRoutes.use("/support", supportRoutes);

apiRoutes.use("/profile", authMiddleware, profileRoutes);
apiRoutes.use("/donations", authMiddleware, donationRoutes);
apiRoutes.use("/eco-impact", authMiddleware, ecoImpactRoutes);
apiRoutes.use("/charity", charityRoutes);
apiRoutes.use("/notifications", authMiddleware, notificationRoutes);
apiRoutes.use("/partner", authMiddleware, partnerRoutes);
apiRoutes.use("/seller-reputation", authMiddleware, sellerReputationRoutes);
apiRoutes.use("/admin", authMiddleware, adminRoutes);
