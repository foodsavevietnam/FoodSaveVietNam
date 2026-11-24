import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";

Object.assign(process.env, {
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  CORS_ORIGINS: "http://localhost",
  DATABASE_URL: "postgres://x:x@127.0.0.1:9/x",
  DEMO_MODE: "false",
  ORDER_POLICY_TIME_SCALE: "1",
  LOG_LEVEL: "error",
  PAYMENT_PROVIDER: "simulated",
  PAYOUT_PROVIDER: "manual",
  PAYOUT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64")
});

const require = createRequire(import.meta.url);
const { FakeDb, installFakeAuthAdmin } = require("../scripts/fake-supabase.js");

let db = new FakeDb();
let fakeTokens = new Map();

const sb = require("../dist/config/supabase.js");
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
require("../dist/config/postgres.js").isPostgresAvailable = async () => false;

const { app } = require("../dist/app.js");
const {
  SETTINGS_REGISTRY,
  listManagedSettings,
  updateManagedSetting,
  adminSettingsService
} = require("../dist/services/adminSettingsService.js");
const {
  adminPortal4Service,
  resetBroadcastCooldowns,
  maskApplicationSensitiveFields
} = require("../dist/services/adminPortal4Service.js");
const { adminNotifyLimiter } = require("../dist/routes/admin/systemRoutes.js");
const { pushService, setPushTransport } = require("../dist/services/pushService.js");

const ADM_1 = "11111111-1111-4111-8111-111111111101";
const ADM_2 = "11111111-1111-4111-8111-111111111102";
const CUST_1 = "22222222-2222-4222-8222-222222222201";
const CUST_2 = "22222222-2222-4222-8222-222222222202";
const PARTNER_1 = "33333333-3333-4333-8333-333333333301";
const CHARITY_1 = "44444444-4444-4444-8444-444444444401";
const STORE_1 = "55555555-5555-4555-8555-555555555501";

const resetState = () => {
  db = new FakeDb();
  fakeTokens = new Map();
  resetBroadcastCooldowns();
  adminNotifyLimiter.resetKey(`user:${ADM_1}`);
  adminNotifyLimiter.resetKey(`user:${ADM_2}`);
  setPushTransport(null);
};

const seedAuthProfile = (token, { id, role, status = "active", full_name = "User", email, phone = null }) => {
  const resolvedEmail = email ?? `${id}@mio.vn`;
  fakeTokens.set(token, { id, email: resolvedEmail });
  db.seed("auth_users", [{ id, email: resolvedEmail, last_sign_in_at: "2026-11-24T08:00:00.000Z" }]);
  db.seed("profiles", [{ id, role, status, full_name, email: resolvedEmail, phone, created_at: "2026-11-20T01:00:00.000Z" }]);
};

const audits = (action) =>
  db.table("admin_audit_log").filter((row) => !action || row.action === action);

const withServer = async (fn) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
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
  try {
    await fn(reqJson);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "");
}

/* ─────────────────────────── 1. SQL 044 Integrity ─────────────────────────── */

