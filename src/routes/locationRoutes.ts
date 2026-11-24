import { Router, type Request, type Response } from "express";
import { locationActor } from "../middlewares/locationAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { locationSchemas, type LocationReportBody } from "../schemas/locationSchemas";
import { locationService, type LocationActor } from "../services/locationService";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";

export const locationRoutes = Router();

locationRoutes.post(
  "/consent",
  locationActor,
  validateRequest({ body: locationSchemas.consent }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as { granted: boolean; policy_version: string };
    const actor = res.locals.locationActor as LocationActor;
    sendSuccess(res, await locationService.setConsent(actor, body.granted, body.policy_version, req.headers["user-agent"]));
  })
);

locationRoutes.post(
  "/",
  locationActor,
  validateRequest({ body: locationSchemas.report }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as LocationReportBody;
    const actor = res.locals.locationActor as LocationActor;
    sendSuccess(res, await locationService.report(actor, body));
  })
);

locationRoutes.delete(
  "/",
  locationActor,
  asyncHandler(async (_req: Request, res: Response) => {
    const actor = res.locals.locationActor as LocationActor;
    await locationService.clear(actor);
    sendSuccess(res, { cleared: true });
  })
);
