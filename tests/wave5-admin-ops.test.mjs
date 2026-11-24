import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";

// Thiết lập biến môi trường giả TRƯỚC khi nạp các module từ dist/
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
const { FakeDb, installFakeAuthAdmin } = require("../scripts/fake-supabase");

let db = new FakeDb();
let fakeTokens = new Map();
let fromHook = null;

const sb = require("../dist/config/supabase");
sb.supabaseAdmin = {
  from: (name) => (fromHook ? fromHook(name, () => db.from(name)) : db.from(name)),
  rpc: (name, args) => db.rpc(name, args),
  auth: { admin: installFakeAuthAdmin(() => db) },
  storage: {
    from: (bucket) => ({
      createSignedUrl: async (objectPath) => ({
        data: { signedUrl: `http://127.0.0.1:9/signed/${bucket}/${objectPath}?token=sig123` },
        error: null
      })
    })
  }
};
sb.supabaseAuth = {
  auth: {
    getUser: async (token) => {
      const user = fakeTokens.get(token);
      if (!user) return { data: { user: null }, error: { message: "Invalid token" } };
      return { data: { user }, error: null };
    }
  }
};
require("../dist/config/postgres").isPostgresAvailable = async () => false;

const { app } = require("../dist/app");
const { catalogService } = require("../dist/services/catalogService");
const { sellerReputationService } = require("../dist/services/sellerReputationService");

const ADM_ID = "11111111-1111-4111-8111-111111111111";
const ADM_SUSP_ID = "11111111-1111-4111-8111-111111111112";
const CUST_1 = "22222222-2222-4222-8222-222222222221";
const CUST_2 = "22222222-2222-4222-8222-222222222222";
const PARTNER_1 = "33333333-3333-4333-8333-333333333331";
const CHARITY_OWNER = "44444444-4444-4444-8444-444444444441";
const STORE_1 = "55555555-5555-4555-8555-555555555551";
const STORE_2 = "55555555-5555-4555-8555-555555555552";
const CHARITY_1 = "66666666-6666-4666-8666-666666666661";
const VOL_1 = "77777777-7777-4777-8777-777777777771";
const VOL_2 = "77777777-7777-4777-8777-777777777772";
const PROD_1 = "88888888-8888-4888-8888-888888888881";
const PROD_2 = "88888888-8888-4888-8888-888888888882";
const ORD_1 = "99999999-9999-4999-8999-999999999901";
const ORD_2 = "99999999-9999-4999-8999-999999999902";
const ORD_3 = "99999999-9999-4999-8999-999999999903";
const DON_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const DON_2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const REV_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const REV_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";

