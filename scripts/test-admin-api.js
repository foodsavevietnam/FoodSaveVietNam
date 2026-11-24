/**
 * Kiểm thử nền backend cổng quản trị mới (Đợt 0.1): schema list chuẩn, phân trang, tìm kiếm, mount routes, stub auth.admin.
 * Chạy trên Supabase giả trong bộ nhớ (scripts/fake-supabase.js). Không kết nối mạng.
 *
 * Chạy: npm run test:admin
 */
Object.assign(process.env, {
  SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_ANON_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", CORS_ORIGINS: "http://localhost",
  DATABASE_URL: "postgres://x:x@127.0.0.1:9/x", DEMO_MODE: "false", ORDER_POLICY_TIME_SCALE: "1", LOG_LEVEL: "error",
  PAYMENT_PROVIDER: "simulated", PAYOUT_PROVIDER: "manual", PAYOUT_ENCRYPTION_KEY: require("crypto").randomBytes(32).toString("base64")
});
const assert = require("assert");
const http = require("http");
const { FakeDb, installFakeAuthAdmin } = require("./fake-supabase");

let db = new FakeDb();
let fakeTokens = new Map();
const sb = require("../dist/config/supabase");
sb.supabaseAdmin = {
  from: (name) => db.from(name),
  rpc: (name, args) => db.rpc(name, args),
  auth: { admin: installFakeAuthAdmin(() => db) }
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

const { adminListQuerySchema, sanitizeSearch } = require("../dist/schemas/adminSchemas");
const { paginate, applySearch } = require("../dist/services/adminListing");

const results = [];
async function run(name, fn) {
  try { db = new FakeDb(); fakeTokens = new Map(); await fn(); results.push([true, name]); console.log("  ĐẠT   " + name); }
  catch (error) { results.push([false, name]); console.log("  KHÔNG ĐẠT   " + name + "\n         " + (error && error.message || error)); }
}

(async () => {
  await run("A1 schema list: q giữ nguyên, sanitizeSearch làm sạch ký tự đặc biệt", async () => {
    const schema = adminListQuerySchema({ sortKeys: ["created_at.desc"] });
    const parsed = schema.parse({ page: "2", limit: "10", q: "a,(b)%" });
    assert.strictEqual(parsed.page, 2);
    assert.strictEqual(parsed.limit, 10);
    assert.strictEqual(parsed.q, "a,(b)%");
    assert.strictEqual(sanitizeSearch(parsed.q), "a  b ".trim());
    assert.throws(() => schema.parse({ sort: "khong_co" }));
    assert.throws(() => schema.parse({ la: "1" }), "strict: từ chối khóa lạ");
  });

  await run("A2 schema list: limit 101 bị từ chối", async () => {
    const schema = adminListQuerySchema({ sortKeys: ["created_at.desc"] });
    assert.throws(() => schema.parse({ limit: "101" }), (e) => e && e.name === "ZodError");
    assert.strictEqual(schema.parse({}).limit, 20);
  });

  await run("A3 paginate: 45 dòng, trang 3/20 -> 5 dòng, total 45; trang 1 -> 20 dòng đúng thứ tự", async () => {
    db.seed("things", Array.from({ length: 45 }, (_, i) => ({ id: "t" + String(i + 1).padStart(2, "0"), n: i + 1 })));
    const q = (page) => sb.supabaseAdmin.from("things").select("id,n", { count: "exact" }).order("n", { ascending: true });
    const p3 = await paginate(q(3), { page: 3, limit: 20 });
    assert.strictEqual(p3.items.length, 5);
    assert.strictEqual(p3.total, 45);
    assert.strictEqual(p3.page, 3);
    assert.strictEqual(p3.limit, 20);
    assert.strictEqual(p3.items[0].n, 41);
    const p1 = await paginate(q(1), { page: 1, limit: 20 });
    assert.strictEqual(p1.items.length, 20);
    assert.strictEqual(p1.total, 45);
    assert.strictEqual(p1.items[0].n, 1);
    assert.strictEqual(p1.items[19].n, 20);
  });

  await run("A4 routes admin mới được mount sau requireRoles", async () => {
    const { adminRoutes } = require("../dist/routes/adminRoutes");
    const { adminPortalRoutes } = require("../dist/routes/admin");
    const stack = adminRoutes.stack;
    const portalIdx = stack.findIndex((l) => l.handle === adminPortalRoutes);
    assert.ok(portalIdx >= 0, "adminPortalRoutes chưa được mount");
    const firstUse = stack.findIndex((l) => !l.route);
    assert.ok(portalIdx > firstUse, "adminPortalRoutes phải nằm sau layer requireRoles");
  });

  await run("A5 applySearch: lọc không phân biệt hoa thường, q rỗng không lọc, ký tự đặc biệt không vỡ .or()", async () => {
    db.seed("profiles", [
      { id: "1", full_name: "Nguyễn AN", phone: "0901" },
      { id: "2", full_name: "Bình", phone: "0902" },
      { id: "3", full_name: "Cường", phone: "0903an" }
    ]);
    const base = () => sb.supabaseAdmin.from("profiles").select("id,full_name,phone");
    const ids = async (q) => (await applySearch(base(), q, ["full_name", "phone"])).data.map((r) => r.id).sort();
    assert.deepStrictEqual(await ids("an"), ["1", "3"]);
    assert.deepStrictEqual(await ids("AN"), ["1", "3"]);
    assert.deepStrictEqual(await ids(""), ["1", "2", "3"]);
    assert.deepStrictEqual(await ids(undefined), ["1", "2", "3"]);
    assert.deepStrictEqual(await ids("   "), ["1", "2", "3"]);
    assert.deepStrictEqual(await ids("a,(b)%\\"), []);
  });

  await run("A6 auth.admin giả: createUser, getUserById, deleteUser", async () => {
    const admin = sb.supabaseAdmin.auth.admin;
    const created = await admin.createUser({ email: "x@mio.vn", password: "p", email_confirm: true });
    assert.ok(!created.error && created.data.user.id);
    const got = await admin.getUserById(created.data.user.id);
    assert.strictEqual(got.data.user.email, "x@mio.vn");
    assert.strictEqual((await admin.listUsers()).data.users.length, 1);
    assert.ok(!(await admin.deleteUser(created.data.user.id)).error);
    assert.ok((await admin.getUserById(created.data.user.id)).error, "đã xóa thì không còn");
  });

  await run("B1 workStrip: tách rút tiền / tài khoản chờ duyệt, giữ withdrawals_pending là tổng", async () => {
    const { adminOpsService } = require("../dist/services/adminOpsService");
    db.seed("withdrawals", [{ id: "w1", status: "requested" }, { id: "w2", status: "requested" }, { id: "w3", status: "paid" }]);
    db.seed("store_payout_accounts", [{ id: "p1", status: "pending_verification" }, { id: "p2", status: "verified" }]);
    db.seed("donations", [{ id: "d1", status: "open" }, { id: "d2", status: "completed" }]);
    db.seed("live_locations", [
      { actor_kind: "shipper", actor_id: "a1", updated_at: new Date(Date.now() - 5 * 60_000).toISOString() },
      { actor_kind: "shipper", actor_id: "a2", updated_at: new Date(Date.now() - 40 * 60_000).toISOString() }
    ]);
    const w = await adminOpsService.workStrip();
    assert.strictEqual(w.withdrawals_requested, 2);
    assert.strictEqual(w.payout_accounts_pending, 1);
    assert.strictEqual(w.withdrawals_pending, 3);
    assert.strictEqual(w.donations_open, 1);
    assert.strictEqual(w.tracking_active, 1, "chỉ dòng cập nhật trong 30 phút");
    assert.deepStrictEqual(w.orders_today, { new: 0, completed: 0, no_show: 0 });
  });

  await run("B2 orders_today theo mốc 00:00 +07:00; startOfTodayVn là hàm thuần", async () => {
    const { adminOpsService, startOfTodayVn } = require("../dist/services/adminOpsService");
    assert.strictEqual(startOfTodayVn(new Date("2026-11-23T05:00:00Z")), "2026-11-22T17:00:00.000Z");
    assert.strictEqual(startOfTodayVn(new Date("2026-11-22T17:30:00Z")), "2026-11-22T17:00:00.000Z", "00:30 VN ngày 23");
    assert.strictEqual(startOfTodayVn(new Date("2026-11-22T16:59:00Z")), "2026-11-21T17:00:00.000Z", "23:59 VN ngày 22");
    assert.strictEqual(startOfTodayVn(new Date("2026-11-22T17:00:00.000Z")), "2026-11-22T17:00:00.000Z", "đúng 00:00 VN");
    const realNow = Date.now;
    Date.now = () => new Date("2026-11-23T05:00:00Z").getTime();
    const RealDate = Date;
    global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [realNowValue()])); } static now() { return realNowValue(); } };
    function realNowValue() { return new RealDate("2026-11-23T05:00:00Z").getTime(); }
    try {
      db.seed("orders", [
        { id: "o1", status: "pending", created_at: "2026-11-22T16:30:00Z", updated_at: "2026-11-22T16:30:00Z" },
        { id: "o2", status: "pending", created_at: "2026-11-22T17:10:00Z", updated_at: "2026-11-22T17:10:00Z" },
        { id: "o3", status: "completed", created_at: "2026-11-20T01:00:00Z", completed_at: "2026-11-22T17:10:00Z", updated_at: "2026-11-22T17:10:00Z" },
        { id: "o4", status: "completed", created_at: "2026-11-20T01:00:00Z", completed_at: "2026-11-22T16:30:00Z", updated_at: "2026-11-22T16:30:00Z" },
        { id: "o5", status: "no_show", created_at: "2026-11-20T01:00:00Z", no_show_at: "2026-11-23T01:00:00Z", updated_at: "2026-11-23T01:00:00Z" },
        { id: "o6", status: "no_show", created_at: "2026-11-20T01:00:00Z", no_show_at: "2026-11-22T16:30:00Z", updated_at: "2026-11-22T16:30:00Z" },
        { id: "o7", status: "no_show", created_at: "2026-11-20T01:00:00Z", no_show_at: "2026-11-22T10:00:00Z", updated_at: "2026-11-23T02:00:00Z" }
      ]);
      const w = await adminOpsService.workStrip();
      assert.deepStrictEqual(w.orders_today, { new: 1, completed: 1, no_show: 1 });
    } finally { global.Date = RealDate; Date.now = realNow; }
  });

  await run("B3 audit list: lọc tiền tố action + target_id, ký tự đại diện bị thoát", async () => {
    const { adminAuditService } = require("../dist/services/adminAuditService");
    db.seed("admin_audit_log", [
      { id: "a1", action: "verification.approve", target_id: "T1", actor_id: "u1", created_at: "2026-11-23T01:00:00Z" },
      { id: "a2", action: "verification.reject", target_id: "T2", actor_id: "u1", created_at: "2026-11-23T02:00:00Z" },
      { id: "a3", action: "voucher.create", target_id: "T1", actor_id: "u2", created_at: "2026-11-23T03:00:00Z" },
      { id: "a4", action: "verificationX.approve", target_id: "T1", actor_id: "u1", created_at: "2026-11-23T04:00:00Z" }
    ]);
    const ids = async (limit, f) => (await adminAuditService.list(limit, f)).map((r) => r.id);
    assert.deepStrictEqual(await ids(100, { action: "verification.", target_id: "T1" }), ["a1"]);
    assert.deepStrictEqual(await ids(100), ["a4", "a3", "a2", "a1"], "không lọc: như cũ");
    assert.deepStrictEqual(await ids(100, { action: "verification_" }), [], "_ không là ký tự đại diện");
    assert.deepStrictEqual(await ids(100, { actor_id: "u2" }), ["a3"]);
    assert.deepStrictEqual(await ids(100, { from: "2026-11-23T02:00:00Z", to: "2026-11-23T03:00:00Z" }), ["a3", "a2"]);
  });

  await run("B4 ledger_unbalanced / automation_failed: đúng khi có lỗi thật, lỗi truy vấn -> 0", async () => {
    const { adminOpsService } = require("../dist/services/adminOpsService");
    db.seedSystemWallets();
    db.wallet("w-escrow").balance_cents = 500; // lệch sổ cái
    assert.strictEqual((await adminOpsService.workStrip()).ledger_unbalanced, 1);
    db.wallet("w-escrow").balance_cents = 0;
    assert.strictEqual((await adminOpsService.workStrip()).ledger_unbalanced, 0);
    const realRpc = sb.supabaseAdmin.rpc, realFrom = sb.supabaseAdmin.from;
    sb.supabaseAdmin.rpc = async () => ({ data: null, error: { message: "boom" } });
    try { assert.strictEqual((await adminOpsService.workStrip()).ledger_unbalanced, 0, "RPC lỗi -> 0"); } finally { sb.supabaseAdmin.rpc = realRpc; }
    const recent = new Date().toISOString();
    db.seed("automation_runs", [
      { id: "r1", job: "label-automation", trigger: "cron", started_at: recent, ok: false, error: "x" },
      { id: "r2", job: "order-automation", trigger: "cron", started_at: recent, ok: true }
    ]);
    assert.strictEqual((await adminOpsService.workStrip()).automation_failed, 1);
    sb.supabaseAdmin.from = (name) => { if (name === "automation_runs") throw new Error("boom"); return realFrom(name); };
    try {
      const w = await adminOpsService.workStrip();
      assert.strictEqual(w.automation_failed, 0, "lỗi -> 0");
      assert.strictEqual(w.ledger_unbalanced, 0, "phần khác vẫn chạy");
    } finally { sb.supabaseAdmin.from = realFrom; }
  });

  await run("B5 schema audit-log: từ chối limit 301, from không phải thời điểm, khóa lạ", async () => {
    const { auditLogQuerySchema } = require("../dist/routes/adminRoutes");
    assert.strictEqual(auditLogQuerySchema.parse({}).limit, 100);
    assert.throws(() => auditLogQuerySchema.parse({ limit: "301" }));
    assert.throws(() => auditLogQuerySchema.parse({ from: "hôm qua" }));
    assert.throws(() => auditLogQuerySchema.parse({ la: "1" }));
    assert.throws(() => auditLogQuerySchema.parse({ actor_id: "khong-phai-uuid" }));
    assert.ok(auditLogQuerySchema.parse({ from: "2026-11-23T00:00:00+07:00", action: "verification.", target_type: "store" }));
  });

  await run("C1 adminSettingsService: set + audit settings.update; marketingService.adminSetSettings vẫn chạy", async () => {
    const { adminSettingsService } = require("../dist/services/adminSettingsService");
    const actor = { userId: "u1", name: "Quản trị" };
    assert.deepStrictEqual(await adminSettingsService.get("ai_agent", { enabled: true }), { enabled: true }, "chưa có -> fallback");
    await adminSettingsService.set("ai_agent", { enabled: false }, actor);
    assert.deepStrictEqual(await adminSettingsService.get("ai_agent", {}), { enabled: false });
    const logs = db.table("admin_audit_log").filter((r) => r.action === "settings.update");
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].target_type, "app_setting");
    assert.strictEqual(logs[0].target_id, "ai_agent");
    assert.deepStrictEqual(logs[0].detail, { key: "ai_agent", before: null, after: { enabled: false } });
    await adminSettingsService.set("khac", 1);
    assert.strictEqual(db.table("admin_audit_log").length, 1, "không actor -> không audit");
    const { marketingService } = require("../dist/services/marketingService");
    await marketingService.adminSetSettings({ ai_enabled: true });
    assert.strictEqual((await marketingService.adminSetSettings({ auto_enabled: false })).auto_enabled, false);
    assert.strictEqual((await adminSettingsService.get("ai_agent", {})).enabled, true);
  });

  await run("C2 adminSettingsService.set lỗi upsert -> AppError, không ghi audit", async () => {
    const { adminSettingsService } = require("../dist/services/adminSettingsService");
    const realFrom = sb.supabaseAdmin.from;
    sb.supabaseAdmin.from = (name) => { if (name === "app_settings") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), upsert: async () => ({ error: { message: "boom" } }) }; return realFrom(name); };
    try {
      await assert.rejects(() => adminSettingsService.set("ai_agent", { enabled: false }, { userId: "u1" }), (e) => e.message === "Không lưu được cài đặt. Hãy chạy file SQL 026 trên Supabase." && e.statusCode === 500);
    } finally { sb.supabaseAdmin.from = realFrom; }
    assert.strictEqual(db.table("admin_audit_log").length, 0);
  });

  // ---- D: nhật ký Admin cho các hành động quyết định ở controller (service stub, audit ghi vào FakeDb) ----
  const { adminController } = require("../dist/controllers/adminController");
  const { ledgerService } = require("../dist/services/ledgerService");
  const { payoutAccountService } = require("../dist/services/payoutAccountService");
  const { complaintService } = require("../dist/services/complaintService");
  const fakeReq = (params, body) => ({ validated: { params, body }, user: { id: "adm1" }, profile: { role: "admin", full_name: "Admin Thử" } });
  const fakeRes = () => { const r = { code: 0, json(b) { r.body = b; return r; }, status(c) { r.code = c; return r; } }; return r; };
  const audits = (action) => db.table("admin_audit_log").filter((r) => !action || r.action === action);
  const stubbed = async (obj, name, impl, fn) => { const real = obj[name]; obj[name] = impl; try { await fn(); } finally { obj[name] = real; } };
  const boom = async () => { throw new Error("service lỗi"); };

  await run("D1 decideWithdrawal: 5 quyết định -> mỗi lần đúng 1 dòng withdrawal.<decision>; service lỗi -> 0 dòng", async () => {
    await stubbed(ledgerService, "transitionWithdrawal", async () => ({ id: "w1", status: "x" }), async () => {
      for (const decision of ["approve", "reject", "start", "pay", "fail"]) {
        const body = { decision, ...(decision === "pay" ? { bank_txn_ref: "FT123" } : {}), ...(decision === "reject" || decision === "fail" ? { note: "Lý do thử" } : {}) };
        await adminController.decideWithdrawal(fakeReq({ id: "w1" }, body), fakeRes());
        const rows = audits("withdrawal." + decision);
        assert.strictEqual(rows.length, 1, decision);
        assert.strictEqual(rows[0].target_type, "withdrawal");
        assert.strictEqual(rows[0].target_id, "w1");
        assert.strictEqual(rows[0].actor_id, "adm1");
        const detail = {}; if (body.note) detail.note = body.note; if (body.bank_txn_ref) detail.bank_txn_ref = body.bank_txn_ref;
        assert.deepStrictEqual(rows[0].detail, detail);
      }
    });
    const before = audits().length;
    await stubbed(ledgerService, "transitionWithdrawal", boom, async () => {
      await assert.rejects(() => adminController.decideWithdrawal(fakeReq({ id: "w1" }, { decision: "approve" }), fakeRes()));
    });
    assert.strictEqual(audits().length, before, "lỗi -> không ghi");
  });

  await run("D2 revealWithdrawalAccount: 1 dòng payout_account.reveal, detail không chứa số tài khoản; lỗi -> 0 dòng", async () => {
    const SECRET = "9704123456789012";
    await stubbed(payoutAccountService, "revealForWithdrawal", async () => ({ bank_name: "VCB", account_holder_name: "A", account_number: SECRET }), async () => {
      const res = fakeRes();
      await adminController.revealWithdrawalAccount(fakeReq({ id: "w1" }, {}), res);
      assert.ok(JSON.stringify(res.body).includes(SECRET), "response vẫn trả số cho admin");
    });
    const rows = audits("payout_account.reveal");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].target_type, "withdrawal");
    assert.strictEqual(rows[0].target_id, "w1");
    assert.deepStrictEqual(rows[0].detail, {});
    assert.ok(!JSON.stringify(rows[0]).includes(SECRET), "không lộ số tài khoản trong nhật ký");
    await stubbed(payoutAccountService, "revealForWithdrawal", boom, async () => {
      await assert.rejects(() => adminController.revealWithdrawalAccount(fakeReq({ id: "w1" }, {}), fakeRes()));
    });
    assert.strictEqual(audits().length, 1);
  });

  await run("D3 decidePayoutAccount: payout_account.verify/reject đúng 1 dòng, detail {note}; lỗi -> 0 dòng", async () => {
    await stubbed(payoutAccountService, "decide", async () => ({ id: "pa1" }), async () => {
      await adminController.decidePayoutAccount(fakeReq({ id: "pa1" }, { decision: "verify" }), fakeRes());
      await adminController.decidePayoutAccount(fakeReq({ id: "pa1" }, { decision: "reject", note: "Sai tên" }), fakeRes());
    });
    const v = audits("payout_account.verify"), r = audits("payout_account.reject");
    assert.strictEqual(v.length, 1); assert.strictEqual(r.length, 1);
    assert.strictEqual(v[0].target_type, "payout_account");
    assert.strictEqual(v[0].target_id, "pa1");
    assert.deepStrictEqual(v[0].detail, {});
    assert.deepStrictEqual(r[0].detail, { note: "Sai tên" });
    await stubbed(payoutAccountService, "decide", boom, async () => {
      await assert.rejects(() => adminController.decidePayoutAccount(fakeReq({ id: "pa1" }, { decision: "verify" }), fakeRes()));
    });
    assert.strictEqual(audits().length, 2);
  });

  await run("D4 decideComplaint: complaint.<decision> đúng 1 dòng, detail chỉ trường có giá trị; lỗi -> 0 dòng", async () => {
    await stubbed(complaintService, "decide", async () => ({ id: "c1" }), async () => {
      await adminController.decideComplaint(fakeReq({ id: "c1" }, { decision: "refund_full", note: "Hoàn" }), fakeRes());
      await adminController.decideComplaint(fakeReq({ id: "c1" }, { decision: "refund_partial", refund_cents: 5000, note: "Một phần" }), fakeRes());
      await adminController.decideComplaint(fakeReq({ id: "c1" }, { decision: "reject", is_false_claim: true, note: "Sai" }), fakeRes());
    });
    const full = audits("complaint.refund_full"), part = audits("complaint.refund_partial"), rej = audits("complaint.reject");
    assert.strictEqual(full.length, 1); assert.strictEqual(part.length, 1); assert.strictEqual(rej.length, 1);
    assert.strictEqual(full[0].target_type, "complaint");
    assert.strictEqual(full[0].target_id, "c1");
    assert.deepStrictEqual(full[0].detail, { note: "Hoàn" });
    assert.deepStrictEqual(part[0].detail, { refund_cents: 5000, note: "Một phần" });
    assert.deepStrictEqual(rej[0].detail, { is_false_claim: true, note: "Sai" });
    await stubbed(complaintService, "decide", boom, async () => {
      await assert.rejects(() => adminController.decideComplaint(fakeReq({ id: "c1" }, { decision: "reject", note: "x" }), fakeRes()));
    });
    assert.strictEqual(audits().length, 3);
  });

  // ---- E: Kiểm thử HTTP thực qua authMiddleware + requireRoles("admin") & các bản vá Wave 3C ----
  const { app } = require("../dist/app");
  const { locationService } = require("../dist/services/locationService");
  const withHttpServer = async (fn) => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}/api/v1`;
    const reqJson = async (method, path, { token, body } = {}) => {
      const headers = {};
      if (token) headers.Authorization = "Bearer " + token;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(baseUrl + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, body: json };
    };
    try { await fn(reqJson); } finally { await new Promise((resolve) => server.close(resolve)); }
  };

  const seedUser = (token, { id, role, status = "active", full_name = "User" }) => {
    fakeTokens.set(token, { id, email: id + "@mio.vn" });
    db.seed("profiles", [{ id, role, status, full_name }]);
  };

  const ADM_ID = "11111111-1111-4111-8111-111111111111";
  const ADM_SUSP_ID = "11111111-1111-4111-8111-111111111112";
  const CUST_ID = "22222222-2222-4222-8222-222222222221";
  const PARTNER_ID = "33333333-3333-4333-8333-333333333331";
  const CHARITY_ID = "44444444-4444-4444-8444-444444444441";
  const STORE_A = "55555555-5555-4555-8555-555555555551";
  const STORE_B = "55555555-5555-4555-8555-555555555552";

  await run("E1 HTTP authMiddleware + requireRoles('admin'): không token 401, role khác/suspended 403, admin active 200 + marketing_queue", async () => {
    seedUser("tok-admin", { id: ADM_ID, role: "admin", status: "active", full_name: "Admin Chính" });
    seedUser("tok-admin-susp", { id: ADM_SUSP_ID, role: "admin", status: "suspended", full_name: "Admin Khóa" });
    seedUser("tok-customer", { id: CUST_ID, role: "customer", status: "active", full_name: "Khách" });
    seedUser("tok-partner", { id: PARTNER_ID, role: "partner", status: "active", full_name: "Đối tác" });
    seedUser("tok-charity", { id: CHARITY_ID, role: "charity", status: "active", full_name: "Từ thiện" });
    db.seed("marketing_posts", [
      { id: "mp1", status: "queued" },
      { id: "mp2", status: "ready" },
      { id: "mp3", status: "sent" },
      { id: "mp4", status: "failed" }
    ]);

    await withHttpServer(async (reqJson) => {
      assert.strictEqual((await reqJson("GET", "/admin/dashboard/work")).status, 401, "không token -> 401");
      assert.strictEqual((await reqJson("GET", "/admin/dashboard/work", { token: "tok-bad" })).status, 401, "token sai -> 401");
      assert.strictEqual((await reqJson("GET", "/admin/dashboard/work", { token: "tok-customer" })).status, 403, "customer -> 403");
      assert.strictEqual((await reqJson("GET", "/admin/dashboard/work", { token: "tok-partner" })).status, 403, "partner -> 403");
      assert.strictEqual((await reqJson("GET", "/admin/dashboard/work", { token: "tok-charity" })).status, 403, "charity -> 403");
      assert.strictEqual((await reqJson("GET", "/admin/dashboard/work", { token: "tok-admin-susp" })).status, 403, "admin suspended -> 403");

      const ok = await reqJson("GET", "/admin/dashboard/work", { token: "tok-admin" });
      assert.strictEqual(ok.status, 200, "admin active -> 200");
      assert.strictEqual(ok.body.success, true);
      assert.strictEqual(ok.body.data.marketing_queue, 2, "marketing_queue đếm queued + ready");
    });
  });

  await run("E2 HTTP GET /admin/withdrawals: hỗ trợ đủ 6 trạng thái, store_id và phân trang tùy chọn", async () => {
    seedUser("tok-admin", { id: ADM_ID, role: "admin", status: "active", full_name: "Admin" });
    db.seed("stores", [
      { id: STORE_A, owner_id: PARTNER_ID, name: "Tiệm A" },
      { id: STORE_B, owner_id: PARTNER_ID, name: "Tiệm B" }
    ]);
    const statuses = ["requested", "approved", "processing", "paid", "rejected", "failed"];
    db.seed("withdrawals", statuses.map((st, idx) => ({
      id: `66666666-6666-4666-8666-66666666660${idx + 1}`,
      store_id: idx % 2 === 0 ? STORE_A : STORE_B,
      status: st,
      amount_cents: 100000 * (idx + 1),
      requested_at: `2026-11-2${idx}T01:00:00.000Z`
    })));

    await withHttpServer(async (reqJson) => {
      for (const st of statuses) {
        const res = await reqJson("GET", `/admin/withdrawals?status=${st}`, { token: "tok-admin" });
        assert.strictEqual(res.status, 200, `status=${st} -> 200`);
        assert.ok(Array.isArray(res.body.data), "không truyền page -> trả mảng tương thích ngược");
        assert.strictEqual(res.body.data.length, 1);
        assert.strictEqual(res.body.data[0].status, st);
      }
      const byStore = await reqJson("GET", `/admin/withdrawals?status=paid&store_id=${STORE_B}`, { token: "tok-admin" });
      assert.strictEqual(byStore.status, 200);
      assert.strictEqual(byStore.body.data.length, 1);
      assert.strictEqual(byStore.body.data[0].store_id, STORE_B);

      const paged = await reqJson("GET", "/admin/withdrawals?page=2&limit=2", { token: "tok-admin" });
      assert.strictEqual(paged.status, 200);
      assert.strictEqual(paged.body.data.total, 6);
      assert.strictEqual(paged.body.data.page, 2);
      assert.strictEqual(paged.body.data.limit, 2);
      assert.strictEqual(paged.body.data.items.length, 2);

      const bad = await reqJson("GET", "/admin/withdrawals?status=la", { token: "tok-admin" });
      assert.strictEqual(bad.status, 422, "status không hợp lệ -> 422");
    });
  });

  await run("E3 HTTP PATCH /admin/withdrawals/:id: bấm lặp idempotent không ghi trùng admin_audit_log và giữ nguyên shape JSON", async () => {
    seedUser("tok-admin", { id: ADM_ID, role: "admin", status: "active", full_name: "Admin" });
    db.seedSystemWallets();
    db.seed("stores", [{ id: STORE_A, owner_id: PARTNER_ID, name: "Tiệm A" }]);
    const wdId = "77777777-7777-4777-8777-777777777771";
    const paId = "77777777-7777-4777-8777-777777777772";
    db.seed("store_payout_accounts", [{ id: paId, store_id: STORE_A, status: "verified" }]);
    db.seed("withdrawals", [{ id: wdId, store_id: STORE_A, payout_account_id: paId, amount_cents: 100000, status: "requested", requested_at: new Date().toISOString() }]);

    await withHttpServer(async (reqJson) => {
      const first = await reqJson("PATCH", `/admin/withdrawals/${wdId}`, { token: "tok-admin", body: { decision: "approve", note: "OK" } });
      assert.strictEqual(first.status, 200);
      assert.strictEqual(first.body.data.status, "approved");
      assert.strictEqual(Object.prototype.hasOwnProperty.call(first.body.data, "changed"), false, "không lộ khóa changed ra JSON client");
      assert.strictEqual(audits("withdrawal.approve").length, 1);

      const second = await reqJson("PATCH", `/admin/withdrawals/${wdId}`, { token: "tok-admin", body: { decision: "approve", note: "OK" } });
      assert.strictEqual(second.status, 200);
      assert.strictEqual(second.body.data.status, "approved");
      assert.strictEqual(audits("withdrawal.approve").length, 1, "bấm lặp idempotent không ghi trùng audit log");
    });
  });

  await run("E4 HTTP audit log cho 5 lỗ hổng: approvePartner, rejectPartner, runReconcile, order.chat_view, marketing settings/run", async () => {
    seedUser("tok-admin", { id: ADM_ID, role: "admin", status: "active", full_name: "Admin Kiểm Toán" });
    seedUser("tok-customer", { id: CUST_ID, role: "customer", status: "active", full_name: "Khách" });
    db.seed("profiles", [{ id: PARTNER_ID, role: "partner", status: "pending", full_name: "Chủ Quán" }]);
    db.seedSystemWallets();
    db.seed("stores", [{ id: STORE_A, owner_id: PARTNER_ID, name: "Tiệm Kiểm Toán", status: "pending" }]);
    const orderId = "88888888-8888-4888-8888-888888888881";
    const productId = "88888888-8888-4888-8888-888888888882";
    db.seed("orders", [{ id: orderId, order_number: "MIO-999", customer_id: CUST_ID, store_id: STORE_A, status: "completed", payment_status: "paid" }]);
    db.seed("complaints", [{ id: "88888888-8888-4888-8888-888888888883", order_id: orderId, status: "in_review" }]);
    db.seed("order_messages", [{ id: "m1", order_id: orderId, sender_id: CUST_ID, sender_role: "customer", body: "Xin chào", read_at: null, created_at: new Date().toISOString() }]);
    db.seed("products", [{
      id: productId, store_id: STORE_A, name: "Bánh mì", description: null, image_url: null, image_urls: null, emoji: "🥖",
      category: "bakery", food_group: "cooked", price_cents: 10000, original_price_cents: 50000, label: "red",
      stock_quantity: 5, is_active: true, expires_at: new Date(Date.now() + 3 * 3600_000).toISOString(), effective_deadline_at: null
    }]);

    await withHttpServer(async (reqJson) => {
      assert.strictEqual((await reqJson("POST", `/admin/approve/${PARTNER_ID}`, { token: "tok-admin" })).status, 200);
      assert.strictEqual(audits("partner.approve").length, 1);
      assert.strictEqual(audits("partner.approve")[0].target_id, PARTNER_ID);

      assert.strictEqual((await reqJson("POST", `/admin/reject/${PARTNER_ID}`, { token: "tok-admin", body: { reason: "Thiếu hồ sơ" } })).status, 200);
      assert.strictEqual(audits("partner.reject").length, 1);
      assert.strictEqual(audits("partner.reject")[0].detail.reason, "Thiếu hồ sơ");

      assert.strictEqual((await reqJson("POST", "/admin/finance/reconcile", { token: "tok-admin" })).status, 200);
      assert.strictEqual(audits("finance.reconcile").length, 1);

      assert.strictEqual((await reqJson("GET", `/orders/${orderId}/messages`, { token: "tok-customer" })).status, 200);
      assert.strictEqual(audits("order.chat_view").length, 0, "khách xem chat không ghi audit admin");
      assert.strictEqual((await reqJson("GET", `/orders/${orderId}/messages`, { token: "tok-admin" })).status, 200);
      assert.strictEqual(audits("order.chat_view").length, 1);
      assert.strictEqual(audits("order.chat_view")[0].target_type, "order");
      assert.strictEqual(audits("order.chat_view")[0].target_id, orderId);

      assert.strictEqual((await reqJson("PATCH", "/marketing/admin/settings", { token: "tok-admin", body: { ai_enabled: false } })).status, 200);
      assert.strictEqual(audits("settings.update").length, 1);
      assert.strictEqual(audits("settings.update")[0].target_id, "ai_agent");

      assert.strictEqual((await reqJson("POST", "/marketing/admin/run", { token: "tok-admin", body: { product_ids: [productId] } })).status, 200);
      assert.strictEqual(audits("marketing.run").length, 1);
    });
  });

  await run("E5 locationService.listForAdmin: thiếu bảng live_locations (42P01 / PGRST205) trả mảng rỗng thay vì ném 500", async () => {
    const realFrom = sb.supabaseAdmin.from;
    for (const code of ["42P01", "PGRST205"]) {
      sb.supabaseAdmin.from = (name) => {
        if (name === "live_locations") {
          const chain = {
            select: () => chain,
            gte: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: async () => ({ data: null, error: { code, message: "relation live_locations does not exist" } })
          };
          return chain;
        }
        return realFrom(name);
      };
      try {
        const rows = await locationService.listForAdmin({});
        assert.deepStrictEqual(rows, [], `mã lỗi ${code} phải trả []`);
      } finally {
        sb.supabaseAdmin.from = realFrom;
      }
    }
  });

  await run("E6 poll.js: giãn backoff và tạm dừng job sau 3 lỗi liên tiếp, reset về 0 khi resume/chuyển tab hoặc chạy thành công", async () => {
    const { createPoll } = await import("../public/admin/core/poll.js");
    const st = { t: 0, vis: true };
    let failMode = true;
    let calls = 0;
    const poll = createPoll({ now: () => st.t, visible: () => st.vis, minGapMs: 10000 });
    poll.add("job5xx", () => {
      calls += 1;
      if (failMode) throw new Error("HTTP 500");
    }, { everyMs: 60000, immediate: true });
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      // Lỗi lần 1 ở t=0 -> backoff 2x (120s)
      poll.tick();
      assert.strictEqual(calls, 1);
      st.t = 60000; poll.tick();
      assert.strictEqual(calls, 1, "đang backoff 2x, 60s chưa chạy lại");
      // Lỗi lần 2 ở t=120000 -> backoff 4x (240s)
      st.t = 120000; poll.tick();
      assert.strictEqual(calls, 2);
      st.t = 240000; poll.tick();
      assert.strictEqual(calls, 2, "đang backoff 4x, 120s sau chưa chạy lại");
      // Lỗi lần 3 ở t=360000 -> tạm dừng job (vẫn đang active, chưa chạm idleMs 900000)
      st.t = 360000; poll.tick();
      assert.strictEqual(calls, 3);
      st.t = 840000; poll.tick();
      assert.strictEqual(poll.isPaused(), false, "vẫn đang trong cửa sổ hoạt động");
      assert.strictEqual(calls, 3, "sau 3 lỗi liên tiếp job bị tạm dừng hẳn dù không idle");
      // Người dùng bấm tiếp tục (resume) -> reset bộ đếm lỗi, chạy lại và thành công
      failMode = false;
      poll.resume();
      st.t = 840000 + 60000; poll.tick();
      assert.strictEqual(calls, 4, "sau resume job chạy lại");
      st.t += 60000; poll.tick();
      assert.strictEqual(calls, 5, "chạy thành công -> trở lại nhịp bình thường 60s");
    } finally {
      console.warn = realWarn;
    }
  });

  const failed = results.filter((r) => !r[0]).length;
  console.log("\n" + (results.length - failed) + "/" + results.length + " kịch bản đạt" + (failed ? ", " + failed + " KHÔNG ĐẠT" : "") + ".\n");
  process.exit(failed ? 1 : 0);
})();
