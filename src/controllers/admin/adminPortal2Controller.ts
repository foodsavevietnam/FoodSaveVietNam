import type { Request, Response } from "express";
import {
  adminPortal2Service,
  type ListAccountsQuery,
  type ListCharitiesQuery,
  type ListStoreProductsQuery,
  type ListStoresQuery,
  type ListVolunteersQuery
} from "../../services/adminPortal2Service";
import { auditActor } from "../../utils/requestContext";
import { sendSuccess } from "../../utils/response";

export const adminPortal2Controller = {
  async listAccounts(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListAccountsQuery;
    sendSuccess(res, await adminPortal2Service.listAccounts(query));
  },

  async getAccount(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    sendSuccess(res, await adminPortal2Service.getAccountDetail(id));
  },

  async updateAccountStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const { status, reason } = req.validated?.body as { status: "active" | "suspended"; reason?: string | undefined };
    sendSuccess(res, await adminPortal2Service.updateAccountStatus(id, status, reason, auditActor(req)));
  },

  async listStores(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListStoresQuery;
    sendSuccess(res, await adminPortal2Service.listStores(query));
  },

  async getStore(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    sendSuccess(res, await adminPortal2Service.getStoreDetail(id));
  },

  async listStoreProducts(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const query = req.validated?.query as ListStoreProductsQuery;
    sendSuccess(res, await adminPortal2Service.listStoreProducts(id, query));
  },

  async updateStoreStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const { status, reason } = req.validated?.body as { status: "active" | "suspended"; reason?: string | undefined };
    sendSuccess(res, await adminPortal2Service.updateStoreStatus(id, status, reason, auditActor(req)));
  },

  async listCharities(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListCharitiesQuery;
    sendSuccess(res, await adminPortal2Service.listCharities(query));
  },

  async getCharity(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    sendSuccess(res, await adminPortal2Service.getCharityDetail(id));
  },

  async updateCharityStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const { status, reason } = req.validated?.body as { status: "active" | "suspended"; reason?: string | undefined };
    sendSuccess(res, await adminPortal2Service.updateCharityStatus(id, status, reason, auditActor(req)));
  },

  async listVolunteers(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ListVolunteersQuery;
    sendSuccess(res, await adminPortal2Service.listVolunteers(query));
  },

  async getVolunteer(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    sendSuccess(res, await adminPortal2Service.getVolunteerDetail(id));
  },

  async updateVolunteerStatus(req: Request, res: Response): Promise<void> {
    const { id } = req.validated?.params as { id: string };
    const { status, reason } = req.validated?.body as { status: "active" | "inactive"; reason?: string | undefined };
    sendSuccess(res, await adminPortal2Service.updateVolunteerStatus(id, status, reason, auditActor(req)));
  },

  async globalSearch(req: Request, res: Response): Promise<void> {
    const { q } = req.validated?.query as { q: string };
    sendSuccess(res, await adminPortal2Service.globalSearch(q));
  }
};