let server;
let baseUrl = "";

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/api/v1`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

const reqJson = async (method, path, { token, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
};

const resetState = () => {
  db = new FakeDb();
  fakeTokens = new Map();
  fromHook = null;
  db.seedSystemWallets();

  const seedAuth = (tok, profile) => {
    fakeTokens.set(tok, { id: profile.id, email: `${profile.id}@mio.vn` });
    db.seed("profiles", [profile]);
  };
  seedAuth("tok-admin", { id: ADM_ID, role: "admin", status: "active", full_name: "Admin Vận Hành", phone: "0900000001" });
  seedAuth("tok-admin-susp", { id: ADM_SUSP_ID, role: "admin", status: "suspended", full_name: "Admin Tạm Khóa", phone: "0900000002" });
  seedAuth("tok-cust1", { id: CUST_1, role: "customer", status: "active", full_name: "Nguyễn Văn Minh", phone: "0912345678", points: 100, rank: "Tin cậy" });
  seedAuth("tok-cust2", { id: CUST_2, role: "customer", status: "active", full_name: "Trần Thị Lan", phone: "0987654321", points: 90, rank: "Tin cậy" });
  seedAuth("tok-partner", { id: PARTNER_1, role: "partner", status: "active", full_name: "Chủ Tiệm Hoa Sữa", phone: "0933111222" });
  seedAuth("tok-charity", { id: CHARITY_OWNER, role: "charity", status: "active", full_name: "Đại Diện Từ Thiện", phone: "0944111222" });

  db.seed("stores", [
    { id: STORE_1, owner_id: PARTNER_1, name: "Tiệm Bánh Hoa Sữa", slug: "hoa-sua", address: "12 Lê Lợi", district: "Quận 1", city: "TP.HCM", status: "active", is_verified: true, is_open: true, rating: 5, opening_schedule: [] },
    { id: STORE_2, owner_id: PARTNER_1, name: "Siêu Thị Xanh", slug: "sieu-thi-xanh", address: "45 Nguyễn Huệ", district: "Quận 1", city: "TP.HCM", status: "active", is_verified: true, is_open: true, rating: 5, opening_schedule: [] }
  ]);
  db.seed("charity_profiles", [
    { id: CHARITY_1, owner_id: CHARITY_OWNER, name: "Mái Ấm Hy Vọng", slug: "mai-am-hy-vong", phone: "0977888999", email: "hyvong@mio.vn", address: "100 Điện Biên Phủ", district: "Quận 3", city: "TP.HCM", status: "active" }
  ]);
  db.seed("volunteers", [
    { id: VOL_1, charity_id: CHARITY_1, full_name: "Lê Tình Nguyện", phone: "0966123456", email: "vol1@mio.vn", vehicle: "Xe máy", status: "active", runs: 2, kg_collected: 10 },
    { id: VOL_2, charity_id: CHARITY_1, full_name: "Phạm Phát Hàng", phone: "0955987654", email: "vol2@mio.vn", vehicle: "Xe đạp", status: "active", runs: 1, kg_collected: 5 }
  ]);
};

const makeMissingTableChain = (code = "42P01") => {
  const err = { code, message: "relation does not exist" };
  const chain = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    gte: () => chain,
    lte: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    single: () => chain,
    maybeSingle: () => chain,
    then: (res, rej) => Promise.resolve({ data: null, error: err, count: null }).then(res, rej)
  };
  return chain;
};

const audits = (action) => db.table("admin_audit_log").filter((r) => !action || r.action === action);

test("W5A-1 RBAC: tất cả endpoints Đợt 3 yêu cầu Admin đang hoạt động (401/403 cho khách, đối tác, tổ chức, admin bị khóa)", async () => {
  resetState();
  const paths = [
    "/admin/orders",
    "/admin/donations",
    "/admin/products",
    "/admin/payments",
    "/admin/payments/summary",
    "/admin/reviews"
  ];

  for (const path of paths) {
    assert.equal((await reqJson("GET", path)).status, 401, `missing token on ${path}`);
    assert.equal((await reqJson("GET", path, { token: "tok-cust1" })).status, 403, `customer on ${path}`);
    assert.equal((await reqJson("GET", path, { token: "tok-partner" })).status, 403, `partner on ${path}`);
    assert.equal((await reqJson("GET", path, { token: "tok-charity" })).status, 403, `charity on ${path}`);
    assert.equal((await reqJson("GET", path, { token: "tok-admin-susp" })).status, 403, `suspended admin on ${path}`);
    assert.equal((await reqJson("GET", path, { token: "tok-admin" })).status, 200, `active admin on ${path}`);
  }
});

test("W5A-2 Orders: lọc/tìm kiếm, che tuyệt đối qr_code/pickup_code khi chưa completed, chi tiết đủ trường & ký ảnh khiếu nại", async () => {
  resetState();
  const futureDeadline = new Date(Date.now() + 2 * 3600_000).toISOString();
  db.seed("orders", [
    {
      id: ORD_1,
      order_number: "FS-1001",
      customer_id: CUST_1,
      store_id: STORE_1,
      status: "confirmed",
      payment_status: "paid",
      payment_method: "momo",
      settlement_status: "held",
      policy_label: "yellow",
      subtotal_cents: 50000,
      discount_cents: 5000,
      donation_cents: 2000,
      platform_fee_cents: 2000,
      total_cents: 49000,
      qr_code: "QR-SECRET-ACTIVE-1",
      pickup_code: "PK-SECRET-1",
      pickup_deadline: futureDeadline,
      paid_at: "2026-11-24T02:00:00.000Z",
      created_at: "2026-11-24T01:55:00.000Z"
    },
    {
      id: ORD_2,
      order_number: "FS-1002",
      customer_id: CUST_2,
      store_id: STORE_2,
      status: "completed",
      payment_status: "paid",
      payment_method: "vnpay",
      settlement_status: "released",
      policy_label: "green",
      subtotal_cents: 80000,
      discount_cents: 0,
      donation_cents: 0,
      platform_fee_cents: 2000,
      total_cents: 82000,
      qr_code: "QR-COMPLETED-OK",
      paid_at: "2026-11-23T05:00:00.000Z",
      completed_at: "2026-11-23T06:00:00.000Z",
      created_at: "2026-11-23T04:50:00.000Z"
    }
  ]);
  db.seed("order_items", [
    { id: "oi-1", order_id: ORD_1, product_id: PROD_1, product_name: "Bánh mì bơ tỏi", quantity: 2, unit_price_cents: 25000, original_unit_price_cents: 50000, created_at: "2026-11-24T01:55:00.000Z" }
  ]);
  db.seed("complaints", [
    {
      id: "comp-1",
      order_id: ORD_2,
      customer_id: CUST_2,
      store_id: STORE_2,
      status: "in_review",
      issue: "Bánh bị móp",
      image_urls: [`http://127.0.0.1:9/storage/v1/object/complaint-evidence/complaints/${ORD_2}/${CUST_2}/ev1.jpg`],
      store_response_images: []
    }
  ]);
  db.seed("live_locations", [
    { actor_kind: "customer", actor_id: CUST_1, context_kind: "order", context_id: ORD_1, lat: 10.77, lng: 106.69, accuracy_m: 12, updated_at: new Date().toISOString() }
  ]);

  // Lọc + sắp xếp theo total_cents.desc
  const listRes = await reqJson("GET", "/admin/orders?sort=total_cents.desc", { token: "tok-admin" });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.data.total, 2);
  assert.equal(listRes.body.data.items[0].id, ORD_2);
  assert.equal(listRes.body.data.items[0].has_complaint, true);
  assert.equal(listRes.body.data.items[0].qr_code, "QR-COMPLETED-OK");
  assert.equal(listRes.body.data.items[1].id, ORD_1);
  assert.equal(listRes.body.data.items[1].has_complaint, false);
  assert.ok(!JSON.stringify(listRes.body.data.items[1]).includes("QR-SECRET-ACTIVE-1"), "không lộ qr_code đơn chưa hoàn tất");
  assert.ok(!JSON.stringify(listRes.body.data.items[1]).includes("PK-SECRET-1"), "không lộ pickup_code");
  assert.match(listRes.body.data.items[1].customer.phone, /•/, "che SĐT khách");

  // Tìm kiếm theo SĐT khách và lọc has_complaint
  const byPhone = await reqJson("GET", "/admin/orders?q=0912345678", { token: "tok-admin" });
  assert.equal(byPhone.body.data.items.length, 1);
  assert.equal(byPhone.body.data.items[0].id, ORD_1);

  const onlyComplaint = await reqJson("GET", "/admin/orders?has_complaint=true", { token: "tok-admin" });
  assert.deepEqual(onlyComplaint.body.data.items.map((o) => o.id), [ORD_2]);

  const noComplaint = await reqJson("GET", "/admin/orders?has_complaint=false", { token: "tok-admin" });
  assert.deepEqual(noComplaint.body.data.items.map((o) => o.id), [ORD_1]);

  // Chi tiết đơn đang mở: không có tin nhắn -> KHÔNG ghi spam order.chat_view; có customer_location & refund_capability
  const detailActive = await reqJson("GET", `/admin/orders/${ORD_1}`, { token: "tok-admin" });
  assert.equal(detailActive.status, 200);
  assert.ok(!JSON.stringify(detailActive.body.data).includes("QR-SECRET-ACTIVE-1"));
  assert.ok(!JSON.stringify(detailActive.body.data).includes("PK-SECRET-1"));
  assert.equal(detailActive.body.data.can_send, false);
  assert.deepEqual(detailActive.body.data.messages, []);
  assert.equal(audits("order.chat_view").length, 0, "không spam audit khi chưa có tin nhắn");
  assert.ok(detailActive.body.data.customer_location, "có vị trí trực tiếp của khách");
  assert.deepEqual(detailActive.body.data.refund_capability, {
    can_cancel_refund: true,
    can_mark_no_show: true,
    can_complete: true
  });

  // Chi tiết đơn đã hoàn tất có tin nhắn + khiếu nại: ký link ảnh riêng tư + ghi audit order.chat_view
  db.seed("order_messages", [
    { id: "msg-1", order_id: ORD_2, sender_id: CUST_2, sender_role: "customer", body: "Cho tôi hỏi về bánh", read_at: null, created_at: "2026-11-23T05:10:00.000Z" }
  ]);
  const detailCompleted = await reqJson("GET", `/admin/orders/${ORD_2}`, { token: "tok-admin" });
  assert.equal(detailCompleted.status, 200);
  assert.equal(detailCompleted.body.data.qr_code, "QR-COMPLETED-OK");
  assert.equal(detailCompleted.body.data.messages.length, 1);
  assert.equal(detailCompleted.body.data.can_send, false);
  assert.equal(audits("order.chat_view").length, 1);
  assert.match(detailCompleted.body.data.complaints[0].image_urls[0], /\/signed\/complaint-evidence\//, "ảnh minh chứng được ký URL");
  assert.equal(detailCompleted.body.data.refund_capability.can_cancel_refund, false);
  assert.ok(detailCompleted.body.data.refund_capability.reason);

  // Graceful 42P01 cho payment_events & live_locations trong GET /admin/orders/:id
  fromHook = (name, passthrough) => {
    if (name === "payment_events" || name === "live_locations") return makeMissingTableChain("42P01");
    return passthrough();
  };
  try {
    const fallbackDetail = await reqJson("GET", `/admin/orders/${ORD_1}`, { token: "tok-admin" });
    assert.equal(fallbackDetail.status, 200);
    assert.deepEqual(fallbackDetail.body.data.payment_events, []);
    assert.equal(fallbackDetail.body.data.customer_location, null);
  } finally {
    fromHook = null;
  }
});

