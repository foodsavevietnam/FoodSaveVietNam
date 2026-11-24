import type { PoolClient } from "pg";
import { env } from "../config/env";
import { isPostgresAvailable, postgresPool } from "../config/postgres";
import { supabaseAdmin } from "./supabaseService";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { emitStoreStatusChanged } from "../realtime/socketServer";
import type { UserRole } from "../types/domain";
import type { SellerReputation, SellerReputationStatus, StoreStatusChangedPayload } from "../types/sellerReputation";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";

type TimestampValue = Date | string | null;

interface SellerReputationRow {
  seller_id: string;
  trust_score: number;
  rating_avg: string | number;
  status: SellerReputationStatus;
  restricted_until: TimestampValue;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CancellationMutationResult {
  reputationBeforePenalty: SellerReputation;
  trustScoreBefore: number;
}

const CANCELLATION_PENALTY_POINTS = 15;
const NORMAL_ORDER_RECOVERY_POINTS = 5;
const CHARITY_ORDER_RECOVERY_POINTS = 5;
const BAN_THRESHOLD = 40;
const RESTRICTION_TRUST_THRESHOLD = 85;

const toIsoString = (value: Date | string): string => {
  return value instanceof Date ? value.toISOString() : value;
};

const nullableTimestampToIso = (value: TimestampValue): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

const mapReputation = (row: SellerReputationRow): SellerReputation => ({
  seller_id: row.seller_id,
  trust_score: Number(row.trust_score),
  rating_avg: Number(row.rating_avg),
  status: row.status,
  restricted_until: nullableTimestampToIso(row.restricted_until),
  created_at: toIsoString(row.created_at),
  updated_at: toIsoString(row.updated_at)
});

const buildStatusPayload = (
  reputation: SellerReputation,
  reason: string,
  message: string
): StoreStatusChangedPayload => ({
  sellerId: reputation.seller_id,
  status: reputation.status,
  trustScore: reputation.trust_score,
  ratingAverage: reputation.rating_avg,
  restrictedUntil: reputation.restricted_until,
  reason,
  message,
  emittedAt: new Date().toISOString()
});

const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await postgresPool.connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      logger.error("Không thể rollback transaction danh tiếng seller", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
};

const ensureSellerReputation = async (client: PoolClient, sellerId: string): Promise<void> => {
  // Tạo hồ sơ danh tiếng từ bảng stores nếu seller chưa từng phát sinh điểm uy tín.
  await client.query(
    `
      insert into public.seller_reputation (seller_id, rating_avg)
      select stores.id, stores.rating
      from public.stores
      where stores.id = $1
      on conflict (seller_id) do nothing
    `,
    [sellerId]
  );
};

const fetchReputationForUpdate = async (client: PoolClient, sellerId: string): Promise<SellerReputationRow> => {
  const result = await client.query<SellerReputationRow>(
    `
      select seller_id, trust_score, rating_avg, status, restricted_until, created_at, updated_at
      from public.seller_reputation
      where seller_id = $1
      for update
    `,
    [sellerId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError("Không tìm thấy hồ sơ danh tiếng của seller", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  return row;
};

const fetchReputation = async (sellerId: string): Promise<SellerReputation> => {
  const result = await postgresPool.query<SellerReputationRow>(
    `
      select seller_id, trust_score, rating_avg, status, restricted_until, created_at, updated_at
      from public.seller_reputation
      where seller_id = $1
    `,
    [sellerId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError("Không tìm thấy hồ sơ danh tiếng của seller", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  return mapReputation(row);
};

const assertSellerReadableByActor = async (sellerId: string, actorId: string, actorRole: UserRole): Promise<void> => {
  if (actorRole === "admin") return;

  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("id", sellerId)
    .eq("owner_id", actorId)
    .maybeSingle();

  if (error || !data) {
    if (error) logger.error("Không kiểm tra được quyền xem danh tiếng seller", error);
    throw new AppError("Bạn không có quyền xem danh tiếng của seller này", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
};

const baseService = {
  async getSellerReputation(sellerId: string): Promise<SellerReputation> {
    await withTransaction(async (client) => {
      await ensureSellerReputation(client, sellerId);
    });

    return fetchReputation(sellerId);
  },

  async getSellerReputationForActor(sellerId: string, actorId: string, actorRole: UserRole): Promise<SellerReputation> {
    await assertSellerReadableByActor(sellerId, actorId, actorRole);
    return sellerReputationService.getSellerReputation(sellerId);
  },

  async handleSellerCancellation(sellerId: string, orderId: string): Promise<SellerReputation> {
    const cancellationResult = await withTransaction<CancellationMutationResult>(async (client) => {
      await ensureSellerReputation(client, sellerId);
      const current = await fetchReputationForUpdate(client, sellerId);
      const trustScoreBefore = Number(current.trust_score);

      const updatedResult = await client.query<SellerReputationRow>(
        `
          update public.seller_reputation
          set trust_score = greatest(trust_score - $2, 0)
          where seller_id = $1
          returning seller_id, trust_score, rating_avg, status, restricted_until, created_at, updated_at
        `,
        [sellerId, CANCELLATION_PENALTY_POINTS]
      );

      const updated = updatedResult.rows[0];
      if (!updated) {
        throw new AppError("Không thể cập nhật điểm uy tín của seller", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      // Lưu lịch sử vi phạm để đội vận hành có thể đối soát theo từng đơn.
      await client.query(
        `
          insert into public.seller_violations (
            seller_id,
            order_id,
            violation_type,
            reason,
            point_delta,
            trust_score_before,
            trust_score_after,
            rating_avg_snapshot,
            status_after,
            metadata
          )
          values (
            $1,
            $2,
            'SELLER_CANCELLED_ORDER',
            'Seller hủy đơn do hết hàng ảo',
            $3,
            $4,
            $5,
            $6,
            $7,
            $8::jsonb
          )
        `,
        [
          sellerId,
          orderId,
          -CANCELLATION_PENALTY_POINTS,
          trustScoreBefore,
          Number(updated.trust_score),
          Number(updated.rating_avg),
          updated.status,
          JSON.stringify({ source: "handleSellerCancellation", orderId })
        ]
      );

      return {
        reputationBeforePenalty: mapReputation(updated),
        trustScoreBefore
      };
    });

    logger.info("Đã trừ điểm seller vì hủy đơn", {
      sellerId,
      orderId,
      trustScoreBefore: cancellationResult.trustScoreBefore,
      trustScoreAfter: cancellationResult.reputationBeforePenalty.trust_score
    });

    return sellerReputationService.checkAndApplyPenalties(sellerId);
  },

  async checkAndApplyPenalties(sellerId: string): Promise<SellerReputation> {
    let realtimePayload: StoreStatusChangedPayload | null = null;

    const finalReputation = await withTransaction<SellerReputation>(async (client) => {
      await ensureSellerReputation(client, sellerId);
      const current = await fetchReputationForUpdate(client, sellerId);
      const trustScore = Number(current.trust_score);
      if (current.status === "Banned") {
        return mapReputation(current);
      }

      if (trustScore < BAN_THRESHOLD) {
        const bannedResult = await client.query<SellerReputationRow>(
          `
            update public.seller_reputation
            set status = 'Banned',
                restricted_until = null
            where seller_id = $1
            returning seller_id, trust_score, rating_avg, status, restricted_until, created_at, updated_at
          `,
          [sellerId]
        );

        const banned = bannedResult.rows[0];
        if (!banned) {
          throw new AppError("Không thể khóa seller vi phạm", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
        }

        const reputation = mapReputation(banned);
        realtimePayload = buildStatusPayload(
          reputation,
          "TRUST_SCORE_BELOW_40",
          "Tài khoản cửa hàng đã bị khóa vĩnh viễn do điểm uy tín dưới 40."
        );
        return reputation;
      }

      if (trustScore < RESTRICTION_TRUST_THRESHOLD) {
        const restrictedResult = await client.query<SellerReputationRow>(
          `
            update public.seller_reputation
            set status = 'Restricted',
                restricted_until = greatest(coalesce(restricted_until, now()), now()) + interval '48 hours'
            where seller_id = $1
            returning seller_id, trust_score, rating_avg, status, restricted_until, created_at, updated_at
          `,
          [sellerId]
        );

        const restricted = restrictedResult.rows[0];
        if (!restricted) {
          throw new AppError("Không thể áp dụng chế tài seller", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
        }

        const reputation = mapReputation(restricted);
        realtimePayload = buildStatusPayload(
          reputation,
          "TRUST_SCORE_BELOW_85",
          "Cửa hàng tạm thời bị chặn đăng món mới trong 48 giờ do điểm uy tín từ 40 đến dưới 85."
        );
        return reputation;
      }

      return mapReputation(current);
    });

    if (realtimePayload) {
      emitStoreStatusChanged(realtimePayload);
    }

    return finalReputation;
  },

  async handleOrderSuccess(sellerId: string, isCharityOrder: boolean): Promise<SellerReputation> {
    let realtimePayload: StoreStatusChangedPayload | null = null;
    const recoveryPoints = isCharityOrder ? CHARITY_ORDER_RECOVERY_POINTS : NORMAL_ORDER_RECOVERY_POINTS;

    const finalReputation = await withTransaction<SellerReputation>(async (client) => {
      await ensureSellerReputation(client, sellerId);
      const current = await fetchReputationForUpdate(client, sellerId);
      const newTrustScore = Math.min(Number(current.trust_score) + recoveryPoints, 100);
      const shouldRestoreToActive =
        current.status === "Restricted" &&
        newTrustScore >= RESTRICTION_TRUST_THRESHOLD;

      const updatedResult = await client.query<SellerReputationRow>(
        `
          update public.seller_reputation
          set trust_score = $2,
              status = case when $3::boolean then 'Active'::public.seller_reputation_status else status end,
              restricted_until = case when $3::boolean then null else restricted_until end
          where seller_id = $1
          returning seller_id, trust_score, rating_avg, status, restricted_until, created_at, updated_at
        `,
        [sellerId, newTrustScore, shouldRestoreToActive]
      );

      const updated = updatedResult.rows[0];
      if (!updated) {
        throw new AppError("Không thể cộng điểm phục hồi cho seller", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      const reputation = mapReputation(updated);
      realtimePayload = buildStatusPayload(
        reputation,
        shouldRestoreToActive ? "SELLER_REPUTATION_RECOVERED" : "SUCCESSFUL_ORDER_REPUTATION_REWARD",
        shouldRestoreToActive
          ? "Chúc mừng, cửa hàng đã phục hồi uy tín và được mở lại tính năng đăng món mới."
          : `Cửa hàng được cộng ${recoveryPoints} điểm uy tín nhờ hoàn tất đơn hàng.`
      );

      return reputation;
    });

    if (realtimePayload) {
      emitStoreStatusChanged(realtimePayload);
    }

    return finalReputation;
  },

  async updateSellerRatingAverage(sellerId: string, ratingAverage: number): Promise<SellerReputation> {
    await withTransaction(async (client) => {
      await ensureSellerReputation(client, sellerId);
      const updatedResult = await client.query<SellerReputationRow>(
        `
          update public.seller_reputation
          set rating_avg = $2
          where seller_id = $1
          returning seller_id, trust_score, rating_avg, status, restricted_until, created_at, updated_at
        `,
        [sellerId, ratingAverage]
      );

      if (!updatedResult.rows[0]) {
        throw new AppError("Không thể cập nhật sao trung bình của seller", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      await client.query(
        `
          update public.stores
          set rating = $2
          where id = $1
        `,
        [sellerId, ratingAverage]
      );
    });

    return sellerReputationService.checkAndApplyPenalties(sellerId);
  }
};

const MIGRATION_PENDING_CODES = new Set(["42883", "42P01", "PGRST202", "PGRST205"]);
const warnedMissingRpcs = new Set<string>();

const isMigrationPendingError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && MIGRATION_PENDING_CODES.has(code);
};

const warnMissingRpcOnce = (rpcName: string, error: unknown): void => {
  if (warnedMissingRpcs.has(rpcName)) return;
  warnedMissingRpcs.add(rpcName);
  logger.warn(`RPC ${rpcName} chưa sẵn sàng (chưa áp dụng SQL 041); tự động chuyển về nhánh dự phòng`, {
    rpc: rpcName,
    code: (error as { code?: string } | null)?.code,
    message: (error as { message?: string } | null)?.message
  });
};

interface RpcSellerReputationPayload extends SellerReputationRow {
  trust_score_before?: number;
  status_changed?: boolean;
  violation_recorded?: boolean;
}

const applyDeltaViaRpc = async (params: {
  storeId: string;
  delta: number;
  violationType?: string | null;
  reason?: string | null;
  orderId?: string | null;
  pgAvailable: boolean;
}): Promise<{ ok: true; data: RpcSellerReputationPayload; reputation: SellerReputation } | { ok: false }> => {
  const { data, error } = await supabaseAdmin.rpc("fs_seller_reputation_apply_delta", {
    p_store_id: params.storeId,
    p_delta: params.delta,
    p_violation_type: params.violationType ?? null,
    p_reason: params.reason ?? null,
    p_order_id: params.orderId ?? null
  });

  if (error) {
    if (isMigrationPendingError(error)) {
      warnMissingRpcOnce("fs_seller_reputation_apply_delta", error);
      return { ok: false };
    }
    if (error.code === "P0002" || error.message?.includes("seller_reputation_not_found")) {
      throw new AppError("Không tìm thấy hồ sơ danh tiếng của seller", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    if (!params.pgAvailable) {
      warnMissingRpcOnce("fs_seller_reputation_apply_delta", error);
      return { ok: false };
    }
    logger.warn("Lỗi gọi RPC fs_seller_reputation_apply_delta, chuyển sang PostgreSQL trực tiếp", {
      storeId: params.storeId,
      code: error.code,
      message: error.message
    });
    return { ok: false };
  }

  if (!data || typeof data !== "object") {
    return { ok: false };
  }

  const row = data as RpcSellerReputationPayload;
  return { ok: true, data: row, reputation: mapReputation(row) };
};

const emitPenaltyStatusIfNeeded = (reputation: SellerReputation): void => {
  if (reputation.status === "Banned") {
    emitStoreStatusChanged(
      buildStatusPayload(
        reputation,
        "TRUST_SCORE_BELOW_40",
        "Tài khoản cửa hàng đã bị khóa vĩnh viễn do điểm uy tín dưới 40."
      )
    );
  } else if (reputation.status === "Restricted") {
    emitStoreStatusChanged(
      buildStatusPayload(
        reputation,
        "TRUST_SCORE_BELOW_85",
        "Cửa hàng tạm thời bị chặn đăng món mới trong 48 giờ do điểm uy tín từ 40 đến dưới 85."
      )
    );
  }
};

// Hồ sơ uy tín mặc định khi không dùng được PostgreSQL trực tiếp (đọc bằng Supabase, nếu chưa có thì điểm tối đa)
const fallbackReputation = async (sellerId: string): Promise<SellerReputation> => {
  const { data } = await supabaseAdmin.from("seller_reputation").select("seller_id,trust_score,rating_avg,status,restricted_until,created_at,updated_at").eq("seller_id", sellerId).maybeSingle();
  if (data) return mapReputation(data as unknown as SellerReputationRow);
  const now = new Date().toISOString();
  return { seller_id: sellerId, trust_score: 100, rating_avg: 5, status: "Active", restricted_until: null, created_at: now, updated_at: now };
};

// G-7: Khi bật SELLER_REPUTATION_RPC_ENABLED hoặc không có PostgreSQL trực tiếp, thử gọi RPC
// fs_seller_reputation_apply_delta (SQL 041) trước; nếu chưa migrate (42883/PGRST202) thì rơi về hành vi cũ.
// Riêng getSellerReputationForActor LUÔN kiểm tra quyền sở hữu qua supabaseAdmin TRƯỚC nhánh fallback để chống IDOR.
type ReputationService = typeof baseService;
export const sellerReputationService: ReputationService = {
  async getSellerReputation(sellerId: string): Promise<SellerReputation> {
    const pgAvailable = await isPostgresAvailable();
    if (env.SELLER_REPUTATION_RPC_ENABLED || !pgAvailable) {
      // Đọc thuần trước để tránh gọi RPC khóa ghi FOR UPDATE cho các yêu cầu GET phổ biến;
      // chỉ gọi RPC delta=0 khi chưa có dòng seller_reputation (tạo lười từ bảng stores).
      const { data: existing, error: readError } = await supabaseAdmin
        .from("seller_reputation")
        .select("seller_id,trust_score,rating_avg,status,restricted_until,created_at,updated_at")
        .eq("seller_id", sellerId)
        .maybeSingle();
      if (!readError && existing) {
        return mapReputation(existing as unknown as SellerReputationRow);
      }
      const rpc = await applyDeltaViaRpc({ storeId: sellerId, delta: 0, pgAvailable });
      if (rpc.ok) return rpc.reputation;
    }
    if (pgAvailable) return baseService.getSellerReputation(sellerId);
    logger.warn("Bỏ qua tính điểm uy tín (chưa có kết nối PostgreSQL): getSellerReputation");
    return fallbackReputation(sellerId);
  },

  async getSellerReputationForActor(sellerId: string, actorId: string, actorRole: UserRole): Promise<SellerReputation> {
    await assertSellerReadableByActor(sellerId, actorId, actorRole);
    return sellerReputationService.getSellerReputation(sellerId);
  },

  async handleSellerCancellation(sellerId: string, orderId: string): Promise<SellerReputation> {
    const pgAvailable = await isPostgresAvailable();
    if (env.SELLER_REPUTATION_RPC_ENABLED || !pgAvailable) {
      const rpc = await applyDeltaViaRpc({
        storeId: sellerId,
        delta: -CANCELLATION_PENALTY_POINTS,
        violationType: "SELLER_CANCELLED_ORDER",
        reason: "Seller hủy đơn do hết hàng ảo",
        orderId,
        pgAvailable
      });
      if (rpc.ok) {
        logger.info("Đã trừ điểm seller vì hủy đơn", {
          sellerId,
          orderId,
          trustScoreBefore: rpc.data.trust_score_before ?? rpc.reputation.trust_score,
          trustScoreAfter: rpc.reputation.trust_score
        });
        emitPenaltyStatusIfNeeded(rpc.reputation);
        return rpc.reputation;
      }
    }
    if (pgAvailable) return baseService.handleSellerCancellation(sellerId, orderId);
    logger.warn("Bỏ qua tính điểm uy tín (chưa có kết nối PostgreSQL): handleSellerCancellation");
    return fallbackReputation(sellerId);
  },

  async checkAndApplyPenalties(sellerId: string): Promise<SellerReputation> {
    const pgAvailable = await isPostgresAvailable();
    if (env.SELLER_REPUTATION_RPC_ENABLED || !pgAvailable) {
      const rpc = await applyDeltaViaRpc({ storeId: sellerId, delta: 0, pgAvailable });
      if (rpc.ok) {
        emitPenaltyStatusIfNeeded(rpc.reputation);
        return rpc.reputation;
      }
    }
    if (pgAvailable) return baseService.checkAndApplyPenalties(sellerId);
    logger.warn("Bỏ qua tính điểm uy tín (chưa có kết nối PostgreSQL): checkAndApplyPenalties");
    return fallbackReputation(sellerId);
  },

  async handleOrderSuccess(sellerId: string, isCharityOrder: boolean): Promise<SellerReputation> {
    const pgAvailable = await isPostgresAvailable();
    const recoveryPoints = isCharityOrder ? CHARITY_ORDER_RECOVERY_POINTS : NORMAL_ORDER_RECOVERY_POINTS;
    if (env.SELLER_REPUTATION_RPC_ENABLED || !pgAvailable) {
      const rpc = await applyDeltaViaRpc({ storeId: sellerId, delta: recoveryPoints, pgAvailable });
      if (rpc.ok) {
        const restored = Boolean(rpc.data.status_changed && rpc.reputation.status === "Active");
        emitStoreStatusChanged(
          buildStatusPayload(
            rpc.reputation,
            restored ? "SELLER_REPUTATION_RECOVERED" : "SUCCESSFUL_ORDER_REPUTATION_REWARD",
            restored
              ? "Chúc mừng, cửa hàng đã phục hồi uy tín và được mở lại tính năng đăng món mới."
              : `Cửa hàng được cộng ${recoveryPoints} điểm uy tín nhờ hoàn tất đơn hàng.`
          )
        );
        return rpc.reputation;
      }
    }
    if (pgAvailable) return baseService.handleOrderSuccess(sellerId, isCharityOrder);
    logger.warn("Bỏ qua tính điểm uy tín (chưa có kết nối PostgreSQL): handleOrderSuccess");
    return fallbackReputation(sellerId);
  },

  async updateSellerRatingAverage(sellerId: string, ratingAverage: number): Promise<SellerReputation> {
    const pgAvailable = await isPostgresAvailable();
    if (env.SELLER_REPUTATION_RPC_ENABLED || !pgAvailable) {
      const rpc = await applyDeltaViaRpc({ storeId: sellerId, delta: 0, pgAvailable });
      if (rpc.ok) {
        await supabaseAdmin.from("seller_reputation").update({ rating_avg: ratingAverage }).eq("seller_id", sellerId);
        await supabaseAdmin.from("stores").update({ rating: ratingAverage }).eq("id", sellerId);
        const updated = { ...rpc.reputation, rating_avg: ratingAverage };
        emitPenaltyStatusIfNeeded(updated);
        return updated;
      }
    }
    if (pgAvailable) return baseService.updateSellerRatingAverage(sellerId, ratingAverage);
    logger.warn("Bỏ qua tính điểm uy tín (chưa có kết nối PostgreSQL): updateSellerRatingAverage");
    return fallbackReputation(sellerId);
  }
};
