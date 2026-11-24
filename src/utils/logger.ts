import { env } from "../config/env";
import { getRequestId } from "./requestIdStore";

type LogLevel = "debug" | "info" | "warn" | "error";

const REDACTED = "[REDACTED]";
const MAX_REDACT_DEPTH = 8;

const levelRank: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const SENSITIVE_KEY_PATTERN = /(password|passwd|token|secret|authorization|cookie|accountnumber|cccd|apikey|privatekey)/i;

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(normalized);
};

export const redactString = (value: string): string => {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/([?&](?:token|access_token|refresh_token|api_key|apikey|secret|password)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/((?:postgres(?:ql)?|rediss?|https?):\/\/[^:\s/@]+:)([^@\s/]+)@/gi, `$1${REDACTED}@`);
};

export const redactValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return `[${typeof value}]`;

  if (depth >= MAX_REDACT_DEPTH) return "[Truncated]";

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    const errRecord = value as Error & { code?: unknown; statusCode?: unknown };
    const safeErr: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message)
    };
    if (errRecord.code !== undefined) safeErr.code = redactValue(errRecord.code, depth + 1, seen);
    if (errRecord.statusCode !== undefined) safeErr.statusCode = errRecord.statusCode;
    if (value.stack) safeErr.stack = redactString(value.stack);
    return safeErr;
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, depth + 1, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = redactValue(entry, depth + 1, seen);
      }
    }
    return output;
  }

  return String(value);
};

const shouldLog = (level: LogLevel): boolean => levelRank[level] >= levelRank[env.LOG_LEVEL];

const shouldUseJsonFormat = (): boolean => {
  if (env.LOG_FORMAT === "json") return true;
  if (env.LOG_FORMAT === "text") return false;
  return env.NODE_ENV === "production";
};

const writeLog = (level: LogLevel, message: string, meta?: unknown): void => {
  if (!shouldLog(level)) return;

  const sink =
    level === "debug"
      ? console.debug
      : level === "info"
        ? console.info
        : level === "warn"
          ? console.warn
          : console.error;

  const requestId = getRequestId() ?? null;
  const safeMessage = redactString(String(message));
  const safeMeta = meta !== undefined ? redactValue(meta) : undefined;

  if (shouldUseJsonFormat()) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message: safeMessage,
      request_id: requestId,
      meta: safeMeta ?? null
    });
    sink(line);
    return;
  }

  const reqPrefix = requestId ? ` [req:${requestId}]` : "";
  if (safeMeta !== undefined) {
    sink(`[${level.toUpperCase()}]${reqPrefix} ${safeMessage}`, safeMeta);
  } else {
    sink(`[${level.toUpperCase()}]${reqPrefix} ${safeMessage}`);
  }
};

export const logger = {
  debug(message: string, meta?: unknown): void {
    writeLog("debug", message, meta);
  },
  info(message: string, meta?: unknown): void {
    writeLog("info", message, meta);
  },
  warn(message: string, meta?: unknown): void {
    writeLog("warn", message, meta);
  },
  error(message: string, meta?: unknown): void {
    writeLog("error", message, meta);
  }
};