test("W5A-3 Orders actions: hủy & hoàn 100% (cân sổ cái, trả kho, cancelled_by=admin), no_show, completed và ghi chú (42703-safe trên order_events)", async () => {
  resetState();
  const futureIso = new Date(Date.now() + 4 * 3600_000).toISOString();
  db.seed("products", [
    {
      id: PROD_1, store_id: STORE_1, name: "Cơm gà", description: "Cơm gà", category: "meal", food_group: "cooked",
      price_cents: 30000, original_price_cents: 60000, label: "yellow", stock_quantity: 3, sold_count: 2,
      is_active: true, blocked_reason: null, expires_at: futureIso, effective_deadline_at: futureIso
    }
  ]);

  // Đặt giữ tiền trên sổ cái cho ORD_1 (62.000đ) và ORD_2, ORD_3
  db.seed("orders", [
    {
      id: ORD_1, order_number: "FS-2001", customer_id: CUST_1, store_id: STORE_1, status: "confirmed",
      payment_status: "paid", payment_method: "momo", settlement_status: "held", subtotal_cents: 60000,
      discount_cents: 0, donation_cents: 0, platform_fee_cents: 2000, total_cents: 62000, qr_code: "QR-2001",
      pickup_deadline: futureIso, paid_at: new Date().toISOString()
    },
    {
      id: ORD_2, order_number: "FS-2002", customer_id: CUST_1, store_id: STORE_1, status: "ready",
      payment_status: "paid", payment_method: "momo", settlement_status: "held", subtotal_cents: 30000,
      discount_cents: 0, donation_cents: 0, platform_fee_cents: 2000, total_cents: 32000, qr_code: "QR-2002",
      pickup_deadline: futureIso, paid_at: new Date().toISOString()
    },
    {
      id: ORD_3, order_number: "FS-2003", customer_id: CUST_2, store_id: STORE_1, status: "ready",
      payment_status: "paid", payment_method: "momo", settlement_status: "held", subtotal_cents: 30000,
      discount_cents: 0, donation_cents: 0, platform_fee_cents: 2000, total_cents: 32000, qr_code: "QR-2003",
      pickup_deadline: futureIso, paid_at: new Date().toISOString()
    }
  ]);
  db.seed("order_items", [
    { id: "oi-2001", order_id: ORD_1, product_id: PROD_1, product_name: "Cơm gà", quantity: 2, unit_price_cents: 30000, original_unit_price_cents: 60000 }
  ]);

  // Ghi bút toán charge ban đầu vào escrow để đối soát sổ cái thật sự
  const { ledgerService } = require("../dist/services/ledgerService");
  for (const ord of db.table("orders")) {
    await ledgerService.syncOrder(ord);
  }

  // Lý do quá ngắn -> 422
  const badReason = await reqJson("POST", `/admin/orders/${ORD_1}/status`, {
    token: "tok-admin",
    body: { status: "cancelled", reason: "ab" }
  });
  assert.equal(badReason.status, 422);

  // Mô phỏng bảng order_events thật (SQL 029 chỉ có order_id, event_type, detail -> ném 42703 nếu insert cột metadata/actor_id)
  fromHook = (name, passthrough) => {
    if (name === "order_events") {
      const real = passthrough();
      const origInsert = real.insert.bind(real);
      real.insert = (payload) => {
        const row = Array.isArray(payload) ? payload[0] : payload;
        if (row && ("metadata" in row || "actor_id" in row)) {
          return {
            select: () => ({
              single: async () => ({ data: null, error: { code: "42703", message: "column metadata does not exist" } })
            })
          };
        }
        return origInsert(payload);
      };
      return real;
    }
    return passthrough();
  };

  try {
    // 1. Admin hủy đơn đã trả: hoàn 100%, trả tồn kho, cancelled_by="admin", sổ cái cân bằng
    const cancelRes = await reqJson("POST", `/admin/orders/${ORD_1}/status`, {
      token: "tok-admin",
      body: { status: "cancelled", reason: "Cửa hàng đóng cửa đột xuất" }
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.status, "cancelled");
    assert.equal(cancelRes.body.data.cancelled_by, "admin");
    assert.equal(cancelRes.body.data.payment_status, "refunded");
    assert.equal(cancelRes.body.data.settlement_status, "refunded");
    assert.ok(!JSON.stringify(cancelRes.body.data).includes("QR-2001"));

    const prodAfter = db.table("products").find((p) => p.id === PROD_1);
    assert.equal(prodAfter.stock_quantity, 5, "trả lại 2 phần vào tồn kho");
    assert.equal(prodAfter.sold_count, 0);

    const check = await db.rpc("fs_ledger_check", {});
    assert.equal(check.data[0].total_balance, 0, "tổng ví bằng 0");
    assert.equal(check.data[0].mismatched_wallets, 0, "không lệch ví nào");

    const cancelAudit = audits("order.cancel");
    assert.equal(cancelAudit.length, 1);
    assert.deepEqual(cancelAudit[0].detail, {
      order_number: "FS-2001",
      status: "cancelled",
      reason: "Cửa hàng đóng cửa đột xuất",
      refund_cents: 62000
    });

    const adminEvents = db.table("order_events").filter((e) => e.order_id === ORD_1 && e.event_type === "admin_action");
    assert.equal(adminEvents.length, 1, "ghi được order_events qua nhánh fallback 42703");
    assert.equal(adminEvents[0].detail.reason, "Cửa hàng đóng cửa đột xuất");

    // 2. Admin đánh dấu no_show ngay cả khi chưa quá pickup_deadline
    const noShowRes = await reqJson("POST", `/admin/orders/${ORD_2}/status`, {
      token: "tok-admin",
      body: { status: "no_show", reason: "Khách xác nhận không tới lấy" }
    });
    assert.equal(noShowRes.status, 200);
    assert.equal(noShowRes.body.data.status, "no_show");
    assert.equal(audits("order.no_show").length, 1);
    assert.equal(audits("order.no_show")[0].detail.refund_cents, 0);

    // 3. Admin xác nhận hoàn tất thay
    const completeRes = await reqJson("POST", `/admin/orders/${ORD_3}/status`, {
      token: "tok-admin",
      body: { status: "completed", reason: "Xác minh khách đã nhận hàng tại quầy" }
    });
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.data.status, "completed");
    assert.equal(completeRes.body.data.qr_code, "QR-2003", "đơn completed được hiển thị qr_code");
    assert.equal(audits("order.complete").length, 1);

    // 4. Ghi chú nội bộ đơn hàng
    const noteRes = await reqJson("POST", `/admin/orders/${ORD_3}/note`, {
      token: "tok-admin",
      body: { note: "Đã gọi điện xác nhận với chủ cửa hàng" }
    });
    assert.equal(noteRes.status, 200);
    assert.equal(noteRes.body.data.ok, true);
    assert.equal(noteRes.body.data.event.event_type, "admin_note");
    assert.equal(audits("order.note").length, 1);
    assert.deepEqual(audits("order.note")[0].detail, { note: "Đã gọi điện xác nhận với chủ cửa hàng" });
  } finally {
    fromHook = null;
  }
});

