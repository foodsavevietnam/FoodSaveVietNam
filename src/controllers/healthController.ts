import type { Request, Response } from "express";
import { env } from "../config/env";
import { supabaseAdmin } from "../config/supabase";
import { HTTP_STATUS } from "../constants/http";
import { sendSuccess } from "../utils/response";

const READY_CHECK_TIMEOUT_MS = 2000;

const checkSupabaseReadiness = async (): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const queryPromise = Promise.resolve(
      supabaseAdmin.from("stores").select("id", { head: true, count: "exact" })
    ).then((result) => !result?.error);

    const timeoutPromise = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), READY_CHECK_TIMEOUT_MS);
      timer.unref?.();
    });

    return await Promise.race([queryPromise, timeoutPromise]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const healthController = {
  getHealth(_req: Request, res: Response): void {
    sendSuccess(res, {
      service: "foodsave-backend",
      environment: env.NODE_ENV,
      uptime_seconds: Math.round(process.uptime()),
      checked_at: new Date().toISOString()
    });
  },

  async getReady(_req: Request, res: Response): Promise<void> {
    const supabaseOk = await checkSupabaseReadiness();
    const features = {
      automation_enabled: Boolean(env.AUTOMATION_ENABLED),
      push_enabled: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
      neon_enabled: Boolean(env.NEON_ACTIVITY_ENABLED && (env.NEON_DATABASE_URL || process.env.NEON_DATABASE_URL))
    };

    const payload = {
      service: "foodsave-backend",
      status: supabaseOk ? "ready" : "degraded",
      environment: env.NODE_ENV,
      checked_at: new Date().toISOString(),
      checks: {
        supabase: supabaseOk ? "ok" : "error"
      },
      features
    } as const;

    if (supabaseOk) {
      sendSuccess(res, payload, HTTP_STATUS.OK);
      return;
    }

    res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
      success: false,
      data: payload
    });
  }
};
