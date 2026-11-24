import type { Request } from "express";
import rateLimit, { type IncrementResponse, type Options, type Store } from "express-rate-limit";
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { verifyVolunteerToken } from "../utils/volunteerToken";

const UPSTASH_TIMEOUT_MS = 1500;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX_REQUESTS = 15;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UpstashPipelineEntry {
  result?: unknown;
  error?: string;
}

export interface UpstashRestStoreOptions {
  url: string;
  token: string;
  prefix: string;
  timeoutMs?: number;
}

/**
 * Lightweight Upstash Redis REST store for express-rate-limit.
 * Uses /pipeline (INCR + PEXPIRE + PTTL) with a strict 1500ms timeout so serverless
 * cold starts stay fast and never block requests when passOnStoreError is enabled.
 */
export class UpstashRestRateLimitStore implements Store {
  public readonly localKeys = false;
  public readonly prefix: string;
  private readonly pipelineUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private windowMs = 60_000;

  constructor(options: UpstashRestStoreOptions) {
    this.pipelineUrl = `${options.url.replace(/\/+$/, "")}/pipeline`;
    this.token = options.token;
    this.prefix = options.prefix;
    this.timeoutMs = options.timeoutMs ?? UPSTASH_TIMEOUT_MS;
  }

  public init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private async executePipeline(commands: Array<Array<string | number>>): Promise<UpstashPipelineEntry[]> {
    const response = await fetch(this.pipelineUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Upstash Redis REST returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("Upstash Redis REST returned an unexpected pipeline payload");
    }

    return payload as UpstashPipelineEntry[];
  }

  public async increment(key: string): Promise<IncrementResponse> {
    const redisKey = this.fullKey(key);
    const results = await this.executePipeline([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(this.windowMs), "NX"],
      ["PTTL", redisKey]
    ]);

    const incrEntry = results[0];
    if (!incrEntry || incrEntry.error) {
      throw new Error(incrEntry?.error ?? "Upstash INCR failed");
    }

    const totalHits = Number(incrEntry.result);
    if (!Number.isInteger(totalHits) || totalHits < 1) {
      throw new Error(`Invalid hit counter returned by Upstash: ${String(incrEntry.result)}`);
    }

    const expireEntry = results[1];
    const pttlEntry = results[2];
    const pttl = Number(pttlEntry?.result);

    // Fallback for Redis servers that do not support PEXPIRE ... NX or lost TTL
    if ((expireEntry?.error || !Number.isFinite(pttl) || pttl < 0) && totalHits === 1) {
      await this.executePipeline([["PEXPIRE", redisKey, String(this.windowMs)]]);
    }

    const ttlMs = Number.isFinite(pttl) && pttl > 0 ? pttl : this.windowMs;
    return {
      totalHits,
      resetTime: new Date(Date.now() + ttlMs)
    };
  }

  public async decrement(key: string): Promise<void> {
    await this.executePipeline([["DECR", this.fullKey(key)]]);
  }

  public async resetKey(key: string): Promise<void> {
    await this.executePipeline([["DEL", this.fullKey(key)]]);
  }
}

const createStore = (prefix: string): Store | undefined => {
  if (env.RATE_LIMIT_REDIS_URL && env.RATE_LIMIT_REDIS_TOKEN) {
    return new UpstashRestRateLimitStore({
      url: env.RATE_LIMIT_REDIS_URL,
      token: env.RATE_LIMIT_REDIS_TOKEN,
      prefix,
      timeoutMs: UPSTASH_TIMEOUT_MS
    });
  }
  return undefined;
};

const extractTokenIdentity = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  // 1) Volunteer HMAC token (verified synchronously)
  const volunteerPayload = verifyVolunteerToken(token);
  if (volunteerPayload?.vid) {
    return `volunteer:${volunteerPayload.vid}`;
  }

  // 2) Supabase JWT payload sub extraction (reduces shared-WiFi false positives)
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const sub = typeof decoded.sub === "string" ? decoded.sub.trim() : "";
    if (!UUID_REGEX.test(sub)) return null;

    const exp = decoded.exp;
    if (typeof exp === "number" && exp <= Math.floor(Date.now() / 1000)) return null;

    const iss = typeof decoded.iss === "string" ? decoded.iss : "";
    const expectedIssuerPrefix = env.SUPABASE_URL.replace(/\/+$/, "");
    if (iss && expectedIssuerPrefix && !iss.startsWith(expectedIssuerPrefix)) return null;

    return `user:${sub}`;
  } catch {
    return null;
  }
};

export const resolveApiRateLimitKey = (req: Request): string => {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  const tokenIdentity = extractTokenIdentity(req.headers.authorization);
  if (tokenIdentity) {
    return tokenIdentity;
  }
  return `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
};

const rateLimitMessage = {
  success: false,
  error: {
    code: ERROR_CODES.RATE_LIMITED,
    message: "Too many requests. Please retry later."
  }
};

const apiStore = createStore("mio:rl:api:");
export const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  passOnStoreError: true,
  keyGenerator: resolveApiRateLimitKey,
  ...(apiStore ? { store: apiStore } : {}),
  message: rateLimitMessage,
  statusCode: HTTP_STATUS.TOO_MANY_REQUESTS
});

const authStore = createStore("mio:rl:auth:");
export const authRateLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  limit: AUTH_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  passOnStoreError: true,
  ...(authStore ? { store: authStore } : {}),
  message: rateLimitMessage,
  statusCode: HTTP_STATUS.TOO_MANY_REQUESTS
});