test("W5A-4 Donations: lọc/tìm kiếm, tuyệt đối không lộ pickup_code (kể cả đã hoàn tất), báo cáo 8 mốc & hủy lô 409-safe", async () => {
  resetState();
  db.seed("products", [
    { id: PROD_1, store_id: STORE_1, name: "Bánh ngọt", stock_quantity: 4, is_active: true }
  ]);
  db.seed("donations", [
    {
      id: DON_1,
      donation_code: "D-5001",
      store_id: STORE_1,
      charity_id: null,
      product_id: PROD_1,
      quantity: 6,
      items: "Bánh ngọt cuối ngày",
      amount_text: "6 phần",
      weight_kg: 1.8,
      urgency: "red",
      status: "open",
      pickup_code: "SECRET6",
      note: "Để ở quầy lễ tân",
      expires_at: "2026-11-24T15:00:00.000Z",
      created_at: "2026-11-24T08:00:00.000Z"
    },
    {
      id: DON_2,
      donation_code: "D-5002",
      store_id: STORE_1,
      charity_id: CHARITY_1,
      assigned_volunteer_id: VOL_1,
      distribute_volunteer_id: VOL_2,
      items: "Cơm hộp từ thiện",
      amount_text: "20 hộp",
      quantity: 20,
      portions: 20,
      weight_kg: 8,
      urgency: "yellow",
      status: "completed",
      pickup_code: "TOPSEC",
      created_at: "2026-11-23T01:00:00.000Z",
      accepted_at: "2026-11-23T01:10:00.000Z",
      store_confirmed_at: "2026-11-23T01:20:00.000Z",
      volunteer_assigned_at: "2026-11-23T01:30:00.000Z",
      packed_at: "2026-11-23T01:40:00.000Z",
      completed_at: "2026-11-23T02:00:00.000Z",
      distribute_assigned_at: "2026-11-23T02:20:00.000Z",
      distribution_done_at: "2026-11-23T03:00:00.000Z",
      expires_at: "2026-11-23T12:00:00.000Z"
    }
  ]);
  db.seed("donation_assignments", [
    { id: "da-1", donation_id: DON_2, volunteer_id: VOL_1, stage: "pickup", share: 20, assigned_at: "2026-11-23T01:30:00.000Z", done_at: "2026-11-23T02:05:00.000Z" },
    { id: "da-2", donation_id: DON_2, volunteer_id: VOL_2, stage: "distribute", share: 20, assigned_at: "2026-11-23T02:20:00.000Z", done_at: "2026-11-23T03:00:00.000Z" }
  ]);
  db.seed("donation_photos", [
    { id: "dp-1", donation_id: DON_2, volunteer_id: VOL_1, stage: "pickup", photo_url: "https://example.com/p1.jpg", status: "approved", taken_at: "2026-11-23T02:05:00.000Z", gps_flag: false },
    { id: "dp-2", donation_id: DON_2, volunteer_id: VOL_2, stage: "distribute", photo_url: "https://example.com/p2.jpg", status: "approved", taken_at: "2026-11-23T02:55:00.000Z", gps_flag: false }
  ]);

  const listRes = await reqJson("GET", "/admin/donations?sort=expires_at.asc", { token: "tok-admin" });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.data.total, 2);
  assert.ok(!JSON.stringify(listRes.body.data).includes("SECRET6"), "không lộ pickup_code lô đang mở");
  assert.ok(!JSON.stringify(listRes.body.data).includes("TOPSEC"), "không lộ pickup_code kể cả lô completed");
  assert.ok(!JSON.stringify(listRes.body.data).includes("pickup_code"), "bỏ hẳn khóa pickup_code");

  const detailRes = await reqJson("GET", `/admin/donations/${DON_2}`, { token: "tok-admin" });
  assert.equal(detailRes.status, 200);
  assert.ok(!JSON.stringify(detailRes.body.data).includes("TOPSEC"));
  assert.ok(!("pickup_code" in detailRes.body.data));
  assert.equal(detailRes.body.data.donation_assignments.length, 2);
  assert.match(detailRes.body.data.donation_assignments[0].volunteer_phone, /•/, "che SĐT TNV");
  assert.equal(detailRes.body.data.photos.length, 2);
  assert.ok(detailRes.body.data.report.timeline.length >= 8, "hiện đủ các mốc hành trình lô tặng");

  // Hủy lô completed -> 409 CONFLICT
  const cancelCompleted = await reqJson("POST", `/admin/donations/${DON_2}/cancel`, {
    token: "tok-admin",
    body: { reason: "Thử hủy lô đã xong" }
  });
  assert.equal(cancelCompleted.status, 409);

  // Hủy lô đang mở -> thành công, trả tồn kho, giữ ghi chú cũ + lý do admin, ghi audit donation.cancel
  const cancelOpen = await reqJson("POST", `/admin/donations/${DON_1}/cancel`, {
    token: "tok-admin",
    body: { reason: "Hàng bị hư hỏng trước khi giao" }
  });
  assert.equal(cancelOpen.status, 200);
  assert.equal(cancelOpen.body.data.status, "cancelled");
  assert.match(cancelOpen.body.data.note, /Để ở quầy lễ tân/);
  assert.match(cancelOpen.body.data.note, /\[Admin hủy\] Hàng bị hư hỏng trước khi giao/);
  assert.ok(!("pickup_code" in cancelOpen.body.data));
  assert.equal(db.table("products").find((p) => p.id === PROD_1).stock_quantity, 10, "trả lại 6 phần về kho");
  assert.equal(audits("donation.cancel").length, 1);

  // Hủy lại lô đã cancelled -> 409 CONFLICT
  const cancelAgain = await reqJson("POST", `/admin/donations/${DON_1}/cancel`, {
    token: "tok-admin",
    body: { reason: "Hủy lần hai" }
  });
  assert.equal(cancelAgain.status, 409);
});

