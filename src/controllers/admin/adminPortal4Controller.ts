import type { Request, Response } from "express";
import {
  adminPortal4Service,
  type CreateAdminInput,
  type GrantAdminInput,
  type ListAdminNotificationsQuery,
  type ListApplicationsQuery,
  type ListContactMessagesQuery,
  type SendAdminNotificationInput,
  type UpdateSupportItemInput
} from "../../services/adminPortal4Service";
import { adminSettingsService } from "../../services/adminSettingsService";
import { auditActor } from "../../utils/requestContext";
import { sendSuccess } from "../../utils/response";

export const adminPortal4Controller = {
  /* ─── A. Admins Management ─── */
  async listAdmins(_req: Request, res: Response): Promise<void> {
    sendSuccess(res, await adminPortal4Service.listAdmins());
  },

  async createAdmin(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as CreateAdminInput;
    sendSuccess(res, await adminPortal4Service.createAdmin(body, auditActor(req)), 201);
  },

  async grantAdmin(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as GrantAdminInput;
    sendSuccess(res, await adminPortal4Service.grantAdmin(body, auditActor(req)));
  },

  async updateAdminStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const { status, reason } = req.validated?.body as { status: "active" | "suspended"; reason?: string | undefined };
    sendSuccess(res, await adminPortal4Service.updateAdminStatus(id, status, reason, auditActor(req)));
  },

  async revokeAdmin(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const { reason } = req.validated?.body as { reason: string };
    sendSuccess(res, await adminPortal4Service.revokeAdmin(id, reason, auditActor(req)));
  },

  /* ─── B. Broadcast Notifications ─── */
  async sendNotification(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as SendAdminNotificationInput;
    sendSuccess(res, await adminPortal4Service.sendAdminNotification(body, auditActor(req)));
  },

  async listNotifications(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListAdminNotificationsQuery;
    sendSuccess(res, await adminPortal4Service.listAdminNotifications(query));
  },

  async notificationStats(_req: Request, res: Response): Promise<void> {
    sendSuccess(res, await adminPortal4Service.getNotificationStats());
  },

  /* ─── C. Support Inbox ─── */
  async listContactMessages(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListContactMessagesQuery;
    sendSuccess(res, await adminPortal4Service.listContactMessages(query));
  },

  async updateContactMessage(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const body = req.validated?.body as UpdateSupportItemInput;
    sendSuccess(res, await adminPortal4Service.updateContactMessage(id, body, auditActor(req)));
  },

  async listApplications(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListApplicationsQuery;
    sendSuccess(res, await adminPortal4Service.listApplications(query));
  },

  async updateApplication(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const body = req.validated?.body as UpdateSupportItemInput;
    sendSuccess(res, await adminPortal4Service.updateApplication(id, body, auditActor(req)));
  },

  /* ─── D. System Settings & Dashboard Overview ─── */
  async listSettings(_req: Request, res: Response): Promise<void> {
    sendSuccess(res, { items: await adminSettingsService.listManagedSettings() });
  },

  async updateSetting(req: Request, res: Response): Promise<void> {
    const { key } = req.validated?.params as { key: string };
    const body = req.validated?.body as { value: unknown };
    const item = await adminSettingsService.updateManagedSetting(key, body.value, auditActor(req));
    sendSuccess(res, { item });
  },

  async dashboardOverview(req: Request, res: Response): Promise<void> {
    const { days } = req.validated?.query as { days: "7" | "30" };
    sendSuccess(res, await adminPortal4Service.getDashboardOverview(Number(days)));
  }
};
