import { randomUUID } from "crypto";
import { query } from "./database";

export const ACTIVITY_TYPES = ["product_created", "order_created", "donation_created"] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];

export interface ActivityItem {
  id: string;
  event_type: ActivityType;
  title: string;
  created_at: Date | string;
}

export interface ActivityWriteResult {
  id: string;
  txid: string;
}

const PUBLIC_TITLES: Record<ActivityType, string> = {
  product_created: "Có sản phẩm mới được chia sẻ",
  order_created: "Một đơn hàng mới được tạo",
  donation_created: "Một lô thực phẩm mới được quyên góp",
};

export const recordActivity = async (
  eventType: ActivityType,
  sourceId: string,
): Promise<ActivityWriteResult | null> => {
  if (!(ACTIVITY_TYPES as readonly string[]).includes(eventType)) {
    throw new Error("Unsupported MIO activity event type.");
  }
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId || normalizedSourceId.length > 200) {
    throw new Error("MIO activity source ID is invalid.");
  }

  const result = await query<ActivityWriteResult>(
    `INSERT INTO mio.activity_events (id, event_type, source_id, title)
     VALUES ($1::uuid, $2::text, $3::text, $4::text)
     ON CONFLICT (event_type, source_id) DO NOTHING
     RETURNING id::text, pg_current_xact_id()::text AS txid`,
    [randomUUID(), eventType, normalizedSourceId, PUBLIC_TITLES[eventType]],
  );
  return result.rows[0] ?? null;
};

const isNeonActivityEnabled = (): boolean => {
  try {
    const { env } = require("../config/env") as { env?: { NEON_ACTIVITY_ENABLED?: boolean } };
    if (env && typeof env.NEON_ACTIVITY_ENABLED === "boolean") {
      return env.NEON_ACTIVITY_ENABLED;
    }
  } catch {
    // Standalone Neon scripts may run without full Supabase environment variables.
  }
  return process.env.NEON_ACTIVITY_ENABLED?.trim().toLowerCase() !== "false";
};

/** Best-effort side effect for Supabase-backed business flows. Never fail their response. */
export const recordActivityBestEffort = async (
  eventType: ActivityType,
  sourceId: string,
): Promise<void> => {
  if (!isNeonActivityEnabled()) return;
  if (!process.env.NEON_DATABASE_URL) return;
  try {
    await recordActivity(eventType, sourceId);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "UNKNOWN";
    console.warn("Neon activity write skipped", { eventType, code });
  }
};

export const listRecentActivities = async (): Promise<ActivityItem[]> => {
  const result = await query<ActivityItem>(
    `SELECT id::text, event_type, title, created_at
     FROM mio.activity_events
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
  );
  return result.rows;
};
