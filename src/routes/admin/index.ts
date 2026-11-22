import { Router } from "express";

// Các route của cổng quản trị mới. Các đợt sau gắn route vào đây; router này được mount sau requireRoles("admin").
export const adminPortalRoutes = Router();
