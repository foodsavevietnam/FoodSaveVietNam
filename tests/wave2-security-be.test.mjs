import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import crypto from "node:crypto";

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
  N8N_SECRET: "super-secret-n8n-token-2026"
});

const require = createRequire(import.meta.url);
const { FakeDb } = require("../scripts/fake-supabase");

let db = new FakeDb();
const sb = require("../dist/config/supabase");
const queryLog = [];

sb.supabaseAdmin = {
  from: (name) => {
    const q = db.from(name);
    const origOr = q.or.bind(q);
    const origSelect = q.select.bind(q);
    const entry = { table: name, select: null, orCalls: [] };
    queryLog.push(entry);
    q.select = (cols, opts) => {
      entry.select = cols;
      return origSelect(cols, opts);
    };
    q.or = (expr) => {
      entry.orCalls.push(expr);
      return origOr(expr);
    };
    return q;
  },
  rpc: (name, args) => db.rpc(name, args)
};

const pgConfig = require("../dist/config/postgres");
pgConfig.isPostgresAvailable = async () => false;

const commonSchemas = require("../dist/schemas/commonSchemas");
const adminSchemas = require("../dist/schemas/adminSchemas");
const { catalogService, PUBLIC_STORE_SELECT } = require("../dist/services/catalogService");
const { sellerReputationService } = require("../dist/services/sellerReputationService");
const { orderService } = require("../dist/services/orderService");
const { donationService } = require("../dist/services/donationService");
const { generateCode } = require("../dist/services/supabaseService");
const { marketingService, __internals: marketingInternals } = require("../dist/services/marketingService");
const { adminOpsService } = require("../dist/services/adminOpsService");
const { adminController } = require("../dist/controllers/adminController");
const { payoutAccountService } = require("../dist/services/payoutAccountService");
const { orderRoutes } = require("../dist/routes/orderRoutes");
const { env } = require("../dist/config/env");

const readRepoFile = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const HOUR = 3_600_000;

function resetDb() {
  db = new FakeDb();
  queryLog.length = 0;
  adminOpsService.clearWorkStripCache();
}

test("P1-2: sanitizeSearch dùng chung ở commonSchemas & re-export ở adminSchemas, chặn PostgREST .or() injection", async () => {
  resetDb();
  assert.strictEqual(commonSchemas.sanitizeSearch, adminSchemas.sanitizeSearch);
  assert.equal(commonSchemas.sanitizeSearch("banh,status.eq.pending,name.ilike.%"), "banh status.eq.pending name.ilike.");
  assert.equal(commonSchemas.sanitizeSearch("a,(b)%*\\"), "a  b");
  assert.equal(commonSchemas.sanitizeSearch(",()%*\\   "), "");
  assert.equal(commonSchemas.sanitizeSearch("x".repeat(120)).length, 80);

  db.seed("stores", [
    { id: "st-1", owner_id: "u-1", name: "Tiệm Bánh An", address: "12 Lê Lợi", status: "active", created_at: iso(-HOUR) }
  ]);
  db.seed("products", [
    {
      id: "pr-1",
      store_id: "st-1",
      name: "Bánh mì bơ tỏi",
      description: "Thơm giòn",
      is_active: true,
      stock_quantity: 5,
      expires_at: iso(6 * HOUR),
      price_cents: 20000,
      original_price_cents: 40000,
      label: "yellow",
      category: "bakery"
    }
  ]);

  // Tìm kiếm chỉ toàn ký tự đặc biệt -> bỏ qua .or()
  await catalogService.listStores({ page: 1, limit: 20, radius_km: 5, search: ",,,()%%*\\" });
  const storeQueryEmpty = queryLog.find((q) => q.table === "stores");
  assert.deepEqual(storeQueryEmpty.orCalls, []);

  queryLog.length = 0;
  await catalogService.listProducts({ page: 1, limit: 20, radius_km: 5, sort: "newest", search: "banh,is_active.eq.false" });
  const prodQuery = queryLog.find((q) => q.table === "products");
  assert.equal(prodQuery.orCalls.length, 1);
  assert.equal(
    prodQuery.orCalls[0],
    "name.ilike.%banh is_active.eq.false%,description.ilike.%banh is_active.eq.false%"
  );
});

