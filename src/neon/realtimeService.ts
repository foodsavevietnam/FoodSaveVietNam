import { AppError } from "../utils/appError";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { ActivityItem } from "./activityService";
import { getNeonDatabaseName } from "./database";

// Node16 module resolution keeps this native ESM import and gives bundlers a
// literal dependency to include in the existing Netlify function.
const importRealtimeSdk = () => import("@neon/realtime/server");
let realtimeSdkPromise: ReturnType<typeof importRealtimeSdk> | undefined;
const loadRealtimeSdk = () => (realtimeSdkPromise ??= importRealtimeSdk());

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      "Neon Realtime is not configured.",
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.INTERNAL_SERVER_ERROR,
    );
  }
  return value;
};

const createRealtimeIssuer = async () => {
  const databaseName = getNeonDatabaseName();
  requireEnv("NEON_REALTIME_URL");
  const secret = requireEnv("NEON_REALTIME_SECRET");
  const sdk = await loadRealtimeSdk();
  return sdk.createRealtime({ secret, db: databaseName });
};

let realtimeIssuerPromise: ReturnType<typeof createRealtimeIssuer> | undefined;
const getRealtimeIssuer = () => (realtimeIssuerPromise ??= createRealtimeIssuer().catch((error: unknown) => {
  realtimeIssuerPromise = undefined;
  throw error;
}));

/** Returns an anonymous sealed query for a fixed, non-sensitive public feed. */
export const createPublicActivityQuery = async (): Promise<{
  url: string;
  sealedQuery: {
    capability: string;
    queryFingerprint: string;
    expiresAt: number;
  };
}> => {
  try {
    const realtime = await getRealtimeIssuer();
    const sdk = await loadRealtimeSdk();
    const query = sdk.rawSql<ActivityItem>(
      `SELECT id::text, event_type, title, created_at
       FROM mio.activity_events
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
    );
    return {
      url: requireEnv("NEON_REALTIME_URL"),
      sealedQuery: await realtime.seal({ query }),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "Unable to prepare the public activity subscription.",
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.INTERNAL_SERVER_ERROR,
    );
  }
};
