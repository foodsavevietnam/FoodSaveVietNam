import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type { CreateContactMessageBody } from "../schemas/supportSchemas";
import { supportService } from "../services/supportService";
import { sendSuccess } from "../utils/response";

export const supportController = {
  async createContactMessage(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as CreateContactMessageBody;
    const message = await supportService.createContactMessage(req.user?.id ?? null, body);
    sendSuccess(res, message, HTTP_STATUS.CREATED);
  }
};