test("P1-2: storeSelect loại bỏ cột nội bộ nhạy cảm nhưng giữ created_at; getStore/getProduct chặn cửa hàng không active", async () => {
  resetDb();
  const cols = PUBLIC_STORE_SELECT.split(",").map((c) => c.trim());
  assert.ok(cols.includes("created_at"), "storeSelect bắt buộc phải giữ created_at cho /admin/#/stores");
  assert.ok(cols.includes("id") && cols.includes("name") && cols.includes("status"));

  const forbiddenCols = [
    "*",
    "owner_id",
    "tax_code",
    "legal_name",
    "commission_rate",
    "rejection_reason",
    "onboarding_status",
    "marketing_auto",
    "facebook_page_id",
    "facebook_page_name",
    "marketing_channels"
  ];
  for (const col of forbiddenCols) {
    assert.ok(!cols.includes(col), `storeSelect không được chứa cột nhạy cảm: ${col}`);
  }

  db.seed("stores", [
    { id: "st-active", owner_id: "u-1", name: "Tiệm Active", status: "active", created_at: iso(-HOUR) },
    { id: "st-susp", owner_id: "u-2", name: "Tiệm Suspended", status: "suspended", created_at: iso(-HOUR) }
  ]);
  db.seed("products", [
    { id: "p-ok", store_id: "st-active", name: "Món OK", is_active: true, expires_at: iso(4 * HOUR) },
    { id: "p-bad", store_id: "st-susp", name: "Món Suspended", is_active: true, expires_at: iso(4 * HOUR) }
  ]);

  const activeStore = await catalogService.getStore("st-active");
  assert.equal(activeStore.id, "st-active");
  await assert.rejects(() => catalogService.getStore("st-susp"), (err) => err.statusCode === 404);

  const activeProd = await catalogService.getProduct("p-ok");
  assert.equal(activeProd.id, "p-ok");
  await assert.rejects(() => catalogService.getProduct("p-bad"), (err) => err.statusCode === 404);
});

test("P1-4(a): sellerReputationService chặn IDOR kể cả khi !isPostgresAvailable()", async () => {
  resetDb();
  db.seed("stores", [
    { id: "store-a", owner_id: "owner-a", name: "Tiệm A", status: "active" },
    { id: "store-b", owner_id: "owner-b", name: "Tiệm B", status: "active" }
  ]);
  db.seed("seller_reputation", [
    { seller_id: "store-a", trust_score: 72, rating_avg: 4.5, status: "Restricted", restricted_until: null, created_at: iso(-HOUR), updated_at: iso(-HOUR) }
  ]);

  // Chủ cửa hàng khác gọi -> phải bị chặn 403 ngay cả khi không có Postgres
  await assert.rejects(
    () => sellerReputationService.getSellerReputationForActor("store-a", "owner-b", "partner"),
    (err) => err.statusCode === 403 && err.code === "AUTH_FORBIDDEN"
  );

  // Đúng chủ cửa hàng -> đọc được fallbackReputation
  const ownerView = await sellerReputationService.getSellerReputationForActor("store-a", "owner-a", "partner");
  assert.equal(ownerView.seller_id, "store-a");
  assert.equal(ownerView.trust_score, 72);

  // Admin -> đọc được fallbackReputation
  const adminView = await sellerReputationService.getSellerReputationForActor("store-a", "admin-1", "admin");
  assert.equal(adminView.seller_id, "store-a");
  assert.equal(adminView.trust_score, 72);
});