test("W5A-5 Products + catalogService.updateProduct Guard: ẩn/bỏ ẩn, chặn cửa hàng tự bật lại (409) và tương thích 42703", async () => {
  resetState();
  const futureIso = new Date(Date.now() + 10 * 3600_000).toISOString();
  db.seed("products", [
    {
      id: PROD_1, store_id: STORE_1, name: "Salad cá ngừ", description: "Salad tươi", category: "fresh", food_group: "fresh",
      label: "green", stock_quantity: 8, sold_count: 0, original_price_cents: 50000, price_cents: 40000,
      expires_at: futureIso, effective_deadline_at: futureIso, is_donation: false, is_active: true, blocked_reason: null,
      admin_hidden_at: null, admin_hidden_reason: null, admin_hidden_by: null, created_at: "2026-11-24T01:00:00.000Z"
    },
    {
      id: PROD_2, store_id: STORE_2, name: "Sữa tươi hữu cơ", description: "Sữa tươi", category: "dairy", food_group: "fresh",
      label: "red", stock_quantity: 4, sold_count: 1, original_price_cents: 40000, price_cents: 8000,
      expires_at: futureIso, effective_deadline_at: futureIso, is_donation: false, is_active: true, blocked_reason: null,
      admin_hidden_at: null, admin_hidden_reason: null, admin_hidden_by: null, created_at: "2026-11-24T02:00:00.000Z"
    }
  ]);

  // Ẩn không lý do -> 400
  const missingReason = await reqJson("POST", `/admin/products/${PROD_1}/visibility`, {
    token: "tok-admin",
    body: { action: "hide", reason: "x" }
  });
  assert.equal(missingReason.status, 400);

  // Admin ẩn sản phẩm PROD_1
  const hideRes = await reqJson("POST", `/admin/products/${PROD_1}/visibility`, {
    token: "tok-admin",
    body: { action: "hide", reason: "Hình ảnh sản phẩm vi phạm quy chuẩn" }
  });
  assert.equal(hideRes.status, 200);
  assert.equal(hideRes.body.data.is_active, false);
  assert.equal(hideRes.body.data.blocked_reason, "[Admin] Hình ảnh sản phẩm vi phạm quy chuẩn");
  assert.ok(hideRes.body.data.admin_hidden_at);
  assert.equal(audits("product.hide").length, 1);

  // Lọc theo visibility=hidden và visibility=visible
  const hiddenList = await reqJson("GET", "/admin/products?visibility=hidden", { token: "tok-admin" });
  assert.deepEqual(hiddenList.body.data.items.map((p) => p.id), [PROD_1]);
  assert.equal(hiddenList.body.data.items[0].store_name, "Tiệm Bánh Hoa Sữa");

  const visibleList = await reqJson("GET", "/admin/products?visibility=visible", { token: "tok-admin" });
  assert.deepEqual(visibleList.body.data.items.map((p) => p.id), [PROD_2]);

  const prodDetail = await reqJson("GET", `/admin/products/${PROD_1}`, { token: "tok-admin" });
  assert.equal(prodDetail.status, 200);
  assert.equal(prodDetail.body.data.store.name, "Tiệm Bánh Hoa Sữa");

  // Guard trong catalogService.updateProduct: đối tác KHÔNG thể tự bật bán lại (409)
  const partnerReactivateHttp = await reqJson("PATCH", `/catalog/products/${PROD_1}`, {
    token: "tok-partner",
    body: { is_active: true }
  });
  assert.equal(partnerReactivateHttp.status, 409);
  assert.match(partnerReactivateHttp.body.error.message, /Quản trị viên ẩn/);

  // Nhưng đối tác vẫn sửa được mô tả mà không bật bán lại
  const partnerEditDesc = await catalogService.updateProduct(PARTNER_1, "partner", PROD_1, {
    description: "Đã cập nhật lại hình ảnh hợp lệ"
  });
  assert.equal(partnerEditDesc.is_active, false);

  // Admin bỏ ẩn -> đối tác lại có thể tắt/bật bình thường
  const unhideRes = await reqJson("POST", `/admin/products/${PROD_1}/visibility`, {
    token: "tok-admin",
    body: { action: "unhide" }
  });
  assert.equal(unhideRes.status, 200);
  assert.equal(unhideRes.body.data.is_active, true);
  assert.equal(unhideRes.body.data.blocked_reason, null);
  assert.equal(unhideRes.body.data.admin_hidden_at, null);
  assert.equal(audits("product.unhide").length, 1);

  await catalogService.updateProduct(PARTNER_1, "partner", PROD_1, { is_active: false });
  const partnerTurnBackOn = await catalogService.updateProduct(PARTNER_1, "partner", PROD_1, { is_active: true });
  assert.equal(partnerTurnBackOn.is_active, true);

  // Tương thích ngược 42703 khi chưa chạy SQL 043 (thiếu cột admin_hidden_*)
  fromHook = (name, passthrough) => {
    if (name === "products") {
      const real = passthrough();
      const origSelect = real.select.bind(real);
      const origUpdate = real.update.bind(real);
      real.select = (cols, opts) => {
        if (typeof cols === "string" && cols.includes("admin_hidden_at")) {
          return makeMissingTableChain("42703");
        }
        return origSelect(cols, opts);
      };
      real.update = (patch) => {
        if (patch && "admin_hidden_at" in patch) {
          return makeMissingTableChain("42703");
        }
        return origUpdate(patch);
      };
      return real;
    }
    return passthrough();
  };

  try {
    const listNo043 = await reqJson("GET", "/admin/products", { token: "tok-admin" });
    assert.equal(listNo043.status, 200);
    assert.equal(listNo043.body.data.total, 2);

    const hideNo043 = await reqJson("POST", `/admin/products/${PROD_2}/visibility`, {
      token: "tok-admin",
      body: { action: "hide", reason: "Sai nhãn hạn sử dụng" }
    });
    assert.equal(hideNo043.status, 200);
    assert.equal(hideNo043.body.data.is_active, false);
    assert.equal(hideNo043.body.data.blocked_reason, "[Admin] Sai nhãn hạn sử dụng");

    // Kể cả khi thiếu cột admin_hidden_at, tiền tố [Admin] trong blocked_reason vẫn chặn đối tác tự bật lại (409)!
    await assert.rejects(
      () => catalogService.updateProduct(PARTNER_1, "partner", PROD_2, { is_active: true }),
      (err) => err.statusCode === 409
    );
  } finally {
    fromHook = null;
  }
});

