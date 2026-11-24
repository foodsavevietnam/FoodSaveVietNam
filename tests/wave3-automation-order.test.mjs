import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import vm from "node:vm";

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
  AUTOMATION_ENABLED: "false"
});

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const { FakeDb } = require("../scripts/fake-supabase");

let db = new FakeDb();
let fromHook = null;
const sb = require("../dist/config/supabase");
sb.supabaseAdmin = {
  from: (name) => (fromHook ? fromHook(name, () => db.from(name)) : db.from(name)),
  rpc: (name, args) => db.rpc(name, args)
};
require("../dist/config/postgres").isPostgresAvailable = async () => false;

const { env } = require("../dist/config/env");
const { priceForLabel } = require("../dist/utils/productExpiryLabel");
const { orderService } = require("../dist/services/orderService");
const { orderAutomationService } = require("../dist/services/orderAutomationService");
const { labelAutomationService } = require("../dist/services/labelAutomationService");
const { automationRunService } = require("../dist/services/automationRunService");
const { complaintService } = require("../dist/services/complaintService");
const { customerReputationService } = require("../dist/services/customerReputationService");
const policyModule = require("../dist/constants/orderPolicy");

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

function resetDb() {
  db = new FakeDb();
  fromHook = null;
  db.seedSystemWallets();
}

/** Biên dịch trực tiếp file Netlify Function (.ts) trong bộ nhớ để chạy đúng handler thật */
function loadNetlifyFunction(relPath) {
  const source = readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8");
  const { code } = esbuild.transformSync(source, { loader: "ts", format: "cjs", target: "node20" });
  const mod = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier.startsWith("../../src/")) {
      return require("../dist/" + specifier.slice("../../src/".length));
    }
    return require(specifier);
  };
  const fn = new vm.Script(`(function(exports, require, module) {\n${code}\n})`).runInThisContext();
  fn(mod.exports, customRequire, mod);
  return mod.exports;
}

test("Scheduled Functions (label-automation & order-automation) trả { skipped: true } khi AUTOMATION_ENABLED=false", async () => {
  resetDb();
  const labelFn = loadNetlifyFunction("netlify/functions/label-automation.ts");
  const orderFn = loadNetlifyFunction("netlify/functions/order-automation.ts");

  const prev = env.AUTOMATION_ENABLED;
  try {
    env.AUTOMATION_ENABLED = false;

    const labelRes = await labelFn.handler();
    assert.equal(labelRes.statusCode, 200);
    const labelBody = JSON.parse(labelRes.body);
    assert.equal(labelBody.skipped, true);

    const orderRes = await orderFn.handler();
    assert.equal(orderRes.statusCode, 200);
    const orderBody = JSON.parse(orderRes.body);
    assert.equal(orderBody.skipped, true);
    assert.equal(db.table("automation_runs").length, 0, "khi tắt automation không ghi automation_runs");

    // Khi bật AUTOMATION_ENABLED=true thì chạy bình thường và trả JSON hợp lệ
    env.AUTOMATION_ENABLED = true;
    const activeLabelRes = await labelFn.handler();
    assert.equal(activeLabelRes.statusCode, 200);
    const activeLabelBody = JSON.parse(activeLabelRes.body);
    assert.equal(activeLabelBody.budget_reached, false);
    assert.equal(activeLabelBody.checked, 0);

    const activeOrderRes = await orderFn.handler();
    assert.equal(activeOrderRes.statusCode, 200);
    const activeOrderBody = JSON.parse(activeOrderRes.body);
    assert.equal(activeOrderBody.budget_reached, false);
  } finally {
    env.AUTOMATION_ENABLED = prev;
  }
});