test("P1-4(b): chặn đặt đơn (409) và đăng bán ở cửa hàng suspended hoặc Banned", async () => {
  resetDb();
  db.seed("profiles", [
    { id: "cust-1", role: "customer", full_name: "Khách", points: 100, rank: "Tin cậy", red_ban_until: null }
  ]);
  db.seed("stores", [
    { id: "st-susp", owner_id: "own-1", name: "Tiệm Tạm Ngưng", status: "suspended", opening_schedule: [] },
    { id: "st-banned", owner_id: "own-2", name: "Tiệm Bị Khóa", status: "active", opening_schedule: [] },
    { id: "st-ok", owner_id: "own-3", name: "Tiệm Hoạt Động", status: "active", opening_schedule: [] }
  ]);
  db.seed("seller_reputation", [
    { seller_id: "st-banned", trust_score: 20, rating_avg: 2.0, status: "Banned" },
    { seller_id: "st-ok", trust_score: 100, rating_avg: 5.0, status: "Active" }
  ]);
  const makeProd = (id, store_id) => ({
    id,
    store_id,
    name: "Cơm trưa",
    price_cents: 30000,
    original_price_cents: 60000,
    stock_quantity: 10,
    sold_count: 0,
    is_active: true,
    category: "cooked",
    label: "green",
    expires_at: iso(12 * HOUR),
    effective_deadline_at: iso(12 * HOUR),
    emoji: "🍱",
    estimated_weight_kg: 0.4,
    servings_count: 1,
    blocked_reason: null
  });
  db.seed("products", [makeProd("p-susp", "st-susp"), makeProd("p-banned", "st-banned"), makeProd("p-ok", "st-ok")]);

  const orderBody = (product_id) => ({
    items: [{ product_id, quantity: 1 }],
    pickup_slot_key: "policy",
    payment_method: "momo",
    donation_cents: 0
  });

  await assert.rejects(
    () => orderService.createOrder("cust-1", orderBody("p-susp")),
    (err) => err.statusCode === 409 && err.code === "RESOURCE_CONFLICT"
  );
  await assert.rejects(
    () => orderService.createOrder("cust-1", orderBody("p-banned")),
    (err) => err.statusCode === 409 && err.code === "RESOURCE_CONFLICT"
  );

  // Đăng bán: partner bị từ chối khi store suspended hoặc Banned
  const prodBody = (store_id) => ({
    store_id,
    name: "Món mới",
    description: "Ngon",
    category: "cooked",
    original_price_cents: 50000,
    expires_at: iso(12 * HOUR),
    stock_quantity: 5,
    is_donation: false
  });

  await assert.rejects(
    () => catalogService.createProduct("own-1", "partner", prodBody("st-susp")),
    (err) => err.statusCode === 403
  );
  await assert.rejects(
    () => catalogService.createProduct("own-2", "partner", prodBody("st-banned")),
    (err) => err.statusCode === 403
  );

  // Admin vẫn được đăng bán hộ nếu cần
  const createdByAdmin = await catalogService.createProduct("adm-1", "admin", prodBody("st-susp"));
  assert.equal(createdByAdmin.store_id, "st-susp");
});

test("P1-4(c): khóa PATCH /donations/:id/status (chặn partner completed, state-transition map, kiểm tra TNV cùng charity)", async () => {
  resetDb();
  db.seed("stores", [{ id: "st-1", owner_id: "own-1", name: "Tiệm 1", status: "active" }]);
  db.seed("charity_profiles", [
    { id: "ch-1", owner_id: "ch-own-1", name: "Quỹ 1", status: "active" },
    { id: "ch-2", owner_id: "ch-own-2", name: "Quỹ 2", status: "active" }
  ]);
  db.seed("volunteers", [
    { id: "vol-1", charity_id: "ch-1", full_name: "TNV 1", phone: "0901", status: "active" },
    { id: "vol-other", charity_id: "ch-2", full_name: "TNV Khác", phone: "0902", status: "active" }
  ]);
  db.seed("donations", [
    { id: "d-acc", store_id: "st-1", charity_id: "ch-1", status: "accepted", pickup_code: "ABC234" },
    { id: "d-done", store_id: "st-1", charity_id: "ch-1", status: "completed", pickup_code: "XYZ789" },
    { id: "d-canc", store_id: "st-1", charity_id: null, status: "cancelled", pickup_code: null }
  ]);

  // Partner không được tự đặt completed qua PATCH /:id/status
  await assert.rejects(
    () => donationService.updateDonationStatus("own-1", "partner", "d-acc", { status: "completed" }),
    (err) => err.statusCode === 403
  );

  // Không đổi ngược lô đã completed hoặc cancelled (kể cả admin)
  await assert.rejects(
    () => donationService.updateDonationStatus("adm-1", "admin", "d-done", { status: "accepted" }),
    (err) => err.statusCode === 409
  );
  await assert.rejects(
    () => donationService.updateDonationStatus("adm-1", "admin", "d-canc", { status: "open" }),
    (err) => err.statusCode === 409
  );

  // TNV thuộc tổ chức khác -> bị chặn 403
  await assert.rejects(
    () => donationService.updateDonationStatus("ch-own-1", "charity", "d-acc", { status: "accepted", assigned_volunteer_id: "vol-other" }),
    (err) => err.statusCode === 403
  );

  // TNV đúng tổ chức -> thành công
  const updated = await donationService.updateDonationStatus("ch-own-1", "charity", "d-acc", {
    status: "accepted",
    assigned_volunteer_id: "vol-1"
  });
  assert.equal(updated.assigned_volunteer_id, "vol-1");
});

