import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Đặt biến môi trường giả TRƯỚC khi nạp bất kỳ module dist/ nào
Object.assign(process.env, {
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  CORS_ORIGINS: "http://localhost",
  DATABASE_URL: "postgres://x:x@127.0.0.1:9/x",
  DEMO_MODE: "false",
  ORDER_POLICY_TIME_SCALE: "1",
  LOG_LEVEL: "error",
  PAYMENT_PROVIDER: "simulated",
  PAYOUT_PROVIDER: "manual",
  PAYOUT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
  AUTOMATION_ENABLED: "false",
  ORDER_ATOMIC_RPC_ENABLED: "false",
  SELLER_REPUTATION_RPC_ENABLED: "false",
  LOCATION_RPC_ENABLED: "false",
  OUTBOX_ENABLED: "false",
  AUTH_LOCAL_JWT_VERIFY: "false"
});

const require = createRequire(import.meta.url);
const { FakeDb } = require("../scripts/fake-supabase");

let db = new FakeDb();
let rpcHook = null;
let fromHook = null;
let authGetUserCalls = 0;
let authGetUserResult = { data: { user: null }, error: { message: "invalid" } };

const sb = require("../dist/config/supabase");
sb.supabaseAdmin = {
  from: (name) => (fromHook ? fromHook(name, () => db.from(name)) : db.from(name)),
  rpc: (name, args) => (rpcHook ? rpcHook(name, args, () => db.rpc(name, args)) : db.rpc(name, args))
};
sb.supabaseAuth = {
  auth: {
    getUser: async (token) => {
      authGetUserCalls += 1;
      if (typeof authGetUserResult === "function") return authGetUserResult(token);
      return authGetUserResult;
    }
  }
};

const pgModule = require("../dist/config/postgres");
pgModule.isPostgresAvailable = async () => false;

const { env } = require("../dist/config/env");
const { buildPostgresPoolConfig } = require("../dist/config/postgres");
const {
  verifySupabaseJwtLocally,
  authMiddleware,
  optionalAuthMiddleware
} = require("../dist/middlewares/authMiddleware");
const { supportRoutes } = require("../dist/routes/supportRoutes");
const { backgroundJobService, computeBackoffMs } = require("../dist/services/backgroundJobService");
const { orderAutomationService } = require("../dist/services/orderAutomationService");
const { orderService } = require("../dist/services/orderService");
const { momoPaymentService } = require("../dist/services/momoPaymentService");
const { ledgerService } = require("../dist/services/ledgerService");
const { sellerReputationService } = require("../dist/services/sellerReputationService");
const { locationService } = require("../dist/services/locationService");

const HOUR = 3_600_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const JWT_SECRET = "super-secret-supabase-jwt-signing-key-32bytes";
const USER_UUID = "11111111-1111-4111-8111-111111111111";
const STORE_UUID = "22222222-2222-4222-8222-222222222222";
const ORDER_UUID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_UUID = "44444444-4444-4444-8444-444444444444";
const VOUCHER_UUID = "55555555-5555-4555-8555-555555555555";