test("P2-2e: priceForLabel ép giá sàn 1.000đ cho hàng bán giá gốc 1.000–2.499đ ở nhãn đỏ", () => {
  assert.equal(priceForLabel(1000, "red"), 1000);
  assert.equal(priceForLabel(1500, "red"), 1000);
  assert.equal(priceForLabel(2000, "red"), 1000);
  assert.equal(priceForLabel(2499, "red"), 1000);
  assert.equal(priceForLabel(2500, "red"), 1000);
  assert.equal(priceForLabel(10000, "red"), 2000);
  assert.equal(priceForLabel(50000, "red"), 10000);
  assert.equal(priceForLabel(1000, "yellow"), 1000);
  assert.equal(priceForLabel(1000, "green"), 1000);
  // Hàng miễn phí / giá gốc < 1000 giữ quy tắc cũ
  assert.equal(priceForLabel(0, "red"), 0);
  assert.equal(priceForLabel(500, "red"), 100);
});

test("P2-2a/b: createOrder chỉ xóa đúng product_id đã đặt khỏi cart_items; legacy markPaid đặt settlement_status='held' và đồng bộ sổ cái", async () => {
  resetDb();
  db.seed("profiles", [
    { id: "cust-1", role: "customer", full_name: "Khách 1", points: 100, rank: "Tin cậy", red_ban_until: null },
    { id: "cust-2", role: "customer", full_name: "Khách 2", points: 100, rank: "Tin cậy", red_ban_until: null }
  ]);
  db.seed("stores", [{ id: "st-1", owner_id: "own-1", name: "Tiệm A", status: "active" }]);
  db.seed("seller_reputation", [{ seller_id: "st-1", trust_score: 100, rating_avg: 5, status: "Active" }]);
  const mkProd = (id) => ({
    id, store_id: "st-1", name: "Món " + id, price_cents: 25000, original_price_cents: 50000,
    stock_quantity: 10, sold_count: 0, is_active: true, category: "cooked", label: "yellow",
    expires_at: iso(8 * HOUR), effective_deadline_at: iso(8 * HOUR), emoji: "🍱",
    estimated_weight_kg: 0.4, servings_count: 1, blocked_reason: null
  });
  db.seed("products", [mkProd("p-1"), mkProd("p-2")]);
  db.seed("cart_items", [
    { id: "ci-1", user_id: "cust-1", product_id: "p-1", quantity: 1 },
    { id: "ci-2", user_id: "cust-1", product_id: "p-2", quantity: 2 },
    { id: "ci-3", user_id: "cust-2", product_id: "p-1", quantity: 1 }
  ]);

  await orderService.createOrder("cust-1", {
    items: [{ product_id: "p-1", quantity: 1 }],
    pickup_slot_key: "policy",
    payment_method: "momo",
    donation_cents: 0
  });

  const remainingCart = db.table("cart_items");
  assert.deepEqual(
    remainingCart.map((c) => `${c.user_id}:${c.product_id}`).sort(),
    ["cust-1:p-2", "cust-2:p-1"],
    "chỉ xóa đúng món đã đặt của khách đặt đơn, giữ lại món khác trong giỏ"
  );

  // Nhánh đơn legacy trong markPaid (status !== 'awaiting_payment')
  db.seed("orders", [{
    id: "ord-legacy",
    order_number: "FS-LEG-1",
    customer_id: "cust-1",
    store_id: "st-1",
    status: "pending",
    payment_status: "pending",
    settlement_status: "none",
    subtotal_cents: 25000,
    discount_cents: 0,
    platform_fee_cents: 2000,
    donation_cents: 0,
    total_cents: 27000
  }]);

  const legacyOrder = db.table("orders").find((o) => o.id === "ord-legacy");
  const paidLegacy = await orderService.markPaid(legacyOrder, "momo");
  assert.equal(paidLegacy.payment_status, "paid");
  assert.equal(paidLegacy.settlement_status, "held", "đơn legacy phải chuyển settlement_status='held'");
  assert.equal(db.wallet("w-escrow").balance_cents, 27000, "đơn legacy phải đồng bộ sổ cái vào ví escrow");
  assert.equal(db.table("ledger_entries").filter((e) => e.order_id === "ord-legacy").length, 1);
});