test("P1-4(d): 5 route từng thiếu trong orderRoutes.ts đều đã gắn requireRoles", () => {
  const routes = orderRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      handlerCount: layer.route.stack.length,
      hasRequireRoles: layer.route.stack.some((s) => s.name === "requireRoles" || /requireRoles|actor|role/i.test(s.handle.toString()))
    }));

  const targetPaths = [
    "/payments/momo/webhook/mock",
    "/:id/payments/momo/refresh",
    "/:id/payments/momo/status",
    "/:id",
    "/:id/status"
  ];
  for (const path of targetPaths) {
    const matched = routes.filter((r) => r.path === path);
    assert.ok(matched.length >= 1, `Không tìm thấy route ${path}`);
    for (const r of matched) {
      assert.ok(r.hasRequireRoles, `Route ${r.methods.join(",")} ${r.path} phải có middleware requireRoles`);
    }
  }
});

test("P1-4(e): che pickup_code (donationService) và qr_code (orderService) cho admin khi status !== completed", async () => {
  resetDb();
  db.seed("stores", [{ id: "st-1", owner_id: "own-1", name: "Tiệm 1", status: "active" }]);
  db.seed("donations", [
    { id: "d-1", store_id: "st-1", charity_id: "ch-1", status: "accepted", pickup_code: "SECRET6" },
    { id: "d-2", store_id: "st-1", charity_id: "ch-1", status: "completed", pickup_code: "DONE99" }
  ]);
  db.seed("orders", [
    { id: "o-1", order_number: "FS-1", customer_id: "cust-1", store_id: "st-1", status: "pending", qr_code: "QR-PENDING-SECRET", total_cents: 50000 },
    { id: "o-2", order_number: "FS-2", customer_id: "cust-1", store_id: "st-1", status: "completed", qr_code: "QR-DONE-VISIBLE", total_cents: 50000 }
  ]);

  const adminDonations = await donationService.listDonations("adm-1", "admin", { page: 1, limit: 20 });
  const d1 = adminDonations.items.find((d) => d.id === "d-1");
  const d2 = adminDonations.items.find((d) => d.id === "d-2");
  assert.equal(d1.pickup_code, null, "admin không thấy pickup_code khi chưa completed");
  assert.equal(d2.pickup_code, "DONE99", "admin thấy pickup_code sau khi completed");

  const adminOrders = await orderService.listOrders("adm-1", "admin", { page: 1, limit: 20 });
  assert.equal(adminOrders.items.find((o) => o.id === "o-1").qr_code, null, "listOrders: admin không thấy qr_code khi chưa completed");
  assert.equal(adminOrders.items.find((o) => o.id === "o-2").qr_code, "QR-DONE-VISIBLE", "listOrders: admin thấy qr_code sau khi completed");

  const adminOrderPending = await orderService.getOrder("adm-1", "admin", "o-1");
  const adminOrderDone = await orderService.getOrder("adm-1", "admin", "o-2");
  assert.equal(adminOrderPending.qr_code, null, "getOrder: admin không thấy qr_code khi chưa completed");
  assert.equal(adminOrderDone.qr_code, "QR-DONE-VISIBLE", "getOrder: admin thấy qr_code sau khi completed");

  // Người mua vẫn thấy qr_code của đơn mình
  const custOrderPending = await orderService.getOrder("cust-1", "customer", "o-1");
  assert.equal(custOrderPending.qr_code, "QR-PENDING-SECRET");
});