test("SQL 044_admin_dashboard_rpc.sql: transaction, lock_timeout, SECURITY DEFINER, search_path, VN buckets, REVOKE/GRANT, rollback", () => {
  const raw = readFileSync(new URL("../database/Admin/044_admin_dashboard_rpc.sql", import.meta.url), "utf8");
  const code = stripSqlComments(raw);

  assert.match(code, /^\s*BEGIN\s*;/i);
  assert.match(code, /SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'\s*;/i);
  assert.match(code, /COMMIT\s*;\s*$/i);
  assert.doesNotMatch(code, /handle_new_user/i, "Không được đụng vào handle_new_user");

  // Rollback comments at bottom
  const commitIdx = raw.search(/^COMMIT\s*;/im);
  assert.ok(commitIdx > 0, "Phải có lệnh COMMIT; ở cấp ngoài cùng");
  const afterCommit = raw.slice(commitIdx);
  assert.match(afterCommit, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.fs_admin_overview\s*\(\s*integer\s*\)\s*;/i);

  // Function definition & security
  assert.match(
    code,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fs_admin_overview\s*\(\s*p_days\s+integer\s+DEFAULT\s+7\s*\)\s*RETURNS\s+jsonb\s+LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*public/i
  );
  assert.match(code, /LEAST\s*\(\s*GREATEST\s*\(\s*COALESCE\s*\(\s*p_days\s*,\s*7\s*\)\s*,\s*1\s*\)\s*,\s*90\s*\)/i);
  assert.match(code, /Asia\/Ho_Chi_Minh/);

  // Verified schema tables & columns
  for (const snippet of [
    /FROM\s+public\.orders/i,
    /total_cents/i,
    /FROM\s+public\.donations/i,
    /FROM\s+public\.complaints/i,
    /FROM\s+public\.profiles/i,
    /'orders_completed'/,
    /'orders_cancelled'/,
    /'orders_no_show'/,
    /'gmv_cents'/,
    /'donations_completed'/,
    /'new_users'/
  ]) {
    assert.match(code, snippet);
  }

  // Permissions locked down to service_role
  assert.match(
    code,
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fs_admin_overview\s*\(\s*integer\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i
  );
  assert.match(
    code,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fs_admin_overview\s*\(\s*integer\s*\)\s+TO\s+service_role\s*;/i
  );
});

/* ─────────────────────────── 2. Whitelisted Settings Registry ─────────────────────────── */

test("Settings registry: giữ nguyên get/set, listManagedSettings đủ 6 khóa, chặn khóa lạ & giá trị sai 400, ghi audit settings.update", async () => {
  resetState();
  seedAuthProfile("tok-admin", { id: ADM_1, role: "admin", full_name: "Admin 1" });
  seedAuthProfile("tok-cust", { id: CUST_1, role: "customer", full_name: "Khách 1" });

  // Legacy get/set intact
  assert.deepEqual(await adminSettingsService.get("ai_agent", { enabled: true }), { enabled: true });
  await adminSettingsService.set("ai_agent", { enabled: false });
  assert.deepEqual(await adminSettingsService.get("ai_agent", {}), { enabled: false });

  // Registry keys check
  assert.deepEqual(Object.keys(SETTINGS_REGISTRY), [
    "maintenance_mode",
    "support_hotline",
    "support_email",
    "default_commission_rate",
    "auto_approve_photo_minutes",
    "max_orders_per_customer_day"
  ]);

  const initial = await listManagedSettings();
  assert.equal(initial.length, 6);
  assert.equal(initial.find((s) => s.key === "maintenance_mode").value, false);
  assert.equal(initial.find((s) => s.key === "support_hotline").default_value, "1900 6868");
  assert.equal(initial.find((s) => s.key === "support_email").default_value, "support@makeitorganized.vn");
  assert.equal(initial.find((s) => s.key === "default_commission_rate").default_value, 12);
  assert.equal(initial.find((s) => s.key === "auto_approve_photo_minutes").default_value, 60);
  assert.equal(initial.find((s) => s.key === "max_orders_per_customer_day").default_value, 10);

  await withServer(async (reqJson) => {
    // Non-admin blocked
    assert.equal((await reqJson("GET", "/admin/settings", { token: "tok-cust" })).status, 403);

    const getRes = await reqJson("GET", "/admin/settings", { token: "tok-admin" });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.items.length, 6);

    // Unknown key -> 400 VALIDATION_ERROR
    const unknownKey = await reqJson("PUT", "/admin/settings/ai_agent", {
      token: "tok-admin",
      body: { value: { enabled: true } }
    });
    assert.equal(unknownKey.status, 400);
    assert.equal(unknownKey.body.error.code, "VALIDATION_ERROR");
    assert.match(unknownKey.body.error.message, /Khóa cài đặt không nằm trong danh sách cho phép/);

    // Invalid value per Zod schema -> 400 VALIDATION_ERROR
    for (const [key, badValue] of [
      ["maintenance_mode", "yes"],
      ["support_hotline", "x".repeat(41)],
      ["support_email", "not-an-email"],
      ["default_commission_rate", 35],
      ["auto_approve_photo_minutes", 4],
      ["auto_approve_photo_minutes", 15.5],
      ["max_orders_per_customer_day", 0],
      ["max_orders_per_customer_day", 51]
    ]) {
      const badRes = await reqJson("PUT", `/admin/settings/${key}`, {
        token: "tok-admin",
        body: { value: badValue }
      });
      assert.equal(badRes.status, 400, `Key ${key} với giá trị sai phải trả 400`);
      assert.equal(badRes.body.error.code, "VALIDATION_ERROR");
    }

    // Valid update -> saves & writes settings.update audit log
    const okUpdate = await reqJson("PUT", "/admin/settings/default_commission_rate", {
      token: "tok-admin",
      body: { value: 15.5 }
    });
    assert.equal(okUpdate.status, 200);
    assert.equal(okUpdate.body.data.item.key, "default_commission_rate");
    assert.equal(okUpdate.body.data.item.value, 15.5);
    assert.equal(okUpdate.body.data.item.default_value, 12);

    const settingAudits = audits("settings.update");
    assert.equal(settingAudits.length, 1);
    assert.equal(settingAudits[0].target_id, "default_commission_rate");
    assert.deepEqual(settingAudits[0].detail, {
      key: "default_commission_rate",
      before: null,
      after: 15.5
    });

    // Direct exported updateManagedSetting also works
    const updatedMaint = await updateManagedSetting("maintenance_mode", true, { userId: ADM_1, name: "Admin 1" });
    assert.equal(updatedMaint.value, true);
    assert.equal(audits("settings.update").length, 2);
  });
});

/* ─────────────────────────── 3. Admins Management ─────────────────────────── */

test("Admins management: list, create + xóa customer_profiles + rollback deleteUser khi lỗi, grant, self-lock/last-admin guards, 42703 fallback, revoke", async () => {
  resetState();
  seedAuthProfile("tok-admin", { id: ADM_1, role: "admin", full_name: "Admin Gốc", email: "root@mio.vn", phone: "0901000111" });
  db.seed("profiles", [
    { id: CUST_1, role: "customer", status: "active", full_name: "Khách Được Cấp", email: "grantme@mio.vn", created_at: "2026-11-21T00:00:00.000Z" },
    { id: CUST_2, role: "customer", status: "suspended", full_name: "Khách Đang Khóa", email: "locked@mio.vn", created_at: "2026-11-21T00:00:00.000Z" }
  ]);

  await withServer(async (reqJson) => {
    // 1) List admins
    const list1 = await reqJson("GET", "/admin/admins", { token: "tok-admin" });
    assert.equal(list1.status, 200);
    assert.equal(list1.body.data.total, 1);
    assert.equal(list1.body.data.active_count, 1);
    assert.equal(list1.body.data.items[0].last_sign_in_at, "2026-11-24T08:00:00.000Z");

    // 2) Create admin happy path (including cleaning up trigger-created customer_profiles row)
    const origCreateUser = sb.supabaseAdmin.auth.admin.createUser.bind(sb.supabaseAdmin.auth.admin);
    sb.supabaseAdmin.auth.admin.createUser = async (attrs) => {
      const res = await origCreateUser(attrs);
      if (res.data?.user?.id) {
        // Giả lập trigger handle_new_user tạo dòng customer_profiles + profiles(customer)
        db.seed("profiles", [{ id: res.data.user.id, role: "customer", status: "active", email: attrs.email, full_name: attrs.user_metadata?.full_name }]);
        db.seed("customer_profiles", [{ profile_id: res.data.user.id, email: attrs.email }]);
      }
      return res;
    };
    let createdAdminId;
    try {
      const created = await reqJson("POST", "/admin/admins", {
        token: "tok-admin",
        body: { email: "NewAdmin@MIO.vn", full_name: "Admin Mới", password: "StrongPassword123!" }
      });
      assert.equal(created.status, 201);
      createdAdminId = created.body.data.id;
      assert.equal(created.body.data.email, "newadmin@mio.vn");
      assert.equal(created.body.data.role, "admin");
      assert.equal(db.table("customer_profiles").filter((c) => c.profile_id === createdAdminId).length, 0, "Phải xóa customer_profiles");
      assert.equal(audits("admin.create").length, 1);
      assert.ok(!JSON.stringify(audits("admin.create")[0]).includes("StrongPassword123!"), "Không lộ mật khẩu trong nhật ký");
    } finally {
      sb.supabaseAdmin.auth.admin.createUser = origCreateUser;
    }

    // 3) Rollback safety: if updating/inserting profiles fails, deleteUser MUST remove orphan auth user!
    const authCountBefore = db.table("auth_users").length;
    let deleteCalledWith = null;
    const origDeleteUser = sb.supabaseAdmin.auth.admin.deleteUser.bind(sb.supabaseAdmin.auth.admin);
    sb.supabaseAdmin.auth.admin.deleteUser = async (uid) => {
      deleteCalledWith = uid;
      return origDeleteUser(uid);
    };
    const realFrom = sb.supabaseAdmin.from;
    sb.supabaseAdmin.from = (table) => {
      const q = realFrom(table);
      if (table === "profiles") {
        const origUpdate = q.update.bind(q);
        q.update = () => {
          const failChain = {
            eq: () => failChain,
            select: () => failChain,
            single: async () => ({ data: null, error: { code: "XX000", message: "simulated profile update failure" } })
          };
          return failChain;
        };
        return q;
      }
      return q;
    };
    try {
      const failCreate = await reqJson("POST", "/admin/admins", {
        token: "tok-admin",
        body: { email: "rollback@mio.vn", full_name: "Rollback Test", password: "StrongPassword123!" }
      });
      assert.equal(failCreate.status, 500);
      assert.ok(deleteCalledWith, "Phải gọi auth.admin.deleteUser khi cập nhật profiles thất bại");
      assert.equal(db.table("auth_users").length, authCountBefore, "Không được để lại auth_user mồ côi");
      assert.equal(audits("admin.create").length, 1, "Không ghi audit khi tạo thất bại");
    } finally {
      sb.supabaseAdmin.from = realFrom;
      sb.supabaseAdmin.auth.admin.deleteUser = origDeleteUser;
    }

    // 4) Grant admin: 404 unknown, 409 already admin, 409 suspended, 200 case-insensitive email
    assert.equal(
      (await reqJson("POST", "/admin/admins/grant", { token: "tok-admin", body: { identifier: "nobody@mio.vn", reason: "Cấp quyền" } })).status,
      404
    );
    assert.equal(
      (await reqJson("POST", "/admin/admins/grant", { token: "tok-admin", body: { identifier: "root@mio.vn", reason: "Đã là admin" } })).status,
      409
    );
    assert.equal(
      (await reqJson("POST", "/admin/admins/grant", { token: "tok-admin", body: { identifier: CUST_2, reason: "Tài khoản khóa" } })).status,
      409
    );
    const grantOk = await reqJson("POST", "/admin/admins/grant", {
      token: "tok-admin",
      body: { identifier: "GRANTME@MIO.VN", reason: "Bổ nhiệm trưởng ca vận hành" }
    });
    assert.equal(grantOk.status, 200);
    assert.equal(grantOk.body.data.role, "admin");
    assert.equal(audits("admin.grant").length, 1);

    // 5) Status: self-lock case-insensitive -> 400, short reason -> 400, graceful 42703 fallback -> 200
    const selfStatusUpper = await reqJson("POST", `/admin/admins/${ADM_1.toUpperCase()}/status`, {
      token: "tok-admin",
      body: { status: "suspended", reason: "Tự khóa thử" }
    });
    assert.equal(selfStatusUpper.status, 400);

    const shortReason = await reqJson("POST", `/admin/admins/${CUST_1}/status`, {
      token: "tok-admin",
      body: { status: "suspended", reason: "no" }
    });
    assert.equal(shortReason.status, 400);

    // Simulate missing suspended_at column (42703)
    let hit42703 = false;
    sb.supabaseAdmin.from = (table) => {
      const q = realFrom(table);
      if (table === "profiles") {
        const origUpdate = q.update.bind(q);
        q.update = (patch) => {
          if ("suspended_at" in patch) {
            hit42703 = true;
            const failChain = {
              eq: () => failChain,
              select: () => failChain,
              single: async () => ({ data: null, error: { code: "42703", message: "column suspended_at does not exist" } })
            };
            return failChain;
          }
          return origUpdate(patch);
        };
      }
      return q;
    };
    try {
      const susp1 = await reqJson("POST", `/admin/admins/${CUST_1}/status`, {
        token: "tok-admin",
        body: { status: "suspended", reason: "Tạm nghỉ phép dài hạn" }
      });
      assert.equal(susp1.status, 200);
      assert.equal(hit42703, true);
      assert.equal(audits("admin.suspend").length, 1);
    } finally {
      sb.supabaseAdmin.from = realFrom;
    }

    // 6) Revoke: self-revoke case-insensitive -> 400; revoke createdAdminId -> 200; then last-admin guard -> 409
    const selfRevoke = await reqJson("POST", `/admin/admins/${ADM_1.toUpperCase()}/revoke`, {
      token: "tok-admin",
      body: { reason: "Tự gỡ quyền" }
    });
    assert.equal(selfRevoke.status, 400);

    const revokeCreated = await reqJson("POST", `/admin/admins/${createdAdminId}/revoke`, {
      token: "tok-admin",
      body: { reason: "Chuyển bộ phận khác" }
    });
    assert.equal(revokeCreated.status, 200);
    assert.equal(revokeCreated.body.data.role, "customer");
    assert.equal(audits("admin.revoke").length, 1);

    // Now ADM_1 is the ONLY active admin (CUST_1 is suspended admin). Verify last-active-admin guard (409) via service:
    await assert.rejects(
      () => adminPortal4Service.updateAdminStatus(ADM_1, "suspended", "Khóa admin cuối", { userId: ADM_2, name: "Sys" }),
      (err) => err.statusCode === 409 && err.code === "RESOURCE_CONFLICT"
    );
    await assert.rejects(
      () => adminPortal4Service.revokeAdmin(ADM_1, "Thu hồi admin cuối", { userId: ADM_2, name: "Sys" }),
      (err) => err.statusCode === 409 && err.code === "RESOURCE_CONFLICT"
    );
  });
});

/* ─────────────────────────── 4. Broadcast Notifications + Limiter + Cooldown ─────────────────────────── */

test("Notifications: broadcast role + cooldown 10m (429), user/users + non-fatal push, stats + 42P01 fallback, rate limiter 10 req/10m", async () => {
  resetState();
  seedAuthProfile("tok-admin", { id: ADM_1, role: "admin", full_name: "Admin 1" });
  seedAuthProfile("tok-admin-2", { id: ADM_2, role: "admin", full_name: "Admin 2" });
  db.seed("profiles", [
    { id: CUST_1, role: "customer", status: "active", full_name: "Khách A", email: "a@mio.vn" },
    { id: CUST_2, role: "customer", status: "suspended", full_name: "Khách B", email: "b@mio.vn" },
    { id: PARTNER_1, role: "partner", status: "active", full_name: "Đối tác A", email: "p@mio.vn" },
    { id: CHARITY_1, role: "charity", status: "active", full_name: "Tổ chức A", email: "c@mio.vn" }
  ]);
  db.seed("push_subscriptions", [
    { id: "ps-1", endpoint: "https://push.example/1", p256dh: "k1", auth: "a1", user_id: CUST_1, role: "customer" },
    { id: "ps-2", endpoint: "https://push.example/2", p256dh: "k2", auth: "a2", volunteer_id: "v1", role: "volunteer" }
  ]);

  let pushCalls = 0;
  setPushTransport(async () => {
    pushCalls += 1;
    throw new Error("simulated push network failure");
  });

  await withServer(async (reqJson) => {
    // 1) Broadcast to role=customer -> only active customer CUST_1 receives
    const bc1 = await reqJson("POST", "/admin/notifications", {
      token: "tok-admin",
      body: { target: "role", role: "customer", title: "Bảo trì định kỳ", body: "Hệ thống nâng cấp lúc 02:00 sáng.", push: true }
    });
    assert.equal(bc1.status, 200);
    assert.deepEqual(bc1.body.data, { sent_count: 1, push_attempted: true });
    assert.equal(pushCalls, 1, "Đã thử gửi Web Push và lỗi push không làm hỏng request");
    assert.equal(audits("notification.send").length, 1);

    // 2) Second broadcast to role=customer within 10m -> 429 RATE_LIMITED
    const bcCooldown = await reqJson("POST", "/admin/notifications", {
      token: "tok-admin",
      body: { target: "role", role: "customer", title: "Lần 2", body: "Bị chặn bởi cooldown 10 phút." }
    });
    assert.equal(bcCooldown.status, 429);
    assert.equal(bcCooldown.body.error.code, "RATE_LIMITED");

    // Different role (partner) is NOT blocked by customer cooldown
    const bcPartner = await reqJson("POST", "/admin/notifications", {
      token: "tok-admin",
      body: { target: "role", role: "partner", title: "Thông báo đối tác", body: "Cập nhật chính sách đối soát mới." }
    });
    assert.equal(bcPartner.status, 200);
    assert.equal(bcPartner.body.data.sent_count, 1);

    // resetBroadcastCooldowns() allows sending to customer role again
    resetBroadcastCooldowns();
    const bcAfterReset = await reqJson("POST", "/admin/notifications", {
      token: "tok-admin",
      body: { target: "role", role: "customer", title: "Sau reset", body: "Đã gửi lại thành công." }
    });
    assert.equal(bcAfterReset.status, 200);

    // 3) Target "users" (deduped)
    const multi = await reqJson("POST", "/admin/notifications", {
      token: "tok-admin",
      body: { target: "users", user_ids: [CUST_1, PARTNER_1, CUST_1], title: "Tin riêng", body: "Gửi cho danh sách chọn lọc." }
    });
    assert.equal(multi.status, 200);
    assert.deepEqual(multi.body.data, { sent_count: 2, push_attempted: false });

    // 4) List & Stats
    const listRes = await reqJson("GET", "/admin/notifications?page=1&limit=10", { token: "tok-admin" });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.total, 5);
    assert.ok(listRes.body.data.items.every((n) => n.type === "admin_broadcast"));

    const statsRes = await reqJson("GET", "/admin/notifications/stats", { token: "tok-admin" });
    assert.equal(statsRes.status, 200);
    assert.equal(statsRes.body.data.total_subscriptions, 2);
    assert.equal(statsRes.body.data.by_role.customer, 1);
    assert.equal(statsRes.body.data.by_role.volunteer, 1);
    assert.equal(statsRes.body.data.recent_broadcasts, 5);

    // 42P01 graceful fallback when push_subscriptions missing
    const realFrom = sb.supabaseAdmin.from;
    sb.supabaseAdmin.from = (table) => {
      if (table === "push_subscriptions") {
        const chain = {
          select: () => chain,
          limit: async () => ({ data: null, error: { code: "42P01", message: "relation push_subscriptions does not exist" } })
        };
        return chain;
      }
      return realFrom(table);
    };
    try {
      const fallbackStats = await reqJson("GET", "/admin/notifications/stats", { token: "tok-admin" });
      assert.equal(fallbackStats.status, 200);
      assert.equal(fallbackStats.body.data.total_subscriptions, 0);
      assert.equal(fallbackStats.body.data.by_role.customer, 0);
    } finally {
      sb.supabaseAdmin.from = realFrom;
    }

    // 5) Rate limiter adminNotifyLimiter: 10 req / 10 min per admin (use tok-admin-2 fresh bucket)
    for (let i = 0; i < 10; i += 1) {
      const r = await reqJson("POST", "/admin/notifications", {
        token: "tok-admin-2",
        body: { target: "user", user_id: CUST_1, title: `Tin ${i + 1}`, body: "Kiểm thử giới hạn tốc độ gửi." }
      });
      assert.equal(r.status, 200);
    }
    const eleventh = await reqJson("POST", "/admin/notifications", {
      token: "tok-admin-2",
      body: { target: "user", user_id: CUST_1, title: "Tin 11", body: "Phải bị chặn 429." }
    });
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.body.error.code, "RATE_LIMITED");
  });
});