test("BE-DOMAIN-17: customerReputationService dùng RED_BAN_DAYS động từ orderPolicy trong thông báo khóa nhãn đỏ", async () => {
  resetDb();
  const prevPolicy = policyModule.currentPolicy();
  try {
    policyModule.applyPolicy({ ...prevPolicy, red_ban_days: 14 });
    db.seed("profiles", [{ id: "cust-ban", role: "customer", full_name: "Khách", points: 100, rank: "Tin cậy", red_ban_until: null }]);
    db.seed("orders", [
      { id: "o-1", customer_id: "cust-ban", status: "no_show", no_show_at: iso(-3 * HOUR) },
      { id: "o-2", customer_id: "cust-ban", status: "no_show", no_show_at: iso(-2 * HOUR) },
      { id: "o-3", customer_id: "cust-ban", status: "no_show", no_show_at: iso(-HOUR) }
    ]);

    const res = await customerReputationService.recordNoShow("cust-ban", "o-3");
    assert.equal(res.banned, true);
    const note = db.table("notifications").find((n) => n.type === "red-label-banned");
    assert.ok(note, "phải gửi thông báo red-label-banned");
    assert.ok(note.title.includes("14 ngày"), `tiêu đề phải dùng RED_BAN_DAYS=14, nhận: ${note.title}`);
    assert.ok(!note.title.includes("30 ngày"), "không được hardcode 30 ngày");
  } finally {
    policyModule.applyPolicy(prevPolicy);
  }
});

test("P2-2c: complaintService.completePendingOutcomes() đánh dấu outcome_applied_at và fallback khi thiếu cột (42703)", async () => {
  resetDb();
  db.seed("stores", [{ id: "st-1", owner_id: "own-1", name: "Tiệm 1", status: "active" }]);
  db.seed("seller_reputation", [{ seller_id: "st-1", trust_score: 100, rating_avg: 5, status: "Active" }]);

  // 55 khiếu nại cũ đã hoàn tất + 1 khiếu nại mới nhất chưa áp dụng
  for (let i = 1; i <= 55; i += 1) {
    db.seed("orders", [{
      id: `o-old-${i}`, order_number: `FS-O${i}`, customer_id: "cust-1", store_id: "st-1",
      status: "completed", payment_status: "refunded", settlement_status: "refunded",
      subtotal_cents: 20000, discount_cents: 0, platform_fee_cents: 2000, donation_cents: 0, total_cents: 22000
    }]);
    db.seed("complaints", [{
      id: `c-old-${i}`, order_id: `o-old-${i}`, customer_id: "cust-1", store_id: "st-1",
      status: "resolved", decision: "refund_full", refund_cents: 22000,
      decided_at: iso(-(100 - i) * MIN), outcome_applied_at: iso(-(100 - i) * MIN)
    }]);
  }
  db.seed("orders", [{
    id: "o-new", order_number: "FS-NEW", customer_id: "cust-1", store_id: "st-1",
    status: "completed", payment_status: "paid", settlement_status: "released",
    subtotal_cents: 30000, discount_cents: 0, platform_fee_cents: 2000, donation_cents: 0, total_cents: 32000
  }]);
  db.seed("complaints", [{
    id: "c-new", order_id: "o-new", customer_id: "cust-1", store_id: "st-1",
    status: "resolved", decision: "refund_full", refund_cents: 32000,
    decided_at: iso(-MIN), outcome_applied_at: null
  }]);

  const done1 = await complaintService.completePendingOutcomes();
  assert.equal(done1, 1);
  assert.equal(db.table("orders").find((o) => o.id === "o-new").settlement_status, "refunded");
  assert.ok(db.table("complaints").find((c) => c.id === "c-new").outcome_applied_at, "phải ghi outcome_applied_at");

  // Giả lập DB chưa chạy SQL 041 (lỗi 42703 khi lọc theo outcome_applied_at)
  db.seed("orders", [{
    id: "o-fb", order_number: "FS-FB", customer_id: "cust-1", store_id: "st-1",
    status: "completed", payment_status: "paid", settlement_status: "released",
    subtotal_cents: 20000, discount_cents: 0, platform_fee_cents: 2000, donation_cents: 0, total_cents: 22000
  }]);
  db.seed("complaints", [{
    id: "c-fb", order_id: "o-fb", customer_id: "cust-1", store_id: "st-1",
    status: "resolved", decision: "refund_full", refund_cents: 22000,
    decided_at: iso(-1000)
  }]);

  let sawMissingColumnFallback = false;
  fromHook = (name, createQuery) => {
    const q = createQuery();
    if (name !== "complaints") return q;
    const origIs = q.is.bind(q);
    let touchedOutcomeCol = false;
    q.is = (col, val) => {
      if (col === "outcome_applied_at") touchedOutcomeCol = true;
      return origIs(col, val);
    };
    const origRun = q.run.bind(q);
    q.run = () => {
      if (touchedOutcomeCol) {
        sawMissingColumnFallback = true;
        return { data: null, error: { code: "42703", message: 'column complaints.outcome_applied_at does not exist' }, count: null };
      }
      return origRun();
    };
    return q;
  };

  const done2 = await complaintService.completePendingOutcomes();
  assert.equal(sawMissingColumnFallback, true, "phải kích hoạt nhánh fallback 42703");
  assert.equal(done2, 1, "nhánh fallback vẫn tìm thấy khiếu nại mới nhất sau > 50 bản ghi cũ");
  assert.equal(db.table("orders").find((o) => o.id === "o-fb").settlement_status, "refunded");
});

