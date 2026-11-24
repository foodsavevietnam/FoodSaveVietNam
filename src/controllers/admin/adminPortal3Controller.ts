import type { Request, Response } from "express";
import {
  adminPortal3Service,
  type AdminOrderActionStatus,
  type ListAdminDonationsQuery,
  type ListAdminOrdersQuery,
  type ListAdminPaymentsQuery,
  type ListAdminProductsQuery,
  type ListAdminReviewsQuery
} from "../../services/adminPortal3Service";
import { auditActor } from "../../utils/requestContext";
import { sendSuccess } from "../../utils/response";

export const adminPortal3Controller = {
  async listOrders(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListAdminOrdersQuery;
    sendSuccess(res, await adminPortal3Service.listOrders(query));
  },

  async getOrder(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    sendSuccess(res, await adminPortal3Service.getOrderDetail(id, auditActor(req)));
  },

  async updateOrderStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const body = req.validated?.body as { status: AdminOrderActionStatus; reason: string };
    sendSuccess(res, await adminPortal3Service.updateOrderStatus(id, body, auditActor(req)));
  },

  async addOrderNote(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const { note } = req.validated?.body as { note: string };
    sendSuccess(res, await adminPortal3Service.addOrderNote(id, note, auditActor(req)));
  },

  async listDonations(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListAdminDonationsQuery;
    sendSuccess(res, await adminPortal3Service.listDonations(query));
  },

  async getDonation(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    sendSuccess(res, await adminPortal3Service.getDonationDetail(id));
  },

  async cancelDonation(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const { reason } = req.validated?.body as { reason: string };
    sendSuccess(res, await adminPortal3Service.cancelDonation(id, reason, auditActor(req)));
  },

  async listProducts(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListAdminProductsQuery;
    sendSuccess(res, await adminPortal3Service.listProducts(query));
  },

  async getProduct(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    sendSuccess(res, await adminPortal3Service.getProductDetail(id));
  },

  async updateProductVisibility(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const body = req.validated?.body as { action: "hide" | "unhide"; reason?: string | undefined };
    sendSuccess(res, await adminPortal3Service.updateProductVisibility(id, body, auditActor(req)));
  },

  async listPayments(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListAdminPaymentsQuery;
    sendSuccess(res, await adminPortal3Service.listPayments(query));
  },

  async getPaymentsSummary(req: Request, res: Response): Promise<void> {
    const query = (req.validated?.query ?? {}) as { from?: string | undefined; to?: string | undefined };
    sendSuccess(res, await adminPortal3Service.getPaymentsSummary(query));
  },

  async listReviews(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListAdminReviewsQuery;
    sendSuccess(res, await adminPortal3Service.listReviews(query));
  },

  async updateReviewVisibility(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const body = req.validated?.body as { action: "hide" | "unhide"; reason?: string | undefined };
    sendSuccess(res, await adminPortal3Service.updateReviewVisibility(id, body, auditActor(req)));
  }
};