/* ─────────────────────────── 5. Support Inbox (Contact & Applications) ─────────────────────────── */

test("Support inbox: contact-messages & applications list/patch, recursive masking bank/cccd/tax/identity, 42P01 & 42703 fallbacks", async () => {
  resetState();
  seedAuthProfile("tok-admin", { id: ADM_1, role: "admin", full_name: "Admin Hỗ Trợ" });

  const CM_1 = "66666666-6666-4666-8666-666666666601";
  const APP_1 = "77777777-7777-4777-8777-777777777701";

  db.seed("contact_messages", [
    {
      id: CM_1,
      user_id: CUST_1,
      full_name: "Lê Thu Hà",
      email: "ha@mio.vn",
      phone: "0909123456",
      subject: "Hỏi về hóa đơn",
      message: "Tôi cần xuất hóa đơn VAT cho đơn hàng hôm qua.",
      status: "open",
      created_at: "2026-11-24T02:00:00.000Z",
      updated_at: "2026-11-24T02:00:00.000Z"
    }
  ]);

  db.seed("applications", [
    {
      id: APP_1,
      user_id: null,
      type: "partner",
      org_name: "Tiệm Bánh Mùa Thu",
      contact_name: "Trần Minh",
      email: "minh@bakery.vn",
      phone: "0918222333",
      status: "pending",
      payload: {
        address: "123 Điện Biên Phủ, Q.3",
        tax_code: "0319876543",
        cccd_number: "079095112233",
        id_card_photo: "https://cdn.example.com/private/cccd-front.jpg",
        bank: {
          name: "Vietcombank",
          number: "9704361234567890",
          holder: "TRAN MINH"
        },
        directors: [
          { full_name: "Trần Minh", identity_number: "079095998877", payout_account: "1903666777888" }
        ]
      },
      created_at: "2026-11-24T03:00:00.000Z",
      updated_at: "2026-11-24T03:00:00.000Z"
    }
  ]);

  await withServer(async (reqJson) => {
    // Contact messages list + search + patch
    const cmList = await reqJson("GET", "/admin/contact-messages?q=hóa đơn&status=open", { token: "tok-admin" });
    assert.equal(cmList.status, 200);
    assert.equal(cmList.body.data.total, 1);
    assert.equal(cmList.body.data.items[0].id, CM_1);

    const cmPatchProgress = await reqJson("PATCH", `/admin/contact-messages/${CM_1}`, {
      token: "tok-admin",
      body: { status: "in_progress", admin_note: "Đang tra cứu chứng từ kế toán." }
    });
    assert.equal(cmPatchProgress.status, 200);
    assert.equal(cmPatchProgress.body.data.status, "in_review", "in_progress ánh xạ an toàn sang enum contact_status in_review");

    const cmPatch = await reqJson("PATCH", `/admin/contact-messages/${CM_1}`, {
      token: "tok-admin",
      body: { status: "resolved", admin_note: "Đã gửi hóa đơn qua email cho khách." }
    });
    assert.equal(cmPatch.status, 200);
    assert.equal(cmPatch.body.data.status, "closed", "resolved ánh xạ an toàn sang enum contact_status closed");
    assert.equal(cmPatch.body.data.admin_note, "Đã gửi hóa đơn qua email cho khách.");
    assert.equal(cmPatch.body.data.handled_by, ADM_1);
    assert.equal(audits("contact.update").length, 2);

    // Applications list + recursive masking verification
    const appList = await reqJson("GET", "/admin/applications?status=pending", { token: "tok-admin" });
    assert.equal(appList.status, 200);
    assert.equal(appList.body.data.total, 1);
    const serialized = JSON.stringify(appList.body.data);
    for (const secret of [
      "0319876543",
      "079095112233",
      "https://cdn.example.com/private/cccd-front.jpg",
      "9704361234567890",
      "079095998877",
      "1903666777888"
    ]) {
      assert.ok(!serialized.includes(secret), `Không được để lộ giá trị nhạy cảm: ${secret}`);
    }
    assert.equal(appList.body.data.items[0].payload.address, "123 Điện Biên Phủ, Q.3", "Giữ nguyên trường an toàn");
    assert.equal(appList.body.data.items[0].payload.id_card_photo, "[đã che]");

    // Applications PATCH with simulated 42703 (missing admin_note / handled_* before SQL 043)
    const realFrom = sb.supabaseAdmin.from;
    let sawApp42703 = false;
    sb.supabaseAdmin.from = (table) => {
      const q = realFrom(table);
      if (table === "applications") {
        const origUpdate = q.update.bind(q);
        q.update = (patch) => {
          if ("admin_note" in patch || "handled_by" in patch) {
            sawApp42703 = true;
            const failChain = {
              eq: () => failChain,
              select: () => failChain,
              single: async () => ({ data: null, error: { code: "42703", message: "column admin_note does not exist" } })
            };
            return failChain;
          }
          return origUpdate(patch);
        };
      }
      return q;
    };
    try {
      const appPatch = await reqJson("PATCH", `/admin/applications/${APP_1}`, {
        token: "tok-admin",
        body: { status: "in_review", admin_note: "Đang kiểm tra giấy phép VSATTP" }
      });
      assert.equal(appPatch.status, 200);
      assert.equal(sawApp42703, true);
      assert.equal(appPatch.body.data.status, "in_review");
      assert.ok(!JSON.stringify(appPatch.body.data).includes("9704361234567890"), "PATCH response cũng phải che trường nhạy cảm");
      assert.equal(audits("application.update").length, 1);
    } finally {
      sb.supabaseAdmin.from = realFrom;
    }

    // 42P01 missing table fallback on GET contact-messages & applications
    sb.supabaseAdmin.from = (table) => {
      if (table === "contact_messages" || table === "applications") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          or: () => chain,
          order: () => chain,
          range: async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" }, count: null })
        };
        return chain;
      }
      return realFrom(table);
    };
    try {
      const emptyCm = await reqJson("GET", "/admin/contact-messages", { token: "tok-admin" });
      assert.equal(emptyCm.status, 200);
      assert.deepEqual(emptyCm.body.data, { items: [], total: 0, page: 1, limit: 20 });

      const emptyApp = await reqJson("GET", "/admin/applications", { token: "tok-admin" });
      assert.equal(emptyApp.status, 200);
      assert.deepEqual(emptyApp.body.data, { items: [], total: 0, page: 1, limit: 20 });
    } finally {
      sb.supabaseAdmin.from = realFrom;
    }
  });

  // Unit check for maskApplicationSensitiveFields
  const maskedDirect = maskApplicationSensitiveFields({ bank_account: "12345678", safe: "ok" });
  assert.equal(maskedDirect.safe, "ok");
  assert.equal(maskedDirect.bank_account, "••••5678");
});