test("P1-4(f): generateCode dùng crypto.randomInt, qr_code độc lập mật mã học, assertSecret timingSafeEqual, Facebook fetch có AbortController timeout", async () => {
  resetDb();
  const supabaseSource = readRepoFile("src/services/supabaseService.ts");
  assert.ok(!supabaseSource.includes("Math.random"), "supabaseService.ts không được dùng Math.random()");
  assert.match(supabaseSource, /randomInt/);

  const code = generateCode("FS");
  assert.match(code, /^FS-[A-Z0-9]+-[A-Z0-9]{5}$/);

  // qr_code tạo ra độc lập với order_number và đủ dài (128-bit hex)
  db.seed("profiles", [{ id: "cust-1", role: "customer", full_name: "A", points: 100, rank: "Tin cậy", red_ban_until: null }]);
  db.seed("stores", [{ id: "st-1", owner_id: "own-1", name: "Tiệm 1", status: "active" }]);
  db.seed("products", [{
    id: "p-1", store_id: "st-1", name: "Bánh", price_cents: 20000, original_price_cents: 40000,
    stock_quantity: 10, sold_count: 0, is_active: true, category: "bakery", label: "green",
    expires_at: iso(12 * HOUR), effective_deadline_at: iso(12 * HOUR), emoji: "🥐",
    estimated_weight_kg: 0.3, servings_count: 1, blocked_reason: null
  }]);
  const created = await orderService.createOrder("cust-1", {
    items: [{ product_id: "p-1", quantity: 1 }],
    pickup_slot_key: "policy",
    payment_method: "momo",
    donation_cents: 0
  });
  assert.match(created.order.qr_code, /^QR-[0-9A-F]{32}$/);
  assert.ok(!created.order.qr_code.includes(created.order.order_number.replace("FS-", "")));

  // assertSecret dùng createHash("sha256") + timingSafeEqual
  const marketingSource = readRepoFile("src/services/marketingService.ts");
  assert.match(marketingSource, /createHash\("sha256"\)/);
  assert.match(marketingSource, /timingSafeEqual/);
  assert.doesNotThrow(() => marketingService.assertSecret("super-secret-n8n-token-2026"));
  assert.throws(() => marketingService.assertSecret("wrong"), (err) => err.statusCode === 401);
  assert.throws(() => marketingService.assertSecret("super-secret-n8n-token-2027"), (err) => err.statusCode === 401);
  assert.throws(() => marketingService.assertSecret(undefined), (err) => err.statusCode === 401);

  // postToFacebookDirect truyền AbortSignal cho fetch()
  const prevTokens = env.FACEBOOK_PAGE_TOKENS;
  const prevFetch = global.fetch;
  let capturedSignal = null;
  env.FACEBOOK_PAGE_TOKENS = JSON.stringify({ "page-1": "tok-1" });
  global.fetch = async (_url, init) => {
    capturedSignal = init?.signal ?? null;
    return { ok: true, status: 200, text: async () => "ok" };
  };
  try {
    const res = await marketingInternals.postToFacebookDirect("page-1", "hello", null, "https://example.com");
    assert.equal(res.ok, true);
    assert.ok(capturedSignal instanceof AbortSignal, "postToFacebookDirect phải truyền AbortController.signal cho fetch");
  } finally {
    env.FACEBOOK_PAGE_TOKENS = prevTokens;
    global.fetch = prevFetch;
  }
});

