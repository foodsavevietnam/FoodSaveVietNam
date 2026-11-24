import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import {
  COMPLAINT_STORE_RESPONSE_HOURS,
  COMPLAINT_WINDOW_COOKED_HOURS,
  COMPLAINT_WINDOW_OTHER_HOURS,
  CUSTOMER_REPUTATION,
  currentPolicy
} from "../constants/orderPolicy";
import type {
  CreateProductBody,
  CreateStoreBody,
  CreateVoucherBody,
  ProductListQuery,
  StoreListQuery,
  UpdateProductBody,
  UpdateStoreBody,
  VoucherListQuery
} from "../schemas/catalogSchemas";
import { catalogService } from "../services/catalogService";
import { policyConfigService } from "../services/policyConfigService";
import { recordActivityBestEffort } from "../neon/activityService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

interface PublicCacheOptions {
  maxAge: number;
  sMaxAge: number;
  staleWhileRevalidate: number;
}

const CATALOG_PUBLIC_CACHE: PublicCacheOptions = {
  maxAge: 15,
  sMaxAge: 30,
  staleWhileRevalidate: 60
};

const POLICY_PUBLIC_CACHE: PublicCacheOptions = {
  maxAge: 60,
  sMaxAge: 300,
  staleWhileRevalidate: 600
};

export const applyPublicCacheHeaders = (req: Request, res: Response, options: PublicCacheOptions): void => {
  if (!req.headers.authorization) {
    res.setHeader(
      "Cache-Control",
      `public, max-age=${options.maxAge}, s-maxage=${options.sMaxAge}, stale-while-revalidate=${options.staleWhileRevalidate}`
    );
    res.setHeader(
      "Netlify-CDN-Cache-Control",
      `public, durable, s-maxage=${options.sMaxAge}, stale-while-revalidate=${options.staleWhileRevalidate}`
    );
    res.setHeader("Vary", "Authorization");
    return;
  }

  res.setHeader("Cache-Control", "no-store, private");
};

export const catalogController = {
  async getPolicy(req: Request, res: Response): Promise<void> {
    await policyConfigService.ensureFresh();
    const policy = currentPolicy();
    applyPublicCacheHeaders(req, res, POLICY_PUBLIC_CACHE);
    sendSuccess(res, {
      labels: {
        green: { pay_minutes: policy.labels.green.payMinutes, pickup_minutes: policy.labels.green.pickupMinutes, cancel_free_before_pickup_minutes: policy.labels.green.cancelFreeBeforePickupMinutes },
        yellow: { pay_minutes: policy.labels.yellow.payMinutes, pickup_minutes: policy.labels.yellow.pickupMinutes, cancel_free_before_pickup_minutes: policy.labels.yellow.cancelFreeBeforePickupMinutes },
        red: { pay_minutes: policy.labels.red.payMinutes, pickup_minutes: policy.labels.red.pickupMinutes, cancel_free_before_pickup_minutes: policy.labels.red.cancelFreeBeforePickupMinutes }
      },
      grace_cancel_minutes: policy.grace_cancel_minutes,
      no_show_ban_count: policy.no_show_ban_count,
      no_show_window_days: policy.no_show_window_days,
      red_ban_days: policy.red_ban_days,
      complaint: {
        window_hours_cooked: COMPLAINT_WINDOW_COOKED_HOURS,
        window_hours_other: COMPLAINT_WINDOW_OTHER_HOURS,
        store_response_hours: COMPLAINT_STORE_RESPONSE_HOURS
      },
      reputation: {
        initial: CUSTOMER_REPUTATION.initialScore,
        pickup_success: CUSTOMER_REPUTATION.pickupSuccessDelta,
        no_show: CUSTOMER_REPUTATION.noShowDelta,
        late_cancel: CUSTOMER_REPUTATION.lateCancelDelta,
        false_complaint: CUSTOMER_REPUTATION.falseComplaintDelta,
        blocked_below: CUSTOMER_REPUTATION.blockedBelow
      }
    });
  },

  async listProducts(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ProductListQuery;
    const products = await catalogService.listProducts(query);
    applyPublicCacheHeaders(req, res, CATALOG_PUBLIC_CACHE);
    sendSuccess(res, products);
  },

  async getProduct(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as UuidParams;
    const product = await catalogService.getProduct(params.id);
    applyPublicCacheHeaders(req, res, CATALOG_PUBLIC_CACHE);
    sendSuccess(res, product);
  },

  async listStores(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as StoreListQuery;
    const stores = await catalogService.listStores(query);
    applyPublicCacheHeaders(req, res, CATALOG_PUBLIC_CACHE);
    sendSuccess(res, stores);
  },

  async getStore(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as UuidParams;
    const store = await catalogService.getStore(params.id);
    applyPublicCacheHeaders(req, res, CATALOG_PUBLIC_CACHE);
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
  },

  async createProduct(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateProductBody;
    const product = await catalogService.createProduct(actor.userId, actor.role, body);
    await recordActivityBestEffort("product_created", product.id);
    sendSuccess(res, product, HTTP_STATUS.CREATED);
  },

  async updateProduct(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateProductBody;
    const product = await catalogService.updateProduct(actor.userId, actor.role, params.id, body);
    sendSuccess(res, product);
  },

  async deleteProduct(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    await catalogService.deleteProduct(actor.userId, actor.role, params.id);
    sendSuccess(res, { deleted: true });
  },

  async listVouchers(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as VoucherListQuery;
    const vouchers = await catalogService.listVouchers(query);
    applyPublicCacheHeaders(req, res, CATALOG_PUBLIC_CACHE);
    sendSuccess(res, vouchers);
  },

  async createVoucher(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateVoucherBody;
    const voucher = await catalogService.createVoucher(actor.userId, actor.role, body);
    sendSuccess(res, voucher, HTTP_STATUS.CREATED);
  }
};