/* ─────────────────────────── 6. Dashboard Overview (RPC + JS Fallback) ─────────────────────────── */

test("Dashboard overview: RPC fs_admin_overview happy path + seamless 42883/PGRST202 JS fallback theo đúng ngày giờ Việt Nam (+07:00)", async () => {
  resetState();
  const RealDate = Date;
  const fixedNowMs = new RealDate("2026-11-24T12:00:00.000Z").getTime(); // 19:00 ngày 2026-11-24 giờ VN
  global.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNowMs]));
    }
    static now() {
      return fixedNowMs;
    }
  };

  try {
    seedAuthProfile("tok-admin", { id: ADM_1, role: "admin", full_name: "Admin Dashboard" });
    // ADM_1 có created_at = 2026-11-20T01:00:00.000Z -> nằm trong cửa sổ 7 ngày (2026-11-18..2026-11-24 VN)
    db.seed("profiles", [
      { id: CUST_1, role: "customer", status: "active", created_at: "2026-11-23T17:05:00.000Z" }, // 00:05 ngày 2026-11-24 giờ VN!
      { id: CUST_2, role: "customer", status: "active", created_at: "2026-11-10T05:00:00.000Z" }  // Ngoài cửa sổ 7 ngày, trong cửa sổ 30 ngày
    ]);
    db.seed("orders", [
      { id: "o-1", status: "completed", total_cents: 85000, created_at: "2026-11-23T17:15:00.000Z" }, // 2026-11-24 VN
      { id: "o-2", status: "cancelled", total_cents: 50000, created_at: "2026-11-23T16:50:00.000Z" }, // 23:50 ngày 2026-11-23 VN!
      { id: "o-3", status: "no_show", total_cents: 30000, created_at: "2026-11-22T03:00:00.000Z" },   // 2026-11-22 VN
      { id: "o-old", status: "completed", total_cents: 999999, created_at: "2026-11-17T16:59:59.000Z" } // 23:59:59 ngày 2026-11-17 VN -> ngoài 7 ngày!
    ]);
    db.seed("donations", [
      { id: "d-1", status: "completed", store_id: STORE_1, created_at: "2026-11-23T18:00:00.000Z" }, // 2026-11-24 VN
      { id: "d-2", status: "open", store_id: STORE_1, created_at: "2026-11-21T04:00:00.000Z" }       // 2026-11-21 VN
    ]);
    db.seed("complaints", [
      { id: "c-1", status: "open", created_at: "2026-11-24T02:00:00.000Z" } // 2026-11-24 VN
    ]);

    await withServer(async (reqJson) => {
      // 1) Explicit PGRST202 / 42883 fallback verification
      const realRpc = sb.supabaseAdmin.rpc;
      sb.supabaseAdmin.rpc = async () => ({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.fs_admin_overview(p_days)" }
      });
      try {
        const res7 = await reqJson("GET", "/admin/dashboard/overview?days=7", { token: "tok-admin" });
        assert.equal(res7.status, 200);
        const d7 = res7.body.data;
        assert.equal(d7.days, 7);
        assert.equal(d7.timezone, "Asia/Ho_Chi_Minh");
        assert.equal(d7.source, "fallback");
        assert.equal(d7.series.length, 7);
        assert.equal(d7.series[0].date, "2026-11-18");
        assert.equal(d7.series[6].date, "2026-11-24");

        assert.deepEqual(d7.totals, {
          orders: 3,
          orders_completed: 1,
          orders_cancelled: 1,
          orders_no_show: 1,
          gmv_cents: 85000,
          donations: 2,
          donations_completed: 1,
          complaints: 1,
          new_users: 2 // ADM_1 (20/11) + CUST_1 (24/11 VN)
        });

        // Verify exact VN midnight boundary placement:
        const nov23 = d7.series.find((s) => s.date === "2026-11-23");
        const nov24 = d7.series.find((s) => s.date === "2026-11-24");
        assert.deepEqual(nov23, {
          date: "2026-11-23",
          orders: 1,
          gmv_cents: 0,
          donations: 0,
          complaints: 0,
          new_users: 0
        });
        assert.deepEqual(nov24, {
          date: "2026-11-24",
          orders: 1,
          gmv_cents: 85000,
          donations: 1,
          complaints: 1,
          new_users: 1
        });

        // 30-day window includes o-old & CUST_2
        const res30 = await reqJson("GET", "/admin/dashboard/overview?days=30", { token: "tok-admin" });
        assert.equal(res30.status, 200);
        assert.equal(res30.body.data.days, 30);
        assert.equal(res30.body.data.series.length, 30);
        assert.equal(res30.body.data.totals.orders, 4);
        assert.equal(res30.body.data.totals.gmv_cents, 85000 + 999999);
        assert.equal(res30.body.data.totals.new_users, 3);
      } finally {
        sb.supabaseAdmin.rpc = realRpc;
      }

      // 2) RPC happy path when SQL 044 is applied
      const realRpc2 = sb.supabaseAdmin.rpc;
      sb.supabaseAdmin.rpc = async (fnName, args) => {
        if (fnName === "fs_admin_overview") {
          return {
            data: {
              days: args.p_days,
              timezone: "Asia/Ho_Chi_Minh",
              totals: {
                orders: 10,
                orders_completed: 8,
                orders_cancelled: 1,
                orders_no_show: 1,
                gmv_cents: 500000,
                donations: 3,
                donations_completed: 2,
                complaints: 0,
                new_users: 4
              },
              series: []
            },
            error: null
          };
        }
        return realRpc2(fnName, args);
      };
      try {
        const rpcRes = await reqJson("GET", "/admin/dashboard/overview", { token: "tok-admin" });
        assert.equal(rpcRes.status, 200);
        assert.equal(rpcRes.body.data.source, "rpc");
        assert.equal(rpcRes.body.data.days, 7);
        assert.equal(rpcRes.body.data.totals.gmv_cents, 500000);
      } finally {
        sb.supabaseAdmin.rpc = realRpc2;
      }

      // Invalid days query rejected (422)
      const badDays = await reqJson("GET", "/admin/dashboard/overview?days=14", { token: "tok-admin" });
      assert.equal(badDays.status, 422);
    });
  } finally {
    global.Date = RealDate;
  }
});