function signJwt(payload, secret = JWT_SECRET, header = { alg: "HS256", typ: "JWT" }) {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

function resetState() {
  db = new FakeDb();
  db.seedSystemWallets();
  db.unique.background_jobs = ["idempotency_key"];
  rpcHook = null;
  fromHook = null;
  authGetUserCalls = 0;
  authGetUserResult = { data: { user: null }, error: { message: "invalid" } };
  backgroundJobService.clearJobHandlers();
  env.ORDER_ATOMIC_RPC_ENABLED = false;
  env.SELLER_REPUTATION_RPC_ENABLED = false;
  env.LOCATION_RPC_ENABLED = false;
  env.OUTBOX_ENABLED = false;
  env.AUTH_LOCAL_JWT_VERIFY = false;
  env.SUPABASE_JWT_SECRET = undefined;
  pgModule.isPostgresAvailable = async () => false;
}

function runMiddleware(mw, req) {
  return new Promise((resolve) => {
    mw(req, {}, (err) => resolve(err ?? null));
  });
}

// ============================================================================
// 1. Serverless PG Pool Cap
// ============================================================================
test("postgres pool caps max=2 and idleTimeoutMillis=10000 on Netlify / AWS Lambda", () => {
  const normal = buildPostgresPoolConfig({});
  assert.equal(normal.max, 20);
  assert.equal(normal.idleTimeoutMillis, 30000);
  assert.equal(normal.connectionTimeoutMillis, 5000);

  const netlify = buildPostgresPoolConfig({ NETLIFY: "true" });
  assert.equal(netlify.max, 2);
  assert.equal(netlify.idleTimeoutMillis, 10000);
  assert.equal(netlify.connectionTimeoutMillis, 5000);

  const lambda = buildPostgresPoolConfig({ AWS_LAMBDA_FUNCTION_NAME: "api-prod" });
  assert.equal(lambda.max, 2);
  assert.equal(lambda.idleTimeoutMillis, 10000);
  assert.equal(lambda.connectionTimeoutMillis, 5000);
});

// ============================================================================
// 2. Local HS256 JWT Verification & optionalAuthMiddleware
// ============================================================================
test("verifySupabaseJwtLocally validates HS256 tokens, rejects expired/tampered/future-nbf, and returns null for RS256", () => {
  const now = 1_800_000_000;
  const validToken = signJwt({
    sub: USER_UUID,
    email: "buyer@mio.vn",
    role: "authenticated",
    aud: "authenticated",
    exp: now + 300,
    nbf: now - 10,
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Minh" }
  });

  const user = verifySupabaseJwtLocally(validToken, JWT_SECRET, now);
  assert.deepEqual(user, {
    id: USER_UUID,
    email: "buyer@mio.vn",
    role: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Minh" }
  });

  // Expired token -> 401 AUTH_INVALID_TOKEN
  const expiredToken = signJwt({ sub: USER_UUID, aud: "authenticated", exp: now - 1 });
  assert.throws(
    () => verifySupabaseJwtLocally(expiredToken, JWT_SECRET, now),
    (err) => err.statusCode === 401 && err.code === "AUTH_INVALID_TOKEN"
  );

  // Tampered signature -> 401 AUTH_INVALID_TOKEN
  const tamperedToken = validToken.slice(0, -4) + "AAAA";
  assert.throws(
    () => verifySupabaseJwtLocally(tamperedToken, JWT_SECRET, now),
    (err) => err.statusCode === 401 && err.code === "AUTH_INVALID_TOKEN"
  );

  // Future nbf -> 401 AUTH_INVALID_TOKEN
  const futureNbfToken = signJwt({ sub: USER_UUID, aud: "authenticated", exp: now + 300, nbf: now + 60 });
  assert.throws(
    () => verifySupabaseJwtLocally(futureNbfToken, JWT_SECRET, now),
    (err) => err.statusCode === 401 && err.code === "AUTH_INVALID_TOKEN"
  );

  // Wrong aud -> 401
  const wrongAudToken = signJwt({ sub: USER_UUID, aud: "anon", exp: now + 300 });
  assert.throws(
    () => verifySupabaseJwtLocally(wrongAudToken, JWT_SECRET, now),
    (err) => err.statusCode === 401 && err.code === "AUTH_INVALID_TOKEN"
  );

  // Missing aud -> 401 (MINOR-6)
  const missingAudToken = signJwt({ sub: USER_UUID, exp: now + 300 });
  assert.throws(
    () => verifySupabaseJwtLocally(missingAudToken, JWT_SECRET, now),
    (err) => err.statusCode === 401 && err.code === "AUTH_INVALID_TOKEN"
  );

  // alg=none -> 401
  const noneAlgToken = signJwt({ sub: USER_UUID, aud: "authenticated", exp: now + 300 }, JWT_SECRET, { alg: "none", typ: "JWT" });
  assert.throws(
    () => verifySupabaseJwtLocally(noneAlgToken, JWT_SECRET, now),
    (err) => err.statusCode === 401 && err.code === "AUTH_INVALID_TOKEN"
  );

  // RS256 -> returns null so caller falls back to supabaseAuth.auth.getUser
  const rs256Token = signJwt({ sub: USER_UUID, aud: "authenticated", exp: now + 300 }, JWT_SECRET, { alg: "RS256", typ: "JWT" });
  assert.equal(verifySupabaseJwtLocally(rs256Token, JWT_SECRET, now), null);
});

test("authMiddleware skips Supabase Auth network call for valid HS256, still blocks suspended profiles, and falls back on RS256", async () => {
  resetState();
  env.AUTH_LOCAL_JWT_VERIFY = true;
  env.SUPABASE_JWT_SECRET = JWT_SECRET;
  const futureExp = Math.floor(Date.now() / 1000) + 600;
  const token = signJwt({ sub: USER_UUID, email: "u@mio.vn", aud: "authenticated", exp: futureExp });

  db.seed("profiles", [{ id: USER_UUID, role: "customer", full_name: "Khách", status: "active" }]);
  const req1 = { headers: { authorization: `Bearer ${token}` } };
  const err1 = await runMiddleware(authMiddleware, req1);
  assert.equal(err1, null);
  assert.equal(req1.user.id, USER_UUID);
  assert.equal(req1.profile.id, USER_UUID);
  assert.equal(authGetUserCalls, 0, "valid HS256 must not call supabaseAuth.auth.getUser");

  // Suspended profile -> 403 AUTH_FORBIDDEN
  db.table("profiles")[0].status = "suspended";
  const reqSuspended = { headers: { authorization: `Bearer ${token}` } };
  const errSuspended = await runMiddleware(authMiddleware, reqSuspended);
  assert.equal(errSuspended.statusCode, 403);
  assert.equal(errSuspended.code, "AUTH_FORBIDDEN");
  assert.equal(authGetUserCalls, 0);

  // RS256 token -> falls back to supabaseAuth.auth.getUser
  db.table("profiles")[0].status = "active";
  authGetUserResult = { data: { user: { id: USER_UUID, email: "rs@mio.vn" } }, error: null };
  const rsToken = signJwt({ sub: USER_UUID, aud: "authenticated", exp: futureExp }, JWT_SECRET, { alg: "RS256", typ: "JWT" });
  const reqRs = { headers: { authorization: `Bearer ${rsToken}` } };
  const errRs = await runMiddleware(authMiddleware, reqRs);
  assert.equal(errRs, null);
  assert.equal(authGetUserCalls, 1, "RS256 must fall back to supabaseAuth.auth.getUser");
  assert.equal(reqRs.user.email, "rs@mio.vn");
});

test("optionalAuthMiddleware allows anonymous and invalid tokens without blocking, populates req.user when authenticated, and is attached to /support routes", async () => {
  resetState();
  env.AUTH_LOCAL_JWT_VERIFY = true;
  env.SUPABASE_JWT_SECRET = JWT_SECRET;
  const futureExp = Math.floor(Date.now() / 1000) + 600;
  db.seed("profiles", [{ id: USER_UUID, role: "customer", full_name: "Khách", status: "active" }]);

  // Anonymous
  const anonReq = { headers: {} };
  assert.equal(await runMiddleware(optionalAuthMiddleware, anonReq), null);
  assert.equal(anonReq.user, undefined);

  // Invalid token -> does not block
  const badReq = { headers: { authorization: "Bearer not.a.validjwt" } };
  assert.equal(await runMiddleware(optionalAuthMiddleware, badReq), null);
  assert.equal(badReq.user, undefined);

  // Valid token -> sets req.user & req.profile
  const validToken = signJwt({ sub: USER_UUID, email: "ok@mio.vn", aud: "authenticated", exp: futureExp });
  const authReq = { headers: { authorization: `Bearer ${validToken}` } };
  assert.equal(await runMiddleware(optionalAuthMiddleware, authReq), null);
  assert.equal(authReq.user.id, USER_UUID);
  assert.equal(authReq.profile.id, USER_UUID);

  // Verify supportRoutes attaches optionalAuthMiddleware on /contact and /applications
  const routeLayers = supportRoutes.stack.filter((layer) => layer.route);
  const paths = routeLayers.map((layer) => layer.route.path).sort();
  assert.deepEqual(paths, ["/applications", "/contact"]);
  for (const layer of routeLayers) {
    const names = layer.route.stack.map((s) => s.handle.name);
    assert.ok(names.includes("optionalAuthMiddleware"), `route ${layer.route.path} must include optionalAuthMiddleware`);
  }
});

// ============================================================================
// 3. Background Jobs Outbox Service & Order Automation Integration
// ============================================================================
test("backgroundJobService handles enqueue, dedupe, claim->done, retry with backoff, dead after max_attempts, and migration_pending fallback", async () => {
  resetState();

  // Enqueue & deduplication
  const q1 = await backgroundJobService.enqueueJob({
    kind: "send_email",
    payload: { to: "a@mio.vn" },
    dedupeKey: "email:1",
    maxAttempts: 2
  });
  assert.equal(q1.queued, true);
  assert.ok(q1.id);

  const dup = await backgroundJobService.enqueueJob({
    kind: "send_email",
    payload: { to: "a@mio.vn" },
    dedupeKey: "email:1"
  });
  assert.equal(dup.queued, false);
  assert.equal(dup.deduplicated, true);

  // Mock fs_claim_background_jobs on FakeDb
  const installClaimRpc = () => {
    rpcHook = (name, args, fallback) => {
      if (name !== "fs_claim_background_jobs") return fallback();
      const nowMs = Date.now();
      const jobs = db.table("background_jobs")
        .filter((j) => j.status === "pending" && Date.parse(j.run_at) <= nowMs && (j.attempts ?? 0) < j.max_attempts)
        .filter((j) => !args.p_job_type || j.job_type === args.p_job_type)
        .slice(0, args.p_limit ?? 20);
      for (const j of jobs) {
        j.status = "processing";
        j.locked_at = new Date().toISOString();
        j.attempts = (j.attempts ?? 0) + 1;
      }
      return Promise.resolve({ data: jobs.map((j) => ({ ...j })), error: null });
    };
  };
  installClaimRpc();

  // Process -> done
  const seen = [];
  backgroundJobService.registerJobHandler("send_email", async (payload) => {
    seen.push(payload.to);
  });
  const rDone = await backgroundJobService.processPendingJobs({ limit: 10, timeBudgetMs: 5000 });
  assert.equal(rDone.claimed, 1);
  assert.equal(rDone.done, 1);
  assert.equal(seen[0], "a@mio.vn");
  assert.equal(db.table("background_jobs")[0].status, "done");

  // Retry with exponential backoff then dead after max_attempts=2
  const qFail = await backgroundJobService.enqueueJob({
    kind: "flaky_job",
    payload: { step: 1 },
    dedupeKey: "flaky:1",
    maxAttempts: 2
  });
  backgroundJobService.registerJobHandler("flaky_job", async () => {
    throw new Error("downstream timeout");
  });

  const beforeRetry = Date.now();
  const rRetry = await backgroundJobService.processPendingJobs({ kind: "flaky_job" });
  assert.equal(rRetry.retried, 1);
  assert.equal(rRetry.dead, 0);
  const jobAfterFirstFail = db.table("background_jobs").find((j) => j.id === qFail.id);
  assert.equal(jobAfterFirstFail.status, "pending");
  assert.equal(jobAfterFirstFail.attempts, 1);
  assert.match(jobAfterFirstFail.last_error, /downstream timeout/);
  assert.equal(computeBackoffMs(1), 60_000);
  assert.equal(computeBackoffMs(2), 120_000);
  assert.ok(Date.parse(jobAfterFirstFail.run_at) >= beforeRetry + 59_000, "backoff must be ~2^1 * 30s");

  // Fast-forward run_at and run second (final) attempt -> dead
  jobAfterFirstFail.run_at = iso(-1000);
  const rDead = await backgroundJobService.processPendingJobs({ kind: "flaky_job" });
  assert.equal(rDead.dead, 1);
  assert.equal(rDead.retried, 0);
  assert.equal(jobAfterFirstFail.status, "dead");
  assert.equal(jobAfterFirstFail.attempts, 2);

  // Order automation runs outbox when OUTBOX_ENABLED=true
  env.OUTBOX_ENABLED = true;
  await backgroundJobService.enqueueJob({ kind: "send_email", payload: { to: "cron@mio.vn" }, dedupeKey: "email:cron-1" });
  const autoRes = await orderAutomationService.run("schedule", { timeBudgetMs: 20_000 });
  assert.equal(autoRes.outbox_processed, 1);
  assert.ok(seen.includes("cron@mio.vn"));

  // Migration pending fallbacks: 42P01 on enqueue & 42883 on claim
  fromHook = (name, createQuery) => {
    const q = createQuery();
    if (name === "background_jobs") {
      q.run = () => ({ data: null, error: { code: "42P01", message: 'relation "background_jobs" does not exist' }, count: null });
    }
    return q;
  };
  const missingTbl = await backgroundJobService.enqueueJob({ kind: "send_email", payload: {} });
  assert.deepEqual(missingTbl, { queued: false, reason: "migration_pending" });

  fromHook = null;
  rpcHook = (name) => {
    if (name === "fs_claim_background_jobs") {
      return Promise.resolve({ data: null, error: { code: "42883", message: "function fs_claim_background_jobs does not exist" } });
    }
    return db.rpc(name, {});
  };
  const missingRpc = await backgroundJobService.processPendingJobs();
  assert.equal(missingRpc.skipped, true);
  assert.equal(missingRpc.reason, "migration_pending");
});

// ============================================================================
// 4. RPC Wiring + 42883/PGRST202 Fallback Tests
// ============================================================================
test("orderService uses fs_reserve_order_stock & fs_restore_order_stock_atomic when enabled, falls back on 42883/PGRST202, and decouples momoPaymentService", async () => {
  resetState();
  // Verify no circular dynamic import in momoPaymentService.ts
  const momoSource = readFileSync(new URL("../src/services/momoPaymentService.ts", import.meta.url), "utf8");
  assert.doesNotMatch(momoSource, /import\(["']\.\/orderService/);

  const seedOrderWorld = () => {
    db.seed("profiles", [{ id: USER_UUID, role: "customer", full_name: "Khách", points: 100, rank: "Tin cậy", red_ban_until: null }]);
    db.seed("stores", [{ id: STORE_UUID, owner_id: "own-1", name: "Tiệm A", status: "active" }]);
    db.seed("seller_reputation", [{ seller_id: STORE_UUID, trust_score: 100, rating_avg: 5, status: "Active" }]);
    db.seed("products", [{
      id: PRODUCT_UUID, store_id: STORE_UUID, name: "Cơm hộp", price_cents: 25000, original_price_cents: 50000,
      stock_quantity: 10, sold_count: 0, is_active: true, category: "cooked", label: "yellow",
      expires_at: iso(8 * HOUR), effective_deadline_at: iso(8 * HOUR), emoji: "🍱",
      estimated_weight_kg: 0.4, servings_count: 1, blocked_reason: null
    }]);
    db.seed("vouchers", [{
      id: VOUCHER_UUID, code: "SAVE5K", store_id: STORE_UUID, percent_off: null, fixed_discount_cents: 5000,
      min_order_cents: 10000, max_redemptions: 10, redemption_count: 0,
      starts_at: iso(-HOUR), expires_at: iso(24 * HOUR), is_active: true
    }]);
  };

  seedOrderWorld();
  env.ORDER_ATOMIC_RPC_ENABLED = true;

  const rpcCalls = [];
  rpcHook = (name, args, fallback) => {
    rpcCalls.push({ name, args });
    if (name === "fs_reserve_order_stock") {
      db.table("products")[0].stock_quantity -= args.p_items[0].quantity;
      db.table("products")[0].sold_count += args.p_items[0].quantity;
      if (args.p_voucher_id) db.table("vouchers")[0].redemption_count += 1;
      return Promise.resolve({ data: { reserved_count: 1, voucher_redeemed: true }, error: null });
    }
    if (name === "fs_restore_order_stock_atomic") {
      db.table("products")[0].stock_quantity += 2;
      db.table("products")[0].sold_count -= 2;
      return Promise.resolve({ data: { order_id: args.p_order_id, restored_items: 1 }, error: null });
    }
    return fallback();
  };

  const created = await orderService.createOrder(USER_UUID, {
    items: [{ product_id: PRODUCT_UUID, quantity: 2 }],
    pickup_slot_key: "policy",
    payment_method: "momo",
    voucher_code: "SAVE5K",
    donation_cents: 0
  });
  assert.equal(rpcCalls[0].name, "fs_reserve_order_stock");
  assert.deepEqual(rpcCalls[0].args, {
    p_items: [{ product_id: PRODUCT_UUID, quantity: 2 }],
    p_voucher_id: VOUCHER_UUID
  });
  assert.equal(db.table("products")[0].stock_quantity, 8);
  assert.equal(db.table("vouchers")[0].redemption_count, 1);

  await orderService.restoreStock(created.order.id, "always", "payment_timeout");
  const restoreCall = rpcCalls.find((c) => c.name === "fs_restore_order_stock_atomic");
  assert.deepEqual(restoreCall.args, { p_order_id: created.order.id, p_restore_voucher: true });
  assert.equal(db.table("products")[0].stock_quantity, 10);

  // Fallback on PGRST202 / 42883
  rpcHook = (name, args, fallback) => {
    if (name === "fs_reserve_order_stock") return Promise.resolve({ data: null, error: { code: "PGRST202", message: "not found in schema cache" } });
    if (name === "fs_restore_order_stock_atomic") return Promise.resolve({ data: null, error: { code: "42883", message: "undefined_function" } });
    return fallback();
  };

  const createdFallback = await orderService.createOrder(USER_UUID, {
    items: [{ product_id: PRODUCT_UUID, quantity: 1 }],
    pickup_slot_key: "policy",
    payment_method: "momo",
    donation_cents: 0
  });
  assert.equal(db.table("products")[0].stock_quantity, 9, "JS fallback must decrement stock");
  await orderService.restoreStock(createdFallback.order.id, "always", "customer_cancel");
  assert.equal(db.table("products")[0].stock_quantity, 10, "JS fallback must restore stock");

  // Decoupled momoPaymentService.applyMockWebhook triggers orderService.markPaidBySystem without circular import
  const paidViaWebhook = await momoPaymentService.applyMockWebhook({ order_id: createdFallback.order.id, resultCode: 0 });
  assert.equal(paidViaWebhook.payment_status, "paid");
});

test("ledgerService calls fs_settle_order & fs_refund_order when ORDER_ATOMIC_RPC_ENABLED=true and falls back on 42883/PGRST202", async () => {
  resetState();
  env.ORDER_ATOMIC_RPC_ENABLED = true;
  const order = {
    id: ORDER_UUID,
    store_id: STORE_UUID,
    total_cents: 32000,
    platform_fee_cents: 2000,
    donation_cents: 5000
  };

  const calls = [];
  rpcHook = (name, args, fallback) => {
    calls.push({ name, args });
    if (name === "fs_settle_order" || name === "fs_refund_order") {
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    return fallback();
  };

  await ledgerService.settleOrder(order, "completed");
  assert.deepEqual(calls[0], {
    name: "fs_settle_order",
    args: {
      p_order_id: ORDER_UUID,
      p_store_id: STORE_UUID,
      p_store_cents: 25000,
      p_fee_cents: 2000,
      p_donation_cents: 5000,
      p_reason: "completed"
    }
  });

  // Refund from escrow (not yet released)
  await ledgerService.refundOrder(order, { reason: "store_cancel" });
  assert.deepEqual(calls[1], {
    name: "fs_refund_order",
    args: {
      p_order_id: ORDER_UUID,
      p_store_id: STORE_UUID,
      p_refund_cents: 32000,
      p_from_released: false,
      p_fee_cents: 0,
      p_donation_cents: 0,
      p_reason: "store_cancel"
    }
  });

  // Refund clawback (already released, partial 26000 = 25000 store + 1000 fee)
  db.seed("ledger_entries", [{ id: "le-1", order_id: ORDER_UUID, idempotency_key: `order:${ORDER_UUID}:release:store` }]);
  await ledgerService.refundOrder(order, { amount: 26000, reason: "complaint" });
  assert.deepEqual(calls[2], {
    name: "fs_refund_order",
    args: {
      p_order_id: ORDER_UUID,
      p_store_id: STORE_UUID,
      p_refund_cents: 26000,
      p_from_released: true,
      p_fee_cents: 1000,
      p_donation_cents: 0,
      p_reason: "complaint"
    }
  });

  // Fallback on 42883/PGRST202 posts via fs_post_ledger
  resetState();
  env.ORDER_ATOMIC_RPC_ENABLED = true;
  rpcHook = (name, args, fallback) => {
    if (name === "fs_settle_order") return Promise.resolve({ data: null, error: { code: "42883", message: "missing" } });
    if (name === "fs_refund_order") return Promise.resolve({ data: null, error: { code: "PGRST202", message: "missing" } });
    return fallback();
  };
  await ledgerService.holdCharge(order);
  await ledgerService.settleOrder(order, "completed");
  assert.equal(db.wallet(db.storeWalletId(STORE_UUID)).balance_cents, 25000);
  await ledgerService.refundOrder(order, { amount: 26000, reason: "complaint" });
  assert.equal(db.wallet(db.storeWalletId(STORE_UUID)).balance_cents, 0);
  assert.equal(db.wallet("w-platform").balance_cents, 1000);
});

test("sellerReputationService uses fs_seller_reputation_apply_delta when flag enabled or !isPostgresAvailable, with 42883/PGRST202 fallback", async () => {
  resetState();
  pgModule.isPostgresAvailable = async () => false;

  const calls = [];
  rpcHook = (name, args, fallback) => {
    calls.push({ name, args });
    if (name === "fs_seller_reputation_apply_delta") {
      return Promise.resolve({
        data: {
          seller_id: args.p_store_id,
          trust_score: 85,
          trust_score_before: 100,
          rating_avg: 4.8,
          status: "Active",
          restricted_until: null,
          created_at: iso(-HOUR),
          updated_at: iso(0),
          status_changed: false,
          violation_recorded: Boolean(args.p_violation_type)
        },
        error: null
      });
    }
    return fallback();
  };

  const rep = await sellerReputationService.handleSellerCancellation(STORE_UUID, ORDER_UUID);
  assert.equal(rep.trust_score, 85);
  assert.deepEqual(calls[0], {
    name: "fs_seller_reputation_apply_delta",
    args: {
      p_store_id: STORE_UUID,
      p_delta: -15,
      p_violation_type: "SELLER_CANCELLED_ORDER",
      p_reason: "Seller hủy đơn do hết hàng ảo",
      p_order_id: ORDER_UUID
    }
  });

  // 42883 / PGRST202 -> never crashes, returns fallback reputation
  db.seed("seller_reputation", [{
    seller_id: STORE_UUID, trust_score: 92, rating_avg: 4.9, status: "Active",
    restricted_until: null, created_at: iso(-HOUR), updated_at: iso(0)
  }]);
  rpcHook = (name) => {
    if (name === "fs_seller_reputation_apply_delta") {
      return Promise.resolve({ data: null, error: { code: "PGRST202", message: "not found" } });
    }
    return db.rpc(name, {});
  };
  const fallbackRep = await sellerReputationService.handleOrderSuccess(STORE_UUID, false);
  assert.equal(fallbackRep.trust_score, 92);
  assert.equal(fallbackRep.status, "Active");

  // MINOR-5: getSellerReputation reads existing row directly without calling write-locking RPC
  const getCalls = [];
  rpcHook = (name, args, fallback) => {
    getCalls.push({ name, args });
    if (name === "fs_seller_reputation_apply_delta") {
      return Promise.resolve({
        data: {
          seller_id: args.p_store_id,
          trust_score: 100,
          rating_avg: 5,
          status: "Active",
          restricted_until: null,
          created_at: iso(-HOUR),
          updated_at: iso(0)
        },
        error: null
      });
    }
    return fallback();
  };
  const existingGet = await sellerReputationService.getSellerReputation(STORE_UUID);
  assert.equal(existingGet.trust_score, 92);
  assert.equal(getCalls.length, 0, "pure GET must not call locking RPC when row already exists");

  // Lazy-create via RPC only when no row exists yet
  const missingStoreId = "66666666-6666-4666-8666-666666666666";
  const lazyGet = await sellerReputationService.getSellerReputation(missingStoreId);
  assert.equal(lazyGet.seller_id, missingStoreId);
  assert.equal(getCalls.length, 1);
  assert.equal(getCalls[0].name, "fs_seller_reputation_apply_delta");
  assert.equal(getCalls[0].args.p_delta, 0);
});

test("MINOR-8: orderService.getOrder signs private complaint evidence URLs (image_urls & store_response_images) and masks customer admin_note", async () => {
  resetState();
  const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
  const privateBuyerUrl = `${baseUrl}/storage/v1/object/authenticated/complaint-evidence/complaints/${ORDER_UUID}/${USER_UUID}/buyer.jpg`;
  const privateStoreUrl = `${baseUrl}/storage/v1/object/authenticated/complaint-evidence/complaints/${ORDER_UUID}/own-1/store.jpg`;
  const legacyPublicUrl = `${baseUrl}/storage/v1/object/public/partner-assets/complaints/${ORDER_UUID}/legacy.jpg`;

  db.seed("stores", [{ id: STORE_UUID, owner_id: "own-1", name: "Tiệm A", slug: "tiem-a", emoji: "🍱", address: "Q1" }]);
  db.seed("orders", [{
    id: ORDER_UUID,
    order_number: "FS-SIGN-1",
    customer_id: USER_UUID,
    store_id: STORE_UUID,
    status: "completed",
    payment_status: "paid",
    qr_code: "QR-TEST"
  }]);
  db.seed("complaints", [{
    id: "cmp-1",
    order_id: ORDER_UUID,
    customer_id: USER_UUID,
    store_id: STORE_UUID,
    image_urls: [privateBuyerUrl, legacyPublicUrl],
    store_response_images: [privateStoreUrl],
    admin_note: "internal-only"
  }]);

  const signedPaths = [];
  sb.supabaseAdmin.storage = {
    from: (bucket) => ({
      createSignedUrl: async (objectPath, ttl) => {
        signedPaths.push({ bucket, objectPath, ttl });
        return { data: { signedUrl: `${baseUrl}/signed/${bucket}/${objectPath}?ttl=${ttl}` }, error: null };
      }
    })
  };

  try {
    const order = await orderService.getOrder(USER_UUID, "customer", ORDER_UUID);
    assert.equal(order.complaints.length, 1);
    assert.equal(order.complaints[0].admin_note, null, "customer must not see admin_note");
    assert.equal(
      order.complaints[0].image_urls[0],
      `${baseUrl}/signed/complaint-evidence/complaints/${ORDER_UUID}/${USER_UUID}/buyer.jpg?ttl=600`
    );
    assert.equal(order.complaints[0].image_urls[1], legacyPublicUrl, "public legacy URL stays unchanged");
    assert.equal(
      order.complaints[0].store_response_images[0],
      `${baseUrl}/signed/complaint-evidence/complaints/${ORDER_UUID}/own-1/store.jpg?ttl=600`
    );
    assert.equal(signedPaths.length, 2);
  } finally {
    delete sb.supabaseAdmin.storage;
  }
});

test("locationService calls fs_report_live_location when LOCATION_RPC_ENABLED=true and falls back cleanly on 42883/PGRST202", async () => {
  resetState();
  env.LOCATION_RPC_ENABLED = true;
  db.seed("orders", [{ id: ORDER_UUID, customer_id: USER_UUID, payment_status: "paid", status: "confirmed" }]);
  db.seed("location_consents", [{ actor_kind: "customer", actor_id: USER_UUID, granted: true }]);

  const calls = [];
  rpcHook = (name, args, fallback) => {
    calls.push({ name, args });
    if (name === "fs_report_live_location") {
      return Promise.resolve({ data: { stored: true, throttled: false, reason: "ok" }, error: null });
    }
    return fallback();
  };

  const res = await locationService.report(
    { kind: "customer", id: USER_UUID },
    { lat: 10.78, lng: 106.7, accuracy_m: 15, heading: 90, speed_mps: 3.5, context: { kind: "order", id: ORDER_UUID } }
  );
  assert.deepEqual(res, { stored: true, throttled: false });
  assert.deepEqual(calls[0], {
    name: "fs_report_live_location",
    args: {
      p_actor_kind: "customer",
      p_actor_id: USER_UUID,
      p_latitude: 10.78,
      p_longitude: 106.7,
      p_accuracy_m: 15,
      p_heading: 90,
      p_speed_mps: 3.5,
      p_min_interval_sec: 55,
      p_context_kind: "order",
      p_context_id: ORDER_UUID,
      p_recorded_at: null
    }
  });

  // Consent revoked from RPC -> 403 LOCATION_CONSENT_REVOKED
  rpcHook = () => Promise.resolve({ data: { stored: false, throttled: false, reason: "consent_revoked" }, error: null });
  await assert.rejects(
    () => locationService.report({ kind: "customer", id: USER_UUID }, { lat: 10.78, lng: 106.7, context: { kind: "order", id: ORDER_UUID } }),
    (err) => err.statusCode === 403 && err.code === "LOCATION_CONSENT_REVOKED"
  );

  // Fallback on 42883 -> writes to live_locations via JS path
  rpcHook = () => Promise.resolve({ data: null, error: { code: "42883", message: "undefined_function" } });
  const fbRes = await locationService.report(
    { kind: "customer", id: USER_UUID },
    { lat: 10.79, lng: 106.71, accuracy_m: 10, context: { kind: "order", id: ORDER_UUID } }
  );
  assert.deepEqual(fbRes, { stored: true, throttled: false });
  assert.equal(db.table("live_locations").length, 1);
  assert.equal(db.table("live_locations")[0].lat, 10.79);
});
