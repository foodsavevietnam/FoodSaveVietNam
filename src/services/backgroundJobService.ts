import { logger } from "../utils/logger";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export type BackgroundJobStatus = "pending" | "processing" | "done" | "failed" | "dead";

export interface BackgroundJobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: BackgroundJobStatus;
  run_at: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  idempotency_key: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueJobInput {
  kind: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  runAfter?: Date | string | null;
  maxAttempts?: number;
}

export interface EnqueueJobResult {
  queued: boolean;
  id?: string;
  deduplicated?: boolean;
  reason?: "migration_pending" | "duplicate";
}

export type BackgroundJobHandler = (
  payload: Record<string, unknown>,
  job: BackgroundJobRow
) => Promise<void> | void;

export interface ProcessPendingJobsOptions {
  workerId?: string;
  kind?: string;
  limit?: number;
  timeBudgetMs?: number;
}

export interface ProcessPendingJobsResult {
  skipped?: boolean;
  reason?: "migration_pending";
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  budget_reached: boolean;
}

const DEFAULT_TIME_BUDGET_MS = 8000;
const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_ATTEMPTS = 5;
const MIGRATION_PENDING_CODES = new Set(["42883", "42P01", "PGRST202", "PGRST205"]);

const handlers = new Map<string, BackgroundJobHandler>();
const warnedMissingObjects = new Set<string>();

const isMigrationPendingError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && MIGRATION_PENDING_CODES.has(code);
};

const warnMigrationPendingOnce = (target: string, error: unknown): void => {
  if (warnedMissingObjects.has(target)) return;
  warnedMissingObjects.add(target);
  logger.warn(`Outbox ${target} chưa sẵn sàng (chưa áp dụng SQL 042); tạm bỏ qua an toàn`, {
    target,
    code: (error as { code?: string } | null)?.code,
    message: (error as { message?: string } | null)?.message
  });
};

export const computeBackoffMs = (attempts: number): number => {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  return Math.pow(2, safeAttempts) * 30_000;
};

const normalizeRunAt = (runAfter: Date | string | null | undefined): string => {
  if (!runAfter) return new Date().toISOString();
  const parsed = runAfter instanceof Date ? runAfter : new Date(runAfter);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
};

const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
};

export const registerJobHandler = (kind: string, handler: BackgroundJobHandler): void => {
  handlers.set(kind, handler);
};

export const unregisterJobHandler = (kind: string): void => {
  handlers.delete(kind);
};

export const clearJobHandlers = (): void => {
  handlers.clear();
};

export const enqueueJob = async (input: EnqueueJobInput): Promise<EnqueueJobResult> => {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const row: Record<string, unknown> = {
    job_type: input.kind,
    payload: input.payload ?? {},
    status: "pending",
    run_at: normalizeRunAt(input.runAfter),
    max_attempts: maxAttempts
  };
  if (input.dedupeKey) {
    row.idempotency_key = input.dedupeKey;
  }

  const { data, error } = await supabaseAdmin
    .from("background_jobs")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { queued: false, deduplicated: true, reason: "duplicate" };
    }
    if (isMigrationPendingError(error)) {
      warnMigrationPendingOnce("background_jobs", error);
      return { queued: false, reason: "migration_pending" };
    }
    handleSupabaseError(error, "Failed to enqueue background job");
  }

  const inserted = data as { id?: string } | null;
  return inserted?.id ? { queued: true, id: inserted.id } : { queued: true };
};

export const processPendingJobs = async (
  options: ProcessPendingJobsOptions = {}
): Promise<ProcessPendingJobsResult> => {
  const startedAtMs = Date.now();
  const timeBudgetMs = Math.max(0, options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? DEFAULT_LIMIT), 1), 500);
  const workerId = options.workerId ?? `worker-${process.pid}`;

  const { data, error } = await supabaseAdmin.rpc("fs_claim_background_jobs", {
    p_job_type: options.kind ?? null,
    p_limit: limit
  });

  if (error) {
    if (isMigrationPendingError(error)) {
      warnMigrationPendingOnce("fs_claim_background_jobs", error);
      return {
        skipped: true,
        reason: "migration_pending",
        claimed: 0,
        done: 0,
        retried: 0,
        dead: 0,
        budget_reached: false
      };
    }
    handleSupabaseError(error, "Failed to claim background jobs");
  }

  const jobs = (Array.isArray(data) ? data : []) as BackgroundJobRow[];
  let done = 0;
  let retried = 0;
  let dead = 0;
  let budgetReached = false;

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    if (Date.now() - startedAtMs >= timeBudgetMs) {
      budgetReached = true;
      // Trả các tác vụ đã nhận nhưng chưa kịp chạy về lại pending để worker sau xử lý.
      for (let rest = index; rest < jobs.length; rest += 1) {
        const skippedJob = jobs[rest]!;
        await supabaseAdmin
          .from("background_jobs")
          .update({
            status: "pending",
            locked_at: null,
            attempts: Math.max(0, (Number(skippedJob.attempts) || 1) - 1)
          })
          .eq("id", skippedJob.id);
      }
      break;
    }

    const handler = handlers.get(job.job_type);
    try {
      if (!handler) {
        throw new Error(`No background job handler registered for kind "${job.job_type}"`);
      }
      await handler(job.payload ?? {}, job);
      const { error: doneError } = await supabaseAdmin
        .from("background_jobs")
        .update({
          status: "done",
          locked_at: null,
          last_error: null
        })
        .eq("id", job.id);
      if (doneError) {
        logger.warn("Không cập nhật được trạng thái done cho background job", {
          workerId,
          jobId: job.id,
          kind: job.job_type,
          error: doneError
        });
      }
      done += 1;
    } catch (jobError) {
      const attempts = Math.max(1, Number(job.attempts) || 1);
      const maxAttempts = Math.max(1, Number(job.max_attempts) || DEFAULT_MAX_ATTEMPTS);
      const errorMessage = formatErrorMessage(jobError);
      const exhausted = attempts >= maxAttempts;

      if (exhausted) {
        await supabaseAdmin
          .from("background_jobs")
          .update({
            status: "dead",
            locked_at: null,
            last_error: errorMessage
          })
          .eq("id", job.id);
        dead += 1;
        logger.error("Background job exhausted max attempts and moved to dead", {
          workerId,
          jobId: job.id,
          kind: job.job_type,
          attempts,
          maxAttempts,
          error: errorMessage
        });
      } else {
        const nextRunAt = new Date(Date.now() + computeBackoffMs(attempts)).toISOString();
        await supabaseAdmin
          .from("background_jobs")
          .update({
            status: "pending",
            run_at: nextRunAt,
            locked_at: null,
            last_error: errorMessage
          })
          .eq("id", job.id);
        retried += 1;
        logger.warn("Background job failed and rescheduled with backoff", {
          workerId,
          jobId: job.id,
          kind: job.job_type,
          attempts,
          maxAttempts,
          nextRunAt,
          error: errorMessage
        });
      }
    }
  }

  return {
    claimed: jobs.length,
    done,
    retried,
    dead,
    budget_reached: budgetReached
  };
};

export const backgroundJobService = {
  enqueueJob,
  registerJobHandler,
  unregisterJobHandler,
  clearJobHandlers,
  processPendingJobs,
  computeBackoffMs
};