test("W5A-6 Payments: danh sách đính kèm order_number, tổng hợp theo provider/status và graceful 42P01", async () => {
  resetState();
  db.seed("orders", [
    { id: ORD_1, order_number: "FS-9001", customer_id: CUST_1, store_id: STORE_1, status: "confirmed", payment_status: "paid", total_cents: 55000 },
    { id: ORD_2, order_number: "FS-9002", customer_id: CUST_2, store_id: STORE_2, status: "cancelled", payment_status: "failed", total_cents: 30000 }
  ]);
  db.seed("payment_events", [
    { id: "pe-1", provider: "momo", provider_txn_id: "MOMO-TX-1", order_id: ORD_1, amount_cents: 55000, status: "processed", created_at: "2026-11-24T01:00:00.000Z" },
    { id: "pe-2", provider: "momo", provider_txn_id: "MOMO-TX-2", order_id: ORD_2, amount_cents: 30000, status: "rejected", created_at: "2026-11-24T02:00:00.000Z" },
    { id: "pe-3", provider: "vnpay", provider_txn_id: "VNP-TX-3", order_id: ORD_1, amount_cents: 55000, status: "processed", created_at: "2026-11-24T03:00:00.000Z" }
  ]);

  const listRes = await reqJson("GET", "/admin/payments?q=FS-9001&sort=amount_cents.desc", { token: "tok-admin" });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.data.total, 2);
  assert.equal(listRes.body.data.items[0].order_number, "FS-9001");

  const summaryRes = await reqJson("GET", "/admin/payments/summary", { token: "tok-admin" });
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.body.data.total_events, 3);
  assert.equal(summaryRes.body.data.total_amount_cents, 140000);
  assert.deepEqual(summaryRes.body.data.by_provider.momo, { count: 2, amount_cents: 85000 });
  assert.deepEqual(summaryRes.body.data.by_provider.vnpay, { count: 1, amount_cents: 55000 });
  assert.deepEqual(summaryRes.body.data.by_status.processed, { count: 2, amount_cents: 110000 });
  assert.deepEqual(summaryRes.body.data.by_status.rejected, { count: 1, amount_cents: 30000 });

  // Graceful 42P01 khi chưa chạy SQL 034
  fromHook = (name, passthrough) => (name === "payment_events" ? makeMissingTableChain("42P01") : passthrough());
  try {
    const emptyList = await reqJson("GET", "/admin/payments?page=1&limit=20", { token: "tok-admin" });
    assert.equal(emptyList.status, 200);
    assert.deepEqual(emptyList.body.data, { items: [], total: 0, page: 1, limit: 20 });

    const emptySummary = await reqJson("GET", "/admin/payments/summary", { token: "tok-admin" });
    assert.equal(emptySummary.status, 200);
    assert.deepEqual(emptySummary.body.data, {
      total_events: 0,
      total_amount_cents: 0,
      processed_amount_cents: 0,
      by_provider: {},
      by_status: {}
    });
  } finally {
    fromHook = null;
  }
});

