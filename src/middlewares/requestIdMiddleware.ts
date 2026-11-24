import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../utils/logger";
import { runWithRequestId } from "../utils/requestIdStore";

const VALID_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const resolveRequestId = (headerValue: string | string[] | undefined): string => {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const candidate = typeof raw === "string" ? raw.trim() : "";
  if (candidate && VALID_REQUEST_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return crypto.randomUUID();
};

const extractSafePath = (rawUrl: string | undefined): string => {
  if (!rawUrl) return "/";
  const queryIndex = rawUrl.indexOf("?");
  const clean = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;
  return clean || "/";
};

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const requestId = resolveRequestId(req.headers["x-request-id"]);
  const startNs = process.hrtime.bigint();
  const safePath = extractSafePath(req.originalUrl || req.url || req.path);

  res.setHeader("X-Request-Id", requestId);
  if (res.locals) {
    res.locals.requestId = requestId;
  }

  runWithRequestId(requestId, () => {
    if (typeof res.on === "function") {
      res.on("finish", () => {
        const durationMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - startNs) / 1_000_000));
        runWithRequestId(requestId, () => {
          logger.info("HTTP request completed", {
            method: req.method,
            path: safePath,
            status: res.statusCode,
            duration_ms: durationMs
          });
        });
      });
    }
    next();
  });
};