test("M-3a: fake-supabase.js so sánh đúng số thực tọa độ (10.77 < 10.78), chuỗi ISO date và đồng bộ admin_note trên start/pay", async () => {
  resetDb();
  db.seed("stores", [
    { id: "s-1", latitude: 10.76, longitude: 106.68, created_at: "2026-11-20T01:00:00Z" },
    { id: "s-2", latitude: 10.77, longitude: 106.69, created_at: "2026-11-21T01:00:00Z" },
    { id: "s-3", latitude: 10.78, longitude: 106.70, created_at: "2026-11-22T01:00:00Z" },
    { id: "s-4", latitude: -10.5, longitude: 106.75, created_at: "2026-11-23T01:00:00+07:00" }
  ]);

  const ltLat = await db.from("stores").select("id").gt("latitude", 10.76).lt("latitude", 10.78);
  assert.deepEqual(ltLat.data.map((r) => r.id), ["s-2"], "10.76 < 10.77 < 10.78");

  const lteGteLng = await db.from("stores").select("id").gte("longitude", 106.69).lte("longitude", 106.70);
  assert.deepEqual(lteGteLng.data.map((r) => r.id).sort(), ["s-2", "s-3"]);

  const negLat = await db.from("stores").select("id").lt("latitude", 0);
  assert.deepEqual(negLat.data.map((r) => r.id), ["s-4"]);

  // ISO date có múi giờ khác nhau: 2026-11-23T01:00:00+07:00 == 2026-11-22T18:00:00Z > 2026-11-22T01:00:00Z
  const afterDate = await db.from("stores").select("id").gt("created_at", "2026-11-22T00:00:00Z");
  assert.deepEqual(afterDate.data.map((r) => r.id).sort(), ["s-3", "s-4"]);

  const beforeTz = await db.from("stores").select("id").lt("created_at", "2026-11-22T19:00:00Z").gte("created_at", "2026-11-22T01:00:00Z");
  assert.deepEqual(beforeTz.data.map((r) => r.id).sort(), ["s-3", "s-4"]);

  // Đồng bộ admin_note trong fs_withdrawal_transition ở nhánh start & pay
  const wId = db.storeWalletId("st-1");
  db.wallet(wId).balance_cents = 500000;
  db.seed("withdrawals", [{
    id: "wd-1", store_id: "st-1", amount_cents: 100000, status: "approved",
    bank_name: "VCB", account_last4: "1234", admin_note: "note-approve"
  }]);

  const started = await db.rpc("fs_withdrawal_transition", { p_id: "wd-1", p_action: "start", p_actor: "adm-1", p_note: "note-start", p_ref: "P-1" });
  assert.equal(started.error, null);
  assert.equal(started.data.admin_note, "note-start", "nhánh start phải cập nhật admin_note");

  // Khi p_note = null ở nhánh pay -> giữ nguyên admin_note trước đó (coalesce)
  const paidKeep = await db.rpc("fs_withdrawal_transition", { p_id: "wd-1", p_action: "pay", p_actor: "adm-1", p_note: null, p_ref: "FT-1" });
  assert.equal(paidKeep.error, null);
  assert.equal(paidKeep.data.admin_note, "note-start", "nhánh pay giữ nguyên admin_note khi p_note null");

  // Khi p_note có giá trị ở nhánh pay -> cập nhật admin_note
  db.seed("withdrawals", [{
    id: "wd-2", store_id: "st-1", amount_cents: 100000, status: "approved",
    bank_name: "VCB", account_last4: "1234", admin_note: "note-old"
  }]);
  const paidNew = await db.rpc("fs_withdrawal_transition", { p_id: "wd-2", p_action: "pay", p_actor: "adm-1", p_note: "note-paid", p_ref: "FT-2" });
  assert.equal(paidNew.error, null);
  assert.equal(paidNew.data.admin_note, "note-paid", "nhánh pay phải cập nhật admin_note khi có p_note");
});