test("W5A-7 Reviews: danh sách giàu ngữ cảnh, ẩn/bỏ ẩn tính lại sao trung bình cửa hàng & 42703-safe", async () => {
  resetState();
  db.seed("orders", [
    { id: ORD_1, order_number: "FS-7001", customer_id: CUST_1, store_id: STORE_1, status: "completed", payment_status: "paid", total_cents: 40000 },
    { id: ORD_2, order_number: "FS-7002", customer_id: CUST_2, store_id: STORE_1, status: "completed", payment_status: "paid", total_cents: 50000 }
  ]);
  db.seed("reviews", [
    { id: REV_1, order_id: ORD_1, customer_id: CUST_1, store_id: STORE_1, rating: 5, comment: "Bánh rất ngon", photo_urls: [], hidden_at: null, hidden_reason: null, hidden_by: null, created_at: "2026-11-24T01:00:00.000Z" },
    { id: REV_2, order_id: ORD_2, customer_id: CUST_2, store_id: STORE_1, rating: 1, comment: "Nội dung spam quảng cáo", photo_urls: [], hidden_at: null, hidden_reason: null, hidden_by: null, created_at: "2026-11-24T02:00:00.000Z" }
  ]);

  const listRes = await reqJson("GET", "/admin/reviews?sort=rating.asc", { token: "tok-admin" });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.data.total, 2);
  assert.equal(listRes.body.data.items[0].id, REV_2);
  assert.equal(listRes.body.data.items[0].store_name, "Tiệm Bánh Hoa Sữa");
  assert.equal(listRes.body.data.items[0].customer_name, "Trần Thị Lan");
  assert.equal(listRes.body.data.items[0].order_number, "FS-7002");

  // Theo dõi lời gọi sellerReputationService.updateSellerRatingAverage
  const ratingCalls = [];
  const origUpdateRating = sellerReputationService.updateSellerRatingAverage;
  sellerReputationService.updateSellerRatingAverage = async (sellerId, avg) => {
    ratingCalls.push({ sellerId, avg });
    return { seller_id: sellerId, trust_score: 100, rating_avg: avg, status: "Active", restricted_until: null, created_at: "", updated_at: "" };
  };

  try {
    // Ẩn REV_2 (rating 1) -> chỉ còn REV_1 (rating 5) hiển thị -> avg = 5
    const hideRes = await reqJson("POST", `/admin/reviews/${REV_2}/visibility`, {
      token: "tok-admin",
      body: { action: "hide", reason: "Bình luận chứa link spam" }
    });
    assert.equal(hideRes.status, 200);
    assert.ok(hideRes.body.data.hidden_at);
    assert.equal(hideRes.body.data.hidden_reason, "Bình luận chứa link spam");
    assert.deepEqual(ratingCalls, [{ sellerId: STORE_1, avg: 5 }]);
    assert.equal(db.table("stores").find((s) => s.id === STORE_1).rating, 5);
    assert.equal(audits("review.hide").length, 1);

    const visibleOnly = await reqJson("GET", "/admin/reviews?visibility=visible", { token: "tok-admin" });
    assert.deepEqual(visibleOnly.body.data.items.map((r) => r.id), [REV_1]);

    const hiddenOnly = await reqJson("GET", "/admin/reviews?visibility=hidden", { token: "tok-admin" });
    assert.deepEqual(hiddenOnly.body.data.items.map((r) => r.id), [REV_2]);

    // Kể cả khi sellerReputationService ném lỗi, thao tác unhide vẫn thành công và ghi audit
    sellerReputationService.updateSellerRatingAverage = async () => {
      throw new Error("pg offline");
    };
    const unhideRes = await reqJson("POST", `/admin/reviews/${REV_2}/visibility`, {
      token: "tok-admin",
      body: { action: "unhide" }
    });
    assert.equal(unhideRes.status, 200);
    assert.equal(unhideRes.body.data.hidden_at, null);
    assert.equal(audits("review.unhide").length, 1);
  } finally {
    sellerReputationService.updateSellerRatingAverage = origUpdateRating;
  }

  // Tương thích 42703 trên reviews khi chưa chạy SQL 043: GET vẫn trả 200, POST trả 409 rõ ràng thay vì 500
  fromHook = (name, passthrough) => {
    if (name === "reviews") {
      const real = passthrough();
      const origSelect = real.select.bind(real);
      const origUpdate = real.update.bind(real);
      real.select = (cols, opts) => {
        if (typeof cols === "string" && cols.includes("hidden_at")) {
          return makeMissingTableChain("42703");
        }
        return origSelect(cols, opts);
      };
      real.update = (patch) => {
        if (patch && "hidden_at" in patch) {
          return makeMissingTableChain("42703");
        }
        return origUpdate(patch);
      };
      return real;
    }
    return passthrough();
  };

  try {
    const listNo043 = await reqJson("GET", "/admin/reviews", { token: "tok-admin" });
    assert.equal(listNo043.status, 200);
    assert.equal(listNo043.body.data.total, 2);

    const hideNo043 = await reqJson("POST", `/admin/reviews/${REV_1}/visibility`, {
      token: "tok-admin",
      body: { action: "hide", reason: "Vi phạm ngôn từ" }
    });
    assert.equal(hideNo043.status, 409);
    assert.match(hideNo043.body.error.message, /043_admin_portal\.sql/);
  } finally {
    fromHook = null;
  }
});
