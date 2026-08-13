import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type { CreateStoreBody, StoreListQuery, UpdateStoreBody } from "../schemas/catalogSchemas";
import { catalogService } from "../services/catalogService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const catalogController = {
  async listStores(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as StoreListQuery;
    const stores = await catalogService.listStores(query);
    sendSuccess(res, stores);
  },

  async getStore(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as UuidParams;
    const store = await catalogService.getStore(params.id);
    sendSuccess(res, store);
  },

  async createStore(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateStoreBody;
    const store = await catalogService.createStore(actor.userId, body);
    sendSuccess(res, store, HTTP_STATUS.CREATED);
  },

  async updateStore(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateStoreBody;
    const store = await catalogService.updateStore(actor.userId, actor.role, params.id, body);
    sendSuccess(res, store);
  }
};