test("BE-DOMAIN-13 & OPS-17: automationRunService.purgeOldRuns() dọn bản ghi cũ và overview() đếm đủ > 400 dòng trong 7 ngày", async () => {
  resetDb();
  const rows = [];
  // 450 dòng trong 7 ngày qua (vượt ngưỡng cắt 400 cũ) + 5 dòng cũ > 30 ngày
  for (let i = 0; i < 450; i += 1) {
    rows.push({
      id: `run-new-${i}`,
      job: "order-automation",
      trigger: "schedule",
      started_at: iso(-(i + 1) * MIN),
      finished_at: iso(-(i + 1) * MIN + 1000),
      ok: i !== 440,
      summary: {},
      error: i === 440 ? "old-fail-in-7d" : null
    });
  }
  for (let i = 0; i < 5; i += 1) {
    rows.push({
      id: `run-old-${i}`,
      job: "order-automation",
      trigger: "schedule",
      started_at: iso(-(35 + i) * DAY),
      finished_at: iso(-(35 + i) * DAY + 1000),
      ok: true,
      summary: {},
      error: null
    });
  }
  db.seed("automation_runs", rows);

  const ov = await automationRunService.overview();
  const orderJob = ov.find((j) => j.job === "order-automation");
  assert.equal(orderJob.runs_7d, 450, "phải đếm đủ 450 lần chạy trong 7 ngày, không bị cắt ở 400");
  assert.equal(orderJob.failures_7d, 1, "phải đếm đúng lỗi nằm sau dòng thứ 400");
  assert.equal(orderJob.last_failure.error, "old-fail-in-7d");
  assert.equal(orderJob.recent.length, 5);

  const purged = await automationRunService.purgeOldRuns(30, 1000);
  assert.equal(purged, 5, "phải xóa đúng 5 dòng cũ hơn 30 ngày");
  assert.equal(db.table("automation_runs").length, 450, "giữ nguyên 450 dòng trong 30 ngày");
});