test("P2-3a: esgReport O(N) chính xác & nhanh; workStrip cache 3 phút + clearWorkStripCache; verificationQueue lọc action; payoutAccountService.listForAdmin không N+1", async () => {
  resetDb();
  const month = new Date(Date.now() + 7 * HOUR).toISOString().slice(0, 7);
  db.seed("stores", [
    { id: "st-1", owner_id: "o-1", name: "Tiệm Một", legal_name: "CTY MỘT", status: "active" },
    { id: "st-2", owner_id: "o-2", name: "Tiệm Hai", legal_name: "CTY HAI", status: "active" }
  ]);
  const events = [];
  for (let i = 0; i < 2000; i += 1) {
    events.push({
      source_type: i % 2 === 0 ? "order" : "donation",
      store_id: i % 4 === 0 ? "st-1" : "st-2",
      food_saved_kg: 1.5,
      co2_avoided_kg: 3,
      water_saved_liters: 100,
      meals_equivalent: 2,
      money_saved_cents: 10000,
      occurred_at: iso(-10_000)
    });
  }
  db.seed("eco_impact_events", events);

  const t0 = Date.now();
  const report = await adminOpsService.esgReport(month);
  const elapsed = Date.now() - t0;
  assert.equal(report.total.events, 2000);
  assert.equal(report.total.food_saved_kg, 3000);
  assert.equal(report.by_source.order.events, 1000);
  assert.equal(report.by_source.donation.events, 1000);
  assert.equal(report.top_stores[0].store_id, "st-2");
  assert.equal(report.top_stores[0].food_saved_kg, 2250);
  assert.equal(report.top_stores[1].store_id, "st-1");
  assert.equal(report.top_stores[1].food_saved_kg, 750);
  assert.ok(elapsed < 1500, `esgReport O(N) chạy quá chậm: ${elapsed}ms`);

  // workStrip cache 3 phút & clear khi handleFraudAlert
  db.seedSystemWallets();
  db.wallet("w-escrow").balance_cents = 500;
  const w1 = await adminOpsService.workStrip({ useCache: true });
  assert.equal(w1.ledger_unbalanced, 1);

  db.wallet("w-escrow").balance_cents = 0;
  const wCached = await adminOpsService.workStrip({ useCache: true });
  assert.equal(wCached.ledger_unbalanced, 1, "workStrip phải dùng cache trong vòng 3 phút");

  // handleFraudAlert tự xóa cache workStrip
  await adminOpsService.handleFraudAlert("shared_ip:1.2.3.4", "handled", "đã xử lý", { userId: "adm-1", name: "Admin" });
  const wFresh = await adminOpsService.workStrip({ useCache: true });
  assert.equal(wFresh.ledger_unbalanced, 0, "sau khi xóa cache phải đọc giá trị mới");

  // adminController.runReconcile tự xóa cache workStrip để ledger_unbalanced cập nhật ngay
  db.wallet("w-escrow").balance_cents = 500;
  const wStillZero = await adminOpsService.workStrip({ useCache: true });
  assert.equal(wStillZero.ledger_unbalanced, 0, "đang giữ cache 0 trong 3 phút");
  const fakeRes = { status() { return this; }, json(body) { this.body = body; return this; } };
  await adminController.runReconcile({}, fakeRes);
  const wAfterReconcile = await adminOpsService.workStrip({ useCache: true });
  assert.equal(wAfterReconcile.ledger_unbalanced, 1, "runReconcile phải xóa cache để workStrip phản ánh ngay");

  // verificationQueue truyền action: "verification."
  db.seed("admin_audit_log", [
    { id: "a1", action: "verification.approve", created_at: iso(-1000) },
    { id: "a2", action: "voucher.create", created_at: iso(-500) }
  ]);
  const vq = await adminOpsService.verificationQueue();
  assert.deepEqual(vq.history.map((h) => h.id), ["a1"]);

  // payoutAccountService.listForAdmin khử N+1 (batch query)
  db.seed("partner_profiles", [
    { store_id: "st-1", legal_name: "CÔNG TY MỘT TNHH" }
  ]);
  db.seed("store_payout_accounts", [
    { id: "pa-1", store_id: "st-1", bank_name: "VCB", account_holder_name: "A", account_last4: "1111", status: "pending_verification", created_at: iso(-2000) },
    { id: "pa-2", store_id: "st-2", bank_name: "BIDV", account_holder_name: "B", account_last4: "2222", status: "pending_verification", created_at: iso(-1000) },
    { id: "pa-3", store_id: "st-1", bank_name: "ACB", account_holder_name: "C", account_last4: "3333", status: "verified", created_at: iso(-500) }
  ]);
  queryLog.length = 0;
  const list = await payoutAccountService.listForAdmin();
  assert.equal(list.length, 3);
  assert.equal(list.find((r) => r.id === "pa-1").registered_name, "CÔNG TY MỘT TNHH");
  assert.equal(list.find((r) => r.id === "pa-2").registered_name, "CTY HAI");
  assert.equal(list.find((r) => r.id === "pa-3").registered_name, "CÔNG TY MỘT TNHH");
  const ppQueries = queryLog.filter((q) => q.table === "partner_profiles").length;
  const storeQueries = queryLog.filter((q) => q.table === "stores").length;
  assert.equal(ppQueries, 1, "partner_profiles chỉ được query đúng 1 lần (batch .in)");
  assert.equal(storeQueries, 1, "stores chỉ được query tối đa 1 lần cho các store thiếu partner_profiles");
});
