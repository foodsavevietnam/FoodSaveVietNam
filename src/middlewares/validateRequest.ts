import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

interface ValidationSchema {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export const validateRequest = (schema: ValidationSchema): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const validated = {
      ...(schema.body ? { body: schema.body.parse(req.body) } : {}),
      ...(schema.query ? { query: schema.query.parse(req.query) } : {}),
      ...(schema.params ? { params: schema.params.parse(req.params) } : {})
    };

    req.validated = validated;
    next();
  };
};