test("P2-4: orderAutomationService & labelAutomationService tôn trọng timeBudgetMs, dọn automation_runs và rollback charity offer khi xung đột kho", async () => {
  resetDb();
  // 1. orderAutomationService: hết ngân sách thời gian ngay lập tức (timeBudgetMs = 0)
  db.seed("orders", [{
    id: "o-timeout", order_number: "FS-TO", customer_id: "cust-1", store_id: "st-1",
    status: "awaiting_payment", payment_status: "pending", pay_deadline: iso(-MIN)
  }]);
  db.seed("automation_runs", [{
    id: "old-run-1", job: "label-automation", trigger: "schedule",
    started_at: iso(-40 * DAY), finished_at: iso(-40 * DAY), ok: true, summary: {}, error: null
  }]);

  const budgetedOrder = await orderAutomationService.run("schedule", { timeBudgetMs: 0 });
  assert.equal(budgetedOrder.budget_reached, true);
  assert.equal(budgetedOrder.payment_timeouts, 0, "khi hết timeBudgetMs không xử lý tiếp");
  assert.equal(budgetedOrder.runs_purged, 0);
  assert.equal(db.table("orders")[0].status, "awaiting_payment");

  // Chạy đủ ngân sách thời gian -> xử lý timeout + dọn automation_runs cũ > 30 ngày
  const fullOrder = await orderAutomationService.run("schedule", { timeBudgetMs: 20_000 });
  assert.equal(fullOrder.budget_reached, false);
  assert.equal(fullOrder.payment_timeouts, 1);
  assert.equal(fullOrder.runs_purged, 1, "bước cuối orderAutomationService.run phải dọn automation_runs > 30 ngày");
  assert.ok(!db.table("automation_runs").some((r) => r.id === "old-run-1"));

  // 2. labelAutomationService: tôn trọng timeBudgetMs = 0
  db.seed("stores", [{
    id: "st-1", owner_id: "own-1", name: "Tiệm Bánh", status: "active",
    opening_schedule: null, charity_transfer_enabled: true
  }]);
  db.seed("products", [{
    id: "p-red-charity", store_id: "st-1", name: "Bánh mì tối", category: "cooked", food_group: "cooked",
    expires_at: iso(3 * HOUR), original_price_cents: 20000, price_cents: 10000,
    label: "yellow", stock_quantity: 10, estimated_weight_kg: 0.3, is_donation: false, is_active: true,
    effective_deadline_at: null, yellow_notified_at: iso(-HOUR), red_notified_at: null,
    red_last_notified_at: null, red_reminder_count: 0
  }]);

  const budgetedLabel = await labelAutomationService.run({ timeBudgetMs: 0 });
  assert.equal(budgetedLabel.budget_reached, true);
  assert.equal(budgetedLabel.checked, 0);

  // 3. labelAutomationService: rollback bản ghi donations khi khách mua xen giữa làm stock_quantity đổi trước lúc trừ kho
  fromHook = (name, createQuery) => {
    const q = createQuery();
    if (name !== "donations") return q;
    const origInsert = q.insert.bind(q);
    q.insert = (rows) => {
      // Giả lập có khách vừa mua 1 món ngay khi donation được chèn -> stock_quantity đổi từ 10 sang 9
      const prod = db.table("products").find((p) => p.id === "p-red-charity");
      if (prod && prod.stock_quantity === 10) prod.stock_quantity = 9;
      return origInsert(rows);
    };
    return q;
  };

  const raceLabel = await labelAutomationService.run({ timeBudgetMs: 20_000 });
  assert.equal(raceLabel.budget_reached, false);
  assert.equal(raceLabel.checked, 1);
  assert.equal(raceLabel.donations_created, 0, "khi optimistic lock cập nhật 0 dòng không được tính donations_created");
  assert.equal(db.table("donations").length, 0, "phải xóa/hủy bản ghi donations vừa chèn để chống cấp phát trùng");
  assert.equal(db.table("products").find((p) => p.id === "p-red-charity").stock_quantity, 9, "giữ đúng tồn kho của khách mua");
  assert.equal(db.table("notifications").filter((n) => n.type === "charity-offer").length, 0, "không gửi thông báo charity-offer khi đã rollback");
});
