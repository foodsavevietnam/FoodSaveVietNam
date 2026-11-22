/**
 * Kiểm thử MÔ PHỎNG lõi chia sẻ vị trí (Task 1), đăng nhập OTP TNV (Task 3): locationService, locationActor, locationSchemas
 * chạy trên database giả trong bộ nhớ (scripts/fake-supabase.js). Không mạng, không chạm Supabase thật.
 *
 * Chạy: npx tsc && node scripts/test-live-location.js
 */
Object.assign(process.env, {
  SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_ANON_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", CORS_ORIGINS: "http://localhost",
  DATABASE_URL: "postgres://x:x@127.0.0.1:9/x", DEMO_MODE: "false", LOG_LEVEL: "error"
});
const assert = require("assert");
const { FakeDb } = require("./fake-supabase");

let db = new FakeDb();
const sb = require("../dist/config/supabase");
// Supabase Auth giả cho đăng nhập OTP của TNV: đếm số lần gọi, mã đúng là GOOD_CODE
const GOOD_CODE = "246810";
const otp = { sent: [], verifyCalls: 0, signOuts: [], deleted: [], deleteError: null };
sb.supabaseAdmin = {
  from: (name) => db.from(name), rpc: (name, args) => db.rpc(name, args),
  auth: { admin: {
    signOut: async (jwt, scope) => { otp.signOuts.push([jwt, scope]); return { error: null }; },
    deleteUser: async (id) => { otp.deleted.push(id); return { data: null, error: otp.deleteError }; }
  } }
};
sb.supabaseAuth = { auth: {
  signInWithOtp: async (args) => { otp.sent.push(args); return { data: {}, error: null }; },
  verifyOtp: async ({ email, token, type }) => {
    otp.verifyCalls += 1;
    if (type === "email" && token === GOOD_CODE) return { data: { user: { id: "auth-" + email, email }, session: { access_token: "sess-" + otp.verifyCalls } }, error: null };
    return { data: { user: null, session: null }, error: { message: "Token has expired or is invalid" } };
  }
} };
require("../dist/config/postgres").isPostgresAvailable = async () => false;

const { locationService } = require("../dist/services/locationService");
const { locationSchemas } = require("../dist/schemas/locationSchemas");
const locationAuth = require("../dist/middlewares/locationAuth");
const { createVolunteerToken } = require("../dist/utils/volunteerToken");
const { env } = require("../dist/config/env");

const VOL = { kind: "volunteer", id: "vol-1" };
const CUST = { kind: "customer", id: "cust-1" };
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const MIN = 60000, HOUR = 3600000;
const POS = { lat: 10.78, lng: 106.7 };
const rows = () => db.table("live_locations");

function reset() {
  db = new FakeDb();
  db.unique.auth_otp_attempts = ["key"];
  otp.sent = []; otp.verifyCalls = 0; otp.signOuts = []; otp.deleted = []; otp.deleteError = null;
  db.seed("orders", [
    { id: "o-ok", customer_id: CUST.id, payment_status: "paid", status: "confirmed" },
    { id: "o-other", customer_id: "cust-2", payment_status: "paid", status: "confirmed" },
    { id: "o-await", customer_id: CUST.id, payment_status: "unpaid", status: "awaiting_payment" },
    { id: "o-done", customer_id: CUST.id, payment_status: "paid", status: "completed" }
  ]);
  db.seed("donations", [
    { id: "d-route", status: "in_route", assigned_volunteer_id: null, distribution_done_at: null },
    { id: "d-other", status: "in_route", assigned_volunteer_id: null, distribution_done_at: null },
    { id: "d-done", status: "in_route", assigned_volunteer_id: null, distribution_done_at: null },
    { id: "d-legacy", status: "accepted", assigned_volunteer_id: VOL.id, distribution_done_at: null }
  ]);
  db.seed("donation_assignments", [
    { donation_id: "d-route", volunteer_id: VOL.id, stage: "pickup", done_at: null },
    { donation_id: "d-other", volunteer_id: "vol-2", stage: "pickup", done_at: null },
    { donation_id: "d-done", volunteer_id: VOL.id, stage: "pickup", done_at: iso(-MIN) }
  ]);
}

const rejects = async (fn, code, status) => {
  try { await fn(); } catch (error) {
    assert.strictEqual(error.code, code, "mã lỗi mong đợi " + code + " nhưng nhận " + error.code + " · " + error.message);
    if (status) assert.strictEqual(error.statusCode, status);
    return;
  }
  assert.fail("lẽ ra phải lỗi " + code);
};

const results = [];
const scenario = async (name, fn) => {
  try { reset(); await fn(); results.push([true, name]); console.log("  ĐẠT   " + name); }
  catch (error) { results.push([false, name]); console.log("  KHÔNG ĐẠT   " + name + "\n         " + (error && error.message || error)); }
};

(async () => {
  console.log("\nKiểm thử lõi chia sẻ vị trí (database giả trong bộ nhớ)\n");

  await scenario("L1. Chưa đồng ý → LOCATION_CONSENT_REQUIRED (403); sau khi đồng ý → lưu đúng 1 dòng", async () => {
    const ctx = { kind: "order", id: "o-ok" };
    await rejects(() => locationService.report(CUST, { ...POS, context: ctx }), "LOCATION_CONSENT_REQUIRED", 403);
    assert.strictEqual(rows().length, 0);
    assert.deepStrictEqual(await locationService.setConsent(CUST, true, "2026-11-22", "ua"), { granted: true });
    const r = await locationService.report(CUST, { ...POS, accuracy_m: 12, context: ctx });
    assert.strictEqual(r.stored, true);
    assert.strictEqual(r.throttled, false);
    assert.strictEqual(rows().length, 1);
    assert.strictEqual(rows()[0].context_id, "o-ok");
    assert.strictEqual(db.table("location_consents").length, 1);
  });

  await scenario("L2. Người mua: đơn người khác / chưa thanh toán / đã hoàn tất → NO_ACTIVE_TASK (409), xóa dòng cũ", async () => {
    await locationService.setConsent(CUST, true, "2026-11-22");
    for (const id of ["o-other", "o-await", "o-done"]) {
      rows().push({ actor_kind: "customer", actor_id: CUST.id, context_kind: "order", context_id: "o-ok", lat: 1, lng: 1, updated_at: iso(-HOUR) });
      await rejects(() => locationService.report(CUST, { ...POS, context: { kind: "order", id } }), "NO_ACTIVE_TASK", 409);
      assert.strictEqual(rows().length, 0, "dòng cũ phải bị xóa khi " + id);
    }
    // kind không khớp
    await rejects(() => locationService.report(CUST, { ...POS, context: { kind: "donation", id: "d-route" } }), "NO_ACTIVE_TASK", 409);
  });

  await scenario("L3. TNV: không được giao / đã done_at → NO_ACTIVE_TASK; được giao + in_route → lưu", async () => {
    await locationService.setConsent(VOL, true, "2026-11-22");
    await rejects(() => locationService.report(VOL, { ...POS, context: { kind: "donation", id: "d-other" } }), "NO_ACTIVE_TASK", 409);
    await rejects(() => locationService.report(VOL, { ...POS, context: { kind: "donation", id: "d-done" } }), "NO_ACTIVE_TASK", 409);
    await rejects(() => locationService.report(VOL, { ...POS, context: { kind: "order", id: "o-ok" } }), "NO_ACTIVE_TASK", 409);
    const r = await locationService.report(VOL, { ...POS, context: { kind: "donation", id: "d-route" } });
    assert.strictEqual(r.stored, true);
    assert.strictEqual(rows().length, 1);
    // assigned_volunteer_id kiểu cũ
    rows().length = 0;
    assert.strictEqual(await locationService.isActiveTask(VOL, { kind: "donation", id: "d-legacy" }), true);
    // phát hàng đã xong thì không còn nhiệm vụ
    db.table("donation_assignments").push({ donation_id: "d-other", volunteer_id: VOL.id, stage: "distribute", done_at: null });
    db.table("donations").find((d) => d.id === "d-other").distribution_done_at = iso(-MIN);
    assert.strictEqual(await locationService.isActiveTask(VOL, { kind: "donation", id: "d-other" }), false);
    db.table("donations").find((d) => d.id === "d-other").distribution_done_at = null;
    assert.strictEqual(await locationService.isActiveTask(VOL, { kind: "donation", id: "d-other" }), true);
  });

  await scenario("L4. Hai tab song song vẫn 1 dòng; lần trong 55 giây bị throttle; lùi 56 giây thì lưu", async () => {
    await locationService.setConsent(CUST, true, "2026-11-22");
    const ctx = { kind: "order", id: "o-ok" };
    const both = await Promise.all([locationService.report(CUST, { ...POS, context: ctx }), locationService.report(CUST, { ...POS, context: ctx })]);
    assert.strictEqual(rows().length, 1, "đúng 1 dòng");
    assert.strictEqual(both.filter((r) => r.stored).length, 1, "chỉ một lần được lưu");
    assert.strictEqual(both.filter((r) => r.throttled).length, 1);
    const again = await locationService.report(CUST, { ...POS, context: ctx });
    assert.deepStrictEqual(again, { stored: false, throttled: true });
    rows()[0].updated_at = iso(-56 * 1000);
    const later = await locationService.report(CUST, { lat: 10.79, lng: 106.71, context: ctx });
    assert.strictEqual(later.stored, true);
    assert.strictEqual(rows().length, 1);
    assert.strictEqual(rows()[0].lat, 10.79);
  });

  await scenario("L5. recorded_at ở tương lai hoặc quá cũ bị kẹp về giờ server", async () => {
    await locationService.setConsent(CUST, true, "2026-11-22");
    const ctx = { kind: "order", id: "o-ok" };
    const before = Date.now();
    await locationService.report(CUST, { ...POS, recorded_at: iso(HOUR), context: ctx });
    const after = Date.now();
    const recorded = new Date(rows()[0].recorded_at).getTime();
    assert.ok(recorded <= after, "recorded_at không được vượt giờ server");
    assert.ok(recorded >= before - 1000);
    rows()[0].updated_at = iso(-2 * MIN);
    await locationService.report(CUST, { ...POS, recorded_at: iso(-HOUR), context: ctx });
    assert.ok(new Date(rows()[0].recorded_at).getTime() >= Date.now() - 5000, "cũ hơn 10 phút → dùng giờ server");
    rows()[0].updated_at = iso(-2 * MIN);
    const okTime = iso(-3 * MIN);
    await locationService.report(CUST, { ...POS, recorded_at: okTime, context: ctx });
    assert.strictEqual(new Date(rows()[0].recorded_at).toISOString(), okTime, "lệch hợp lý thì giữ nguyên");
  });

  await scenario("L6. Schema: (0,0), lat 91, accuracy_m 5000, field lạ đều bị từ chối; dữ liệu đúng được nhận", async () => {
    const ctx = { kind: "order", id: "11111111-1111-4111-8111-111111111111" };
    const bad = [{ lat: 0, lng: 0, context: ctx }, { lat: 91, lng: 10, context: ctx }, { lat: 10, lng: 181, context: ctx },
      { lat: 10, lng: 10, accuracy_m: 5000, context: ctx }, { lat: 10, lng: 10, context: ctx, extra: 1 }, { lat: 10, lng: 10, context: { kind: "x", id: ctx.id } }, { lat: 10, lng: 10, context: { kind: "order", id: "khong-phai-uuid" } }];
    for (const input of bad) assert.strictEqual(locationSchemas.report.safeParse(input).success, false, JSON.stringify(input));
    assert.strictEqual(locationSchemas.report.safeParse({ lat: 10.5, lng: 106.5, accuracy_m: 20, recorded_at: new Date().toISOString(), context: ctx }).success, true);
    assert.strictEqual(locationSchemas.report.safeParse({ lat: 0, lng: 106.5, context: ctx }).success, true, "chỉ cấm cả hai cùng 0");
    assert.strictEqual(locationSchemas.consent.safeParse({ granted: true, policy_version: "2026-11-22" }).success, true);
    assert.strictEqual(locationSchemas.consent.safeParse({ granted: "yes", policy_version: "x" }).success, false);
  });

  await scenario("L7. locationActor: TNV khi DEMO_MODE=false → 403 AUTH_VERIFICATION_REQUIRED; DEMO_MODE=true → volunteer; không token → 401", async () => {
    const run = (token) => new Promise((resolve) => {
      const req = { headers: token ? { authorization: "Bearer " + token } : {} };
      const res = { locals: {} };
      locationAuth.locationActor(req, res, (error) => resolve({ error, res }));
    });
    db.seed("volunteers", [{ id: "vol-9", charity_id: "charity-1", status: "active" }]);
    const token = createVolunteerToken("vol-9", "charity-1");
    const blocked = await run(token);
    assert.ok(blocked.error && blocked.error.statusCode === 403 && blocked.error.code === "AUTH_VERIFICATION_REQUIRED");
    assert.strictEqual(blocked.res.locals.locationActor, undefined);
    const previous = env.DEMO_MODE;
    env.DEMO_MODE = true;
    try {
      const ok = await run(token);
      assert.ok(!ok.error);
      assert.deepStrictEqual(ok.res.locals.locationActor, { kind: "volunteer", id: "vol-9" });
    } finally { env.DEMO_MODE = previous; }
    const none = await run("");
    assert.ok(none.error && none.error.statusCode === 401, "thiếu token → 401");
  });

  await scenario("L8. Rút đồng ý sau khi có dòng → dòng bị xóa, report bị chặn; clear() xóa dòng của chính mình", async () => {
    await locationService.setConsent(CUST, true, "2026-11-22");
    const ctx = { kind: "order", id: "o-ok" };
    await locationService.report(CUST, { ...POS, context: ctx });
    assert.strictEqual(rows().length, 1);
    assert.deepStrictEqual(await locationService.setConsent(CUST, false, "2026-11-22"), { granted: false });
    assert.strictEqual(rows().length, 0, "rút đồng ý phải xóa vị trí");
    assert.strictEqual(db.table("location_consents").length, 1, "đổi ý cập nhật dòng, không nhân bản");
    await rejects(() => locationService.report(CUST, { ...POS, context: ctx }), "LOCATION_CONSENT_REVOKED", 403);
    await locationService.setConsent(CUST, true, "2026-11-22");
    await locationService.report(CUST, { ...POS, context: ctx });
    await locationService.setConsent(VOL, true, "2026-11-22");
    await locationService.clear(CUST);
    assert.strictEqual(rows().length, 0);
  });

  await scenario("L9. report chạy song song với setConsent(false) → cuối cùng không còn dòng", async () => {
    await locationService.setConsent(CUST, true, "2026-11-22");
    const ctx = { kind: "order", id: "o-ok" };
    await Promise.all([locationService.report(CUST, { ...POS, context: ctx }).catch(() => null), locationService.setConsent(CUST, false, "2026-11-22")]);
    assert.strictEqual(rows().length, 0, "rút đồng ý không được bị report ghi đè");
    assert.strictEqual((await locationService.report(CUST, { ...POS, context: ctx }).catch((e) => e.code)), "LOCATION_CONSENT_REVOKED");
  });

  await scenario("L9b. Đã rút đồng ý (dòng granted=false) → LOCATION_CONSENT_REVOKED (403) và xóa dòng vị trí; chưa có dòng → LOCATION_CONSENT_REQUIRED", async () => {
    const ctx = { kind: "order", id: "o-ok" };
    await rejects(() => locationService.report(CUST, { ...POS, context: ctx }), "LOCATION_CONSENT_REQUIRED", 403);
    await locationService.setConsent(CUST, false, "2026-11-22");
    // dòng vị trí sót lại (vd ghi từ máy khác trước đó) vẫn phải bị xóa khi report bị chặn
    rows().push({ actor_kind: "customer", actor_id: CUST.id, context_kind: "order", context_id: "o-ok", lat: 1, lng: 1, updated_at: iso(-MIN) });
    await rejects(() => locationService.report(CUST, { ...POS, context: ctx }), "LOCATION_CONSENT_REVOKED", 403);
    assert.strictEqual(rows().length, 0, "rút đồng ý: report phải xóa dòng vị trí");
    // tài khoản khác chưa từng chọn vẫn nhận REQUIRED
    await rejects(() => locationService.report(VOL, { ...POS, context: { kind: "donation", id: "d-route" } }), "LOCATION_CONSENT_REQUIRED", 403);
  });

  // ---- Task 2: đọc theo vai trò, ETA, dọn dẹp, tuyến tối ưu ----
  const live = (kind, id, ctxKind, ctxId, lat, lng, ageMs = 0) => ({ actor_kind: kind, actor_id: id, context_kind: ctxKind, context_id: ctxId, lat, lng, accuracy_m: 10, recorded_at: iso(-ageMs), updated_at: iso(-ageMs) });
  const seedWorld = () => {
    db.seed("profiles", [{ id: CUST.id, full_name: "Khách A" }, { id: "partner-1", full_name: "Chủ quán 1" }, { id: "partner-2", full_name: "Chủ quán 2" }, { id: "owner-a", full_name: "Tổ chức A" }, { id: "owner-b", full_name: "Tổ chức B" }]);
    db.seed("stores", [
      { id: "s1", owner_id: "partner-1", name: "Quán 1", latitude: 10.80, longitude: 106.70 },
      { id: "s-far", owner_id: "partner-2", name: "Quán Xa", latitude: 10.95, longitude: 106.85 }
    ]);
    db.seed("charity_profiles", [
      { id: "ch-a", owner_id: "owner-a", name: "Tổ chức A", latitude: 10.70, longitude: 106.60 },
      { id: "ch-b", owner_id: "owner-b", name: "Tổ chức B", latitude: 10.71, longitude: 106.61 }
    ]);
    db.seed("volunteers", [
      { id: VOL.id, charity_id: "ch-a", full_name: "TNV Một" },
      { id: "vol-b", charity_id: "ch-b", full_name: "TNV Hai" }
    ]);
    db.table("orders").find((o) => o.id === "o-ok").store_id = "s1";
    db.table("orders").find((o) => o.id === "o-ok").order_number = "MIO-001";
    db.table("donations").find((d) => d.id === "d-route").donation_code = "LO-001";
    db.table("donations").find((d) => d.id === "d-route").store_id = "s1";
    db.table("donations").find((d) => d.id === "d-route").charity_id = "ch-a";
  };

  await scenario("R1. Admin thấy TNV + người mua kèm name/context_code/destination/directions_url; lọc kind; dòng 31 phút bị ẩn", async () => {
    seedWorld();
    rows().push(live("volunteer", VOL.id, "donation", "d-route", 10.75, 106.65, 2 * MIN));
    rows().push(live("customer", CUST.id, "order", "o-ok", 10.76, 106.66, 1 * MIN));
    const all = await locationService.listForAdmin({});
    assert.strictEqual(all.length, 2);
    const vol = all.find((r) => r.actor_kind === "volunteer");
    assert.strictEqual(vol.name, "TNV Một");
    assert.strictEqual(vol.context_code, "LO-001");
    assert.strictEqual(vol.destination.label, "Quán 1");
    assert.ok(vol.directions_url.startsWith("https://www.google.com/maps/dir/"));
    const buyer = all.find((r) => r.actor_kind === "customer");
    assert.strictEqual(buyer.name, "Khách A");
    assert.strictEqual(buyer.context_code, "MIO-001");
    assert.ok(buyer.directions_url.startsWith("https://www.google.com/maps/dir/"));
    const onlyCustomers = await locationService.listForAdmin({ kind: "customer" });
    assert.deepStrictEqual(onlyCustomers.map((r) => r.actor_kind), ["customer"]);
    rows().find((r) => r.actor_kind === "customer").updated_at = iso(-31 * MIN);
    assert.deepStrictEqual((await locationService.listForAdmin({})).map((r) => r.actor_kind), ["volunteer"], "dòng 31 phút không hiện");
  });

  await scenario("R2. Charity chỉ thấy TNV của mình; người không sở hữu tổ chức → mảng rỗng", async () => {
    seedWorld();
    db.table("donations").push({ id: "d-b", status: "in_route", store_id: "s1", charity_id: "ch-b", donation_code: "LO-B" });
    db.table("donation_assignments").push({ donation_id: "d-b", volunteer_id: "vol-b", stage: "pickup", done_at: null });
    rows().push(live("volunteer", VOL.id, "donation", "d-route", 10.75, 106.65));
    rows().push(live("volunteer", "vol-b", "donation", "d-b", 10.74, 106.64));
    rows().push(live("customer", CUST.id, "order", "o-ok", 10.76, 106.66));
    const a = await locationService.listForCharity("owner-a");
    assert.deepStrictEqual(a.map((r) => r.actor_id), [VOL.id]);
    const b = await locationService.listForCharity("owner-b");
    assert.deepStrictEqual(b.map((r) => r.actor_id), ["vol-b"]);
    assert.deepStrictEqual(await locationService.listForCharity("partner-1"), []);
    assert.deepStrictEqual(await locationService.listForCharity(CUST.id), []);
    assert.deepStrictEqual(await locationService.listForCharity(""), []);
  });

  await scenario("R3. customerEta: partner sở hữu → có km/phút, KHÔNG có lat/lng; partner khác → RESOURCE_NOT_FOUND", async () => {
    seedWorld();
    rows().push(live("customer", CUST.id, "order", "o-ok", 10.76, 106.66, 3 * MIN));
    const eta = await locationService.customerEta("partner-1", "o-ok");
    assert.ok(eta.distance_km > 0 && eta.eta_minutes > 0, JSON.stringify(eta));
    assert.ok(eta.updated_at);
    assert.ok(!("lat" in eta) && !("lng" in eta), "không được lộ tọa độ");
    assert.ok(!/"(lat|lng|latitude|longitude)"/.test(JSON.stringify(eta)));
    await rejects(() => locationService.customerEta("partner-2", "o-ok"), "RESOURCE_NOT_FOUND", 404);
    await rejects(() => locationService.customerEta("partner-1", "o-khong-co"), "RESOURCE_NOT_FOUND", 404);
    const nothing = { distance_km: null, eta_minutes: null, updated_at: null };
    db.table("orders").find((o) => o.id === "o-ok").status = "cancelled";
    assert.deepStrictEqual(await locationService.customerEta("partner-1", "o-ok"), nothing, "đơn hủy → toàn null");
    db.table("orders").find((o) => o.id === "o-ok").status = "no_show";
    assert.deepStrictEqual(await locationService.customerEta("partner-1", "o-ok"), nothing, "đơn no-show → toàn null");
    db.table("orders").find((o) => o.id === "o-ok").status = "confirmed";
    assert.ok((await locationService.customerEta("partner-1", "o-ok")).eta_minutes > 0);
    rows().length = 0;
    assert.deepStrictEqual(await locationService.customerEta("partner-1", "o-ok"), nothing);
  });

  await scenario("R4. Đơn completed qua updateOrderStatus → xóa dòng người mua; pruneInactive xóa đơn hủy và dòng > 2 giờ", async () => {
    seedWorld();
    const orderService = require("../dist/services/orderService");
    const svc = orderService.orderService || orderService;
    db.table("orders").push({ id: "o-pick", customer_id: CUST.id, store_id: "s1", order_number: "MIO-777", payment_status: "paid", status: "ready", pickup_deadline: iso(HOUR), settlement_status: "none" });
    rows().push(live("customer", CUST.id, "order", "o-pick", 10.76, 106.66));
    await locationService.clearForContext({ kind: "order", id: "o-pick" });
    assert.strictEqual(rows().length, 0, "clearForContext xóa theo nhiệm vụ");
    rows().push(live("customer", CUST.id, "order", "o-pick", 10.76, 106.66));
    await svc.updateOrderStatus("partner-1", "partner", "o-pick", { status: "completed", is_charity_order: false });
    assert.strictEqual(db.table("orders").find((o) => o.id === "o-pick").status, "completed", "đơn phải chuyển completed");
    assert.strictEqual(rows().length, 0, "dòng người mua phải bị xóa khi đơn hoàn tất");

    db.table("orders").push({ id: "o-cancel", customer_id: "cust-3", payment_status: "paid", status: "cancelled" });
    rows().length = 0;
    rows().push(live("customer", "cust-3", "order", "o-cancel", 10.7, 106.6, MIN));
    rows().push(live("customer", CUST.id, "order", "o-ok", 10.7, 106.6, 3 * HOUR));
    rows().push(live("volunteer", VOL.id, "donation", "d-route", 10.7, 106.6, MIN));
    // hỗn hợp: hủy (inactive), > 2 giờ (stale), TNV có assignment (active), TNV khác có assignment (active), TNV không có assignment (inactive)
    rows().push(live("volunteer", "vol-2", "donation", "d-other", 10.7, 106.6, MIN));
    rows().push(live("volunteer", "vol-9", "donation", "d-done", 10.7, 106.6, MIN));
    const orig = db.from.bind(db);
    let calls = 0;
    db.from = (name) => { calls += 1; return orig(name); };
    const pruned = await locationService.pruneInactive();
    db.from = orig;
    assert.strictEqual(pruned, 3, "xóa 1 hủy + 1 stale + 1 hết nhiệm vụ");
    assert.deepStrictEqual(rows().map((r) => r.actor_id).sort(), [VOL.id, "vol-2"].sort(), "chỉ còn dòng của nhiệm vụ hoạt động");
    assert.ok(calls <= 12, "kiểm tra theo lô, không N+1 (số truy vấn: " + calls + ")");
  });

  await scenario("R6. GET admin/charity KHÔNG dọn (không xóa dòng) nhưng vẫn ẩn dòng có nhiệm vụ đã hết", async () => {
    seedWorld();
    db.table("orders").push({ id: "o-cancel", customer_id: "cust-3", store_id: "s1", order_number: "MIO-X", payment_status: "paid", status: "cancelled" });
    db.table("donations").push({ id: "d-gone", status: "in_route", store_id: "s1", charity_id: "ch-a", donation_code: "LO-GONE", assigned_volunteer_id: null, distribution_done_at: null });
    db.table("volunteers").push({ id: "vol-c", charity_id: "ch-a", full_name: "TNV Ba" });
    rows().push(live("volunteer", VOL.id, "donation", "d-route", 10.75, 106.65, MIN));
    rows().push(live("customer", CUST.id, "order", "o-ok", 10.76, 106.66, MIN));
    rows().push(live("customer", "cust-3", "order", "o-cancel", 10.7, 106.6, MIN));
    rows().push(live("volunteer", "vol-c", "donation", "d-gone", 10.7, 106.6, MIN));   // không có phân công mở → hết nhiệm vụ
    rows().push(live("customer", CUST.id + "-x", "order", "o-khong-co", 10.7, 106.6, MIN));
    const before = rows().length;
    const all = await locationService.listForAdmin({});
    assert.deepStrictEqual(all.map((r) => r.context_id).sort(), ["d-route", "o-ok"], "chỉ hiện nhiệm vụ còn hoạt động");
    assert.strictEqual(rows().length, before, "đọc không được xóa dòng (cron đã dọn)");
    const charity = await locationService.listForCharity("owner-a");
    assert.deepStrictEqual(charity.map((r) => r.actor_id), [VOL.id], "charity cũng ẩn TNV hết nhiệm vụ");
    assert.strictEqual(rows().length, before);
  });

  await scenario("R5. listTasks: có vị trí → route.ordered_stops[0] gần TNV hơn, directions.google có origin = vị trí TNV; không có → route null", async () => {
    seedWorld();
    const { volunteerService } = require("../dist/services/volunteerService");
    db.table("donations").push({ id: "d-far", status: "accepted", store_id: "s-far", charity_id: "ch-a", donation_code: "LO-FAR", volunteer_assigned_at: iso(-HOUR), distribution_done_at: null });
    db.table("donation_assignments").push({ donation_id: "d-far", volunteer_id: VOL.id, stage: "pickup", done_at: null, share: 1 });
    db.table("donations").find((d) => d.id === "d-route").volunteer_assigned_at = iso(-2 * HOUR);
    const noLoc = await volunteerService.listTasks(VOL.id);
    assert.ok(noLoc.length >= 2);
    assert.ok(noLoc.every((t) => t.route === null), "không có vị trí → route null");
    rows().push(live("volunteer", VOL.id, "donation", "d-route", 10.96, 106.86));
    const tasks = await volunteerService.listTasks(VOL.id);
    const running = tasks.filter((t) => t.route);
    assert.ok(running.length >= 2, "nhiệm vụ đang chạy có route");
    const route = running[0].route;
    assert.strictEqual(route.ordered_stops.length, 2);
    assert.strictEqual(route.ordered_stops[0].label, "Quán Xa", "điểm gần TNV (10.96,106.86) đi trước");
    assert.ok(route.directions.google.includes("origin=10.960000%2C106.860000"), route.directions.google);
    assert.ok(route.directions.apple);
    rows().find((r) => r.actor_id === VOL.id).updated_at = iso(-31 * MIN);
    const stale = await volunteerService.listTasks(VOL.id);
    assert.ok(stale.every((t) => t.route === null), "vị trí cũ 31 phút → route null");
  });

  // ---- Task 3: đăng nhập OTP email cho TNV ----
  const { volunteerService: vs } = require("../dist/services/volunteerService");
  const vToken = require("../dist/utils/volunteerToken");
  const { volunteerAuth } = require("../dist/middlewares/volunteerAuth");
  const { pushActor } = require("../dist/middlewares/pushAuth");
  const GENERIC = "Nếu email đã được tổ chức đăng ký, mã sẽ được gửi.";
  // Thay hàm chờ thời gian phản hồi tối thiểu: ghi lại mốc, không chờ thật
  const timing = require("../dist/services/volunteerService").otpRequestTiming;
  const waits = [];
  timing.sleepUntil = async (deadline) => { waits.push(deadline); };
  // Gọi requestOtp và trả các mốc chờ của lần gọi đó kèm khoảng [t0, t1] lúc vào/ra hàm
  const timedRequest = async (email) => {
    waits.length = 0;
    const t0 = Date.now();
    const result = await vs.requestOtp(email);
    return { result, t0, t1: Date.now(), deadlines: waits.slice() };
  };
  const seedVolunteers = () => {
    db.seed("charity_profiles", [{ id: "ch-a", owner_id: "owner-a", name: "Tổ chức A" }, { id: "ch-b", owner_id: "owner-b", name: "Tổ chức B" }]);
    db.seed("volunteers", [
      { id: "v-otp", charity_id: "ch-a", full_name: "TNV OTP", phone: "0901000001", email: "Tnv@Mail.com", status: "active" },
      { id: "v-off", charity_id: "ch-a", full_name: "TNV Nghỉ", phone: "0901000002", email: "off@mail.com", status: "inactive" },
      { id: "v-m1", charity_id: "ch-a", full_name: "Hai Nơi", phone: "0901000003", email: "multi@mail.com", status: "active" },
      { id: "v-m2", charity_id: "ch-b", full_name: "Hai Nơi", phone: "0901000003", email: "MULTI@mail.com", status: "pending" },
      { id: "v-m3", charity_id: "ch-b", full_name: "Hai Nơi cũ", phone: "0901000003", email: "multi@mail.com", status: "inactive" },
      { id: "v-x", charity_id: "ch-b", full_name: "Người khác", phone: "0901000004", email: "other@mail.com", status: "active" }
    ]);
  };
  const runMw = (mw, token) => new Promise((resolve) => {
    const req = { headers: token ? { authorization: "Bearer " + token } : {} };
    const res = { locals: {} };
    mw(req, res, (error) => resolve({ error, res }));
  });
  const withEnv = async (patch, fn) => {
    const prev = { NODE_ENV: env.NODE_ENV, DEMO_MODE: env.DEMO_MODE };
    Object.assign(env, patch);
    try { await fn(); } finally { Object.assign(env, prev); }
  };

  await scenario("O1. requestOtp: email không có TNV / TNV inactive → thông báo chung, KHÔNG gửi; có TNV → cùng thông báo, gửi 1 lần với account_type volunteer", async () => {
    seedVolunteers();
    assert.deepStrictEqual(await vs.requestOtp("nobody@mail.com"), { message: GENERIC });
    assert.deepStrictEqual(await vs.requestOtp("off@mail.com"), { message: GENERIC });
    assert.strictEqual(otp.sent.length, 0, "không được gửi mã khi không có TNV hoạt động");
    assert.deepStrictEqual(await vs.requestOtp("  TNV@mail.COM "), { message: GENERIC });
    assert.strictEqual(otp.sent.length, 1);
    assert.strictEqual(otp.sent[0].email, "tnv@mail.com", "email chuẩn hóa lowercase + trim");
    assert.strictEqual(otp.sent[0].options.shouldCreateUser, true);
    assert.strictEqual(otp.sent[0].options.data.account_type, "volunteer");
  });

  await scenario("O2. Sai mã 5 lần → lần 6 OTP_LOCKED (429) dù mã đúng, không gọi Supabase; lùi locked_until → đăng nhập được, đếm về 0", async () => {
    seedVolunteers();
    for (let i = 0; i < 5; i += 1) await rejects(() => vs.verifyOtp(i % 2 ? "TNV@mail.com" : "tnv@mail.com ", "000000"), "AUTH_INVALID_TOKEN", 401);
    const calls = otp.verifyCalls;
    await rejects(() => vs.verifyOtp("tnv@mail.com", GOOD_CODE), "OTP_LOCKED", 429);
    assert.strictEqual(otp.verifyCalls, calls, "đang khóa thì không gọi verifyOtp");
    const attempts = db.table("auth_otp_attempts");
    assert.strictEqual(attempts.length, 1, "một dòng đếm cho mọi biến thể hoa/thường của email");
    assert.ok(attempts[0].key.includes("tnv@mail.com"));
    assert.ok(new Date(attempts[0].locked_until).getTime() > Date.now() + 14 * MIN, "khóa 15 phút");
    attempts[0].locked_until = iso(-1000);
    const ok = await vs.verifyOtp("tnv@mail.com", GOOD_CODE);
    assert.ok(ok.token);
    assert.strictEqual(attempts[0].failed_count, 0, "đúng mã thì đếm về 0");
    assert.strictEqual(attempts[0].locked_until, null);
    assert.deepStrictEqual(otp.signOuts.map((s) => s[0]), ["sess-" + otp.verifyCalls], "thu hồi phiên Supabase vừa sinh");
    // sai cũ hơn 15 phút không cộng dồn
    attempts[0].failed_count = 4; attempts[0].window_started_at = iso(-16 * MIN);
    await rejects(() => vs.verifyOtp("tnv@mail.com", "000000"), "AUTH_INVALID_TOKEN", 401);
    assert.strictEqual(attempts[0].failed_count, 1);
    assert.strictEqual(attempts[0].locked_until, null);
  });

  await scenario("O3. Mã đúng, 1 TNV → token amr otp; production + DEMO_MODE=false: volunteerAuth/pushActor/locationActor nhận; token demo → 403", async () => {
    seedVolunteers();
    const r = await vs.verifyOtp("tnv@mail.com", GOOD_CODE);
    assert.strictEqual(vToken.verifyVolunteerToken(r.token).amr, "otp");
    assert.strictEqual(vToken.verifyVolunteerToken(r.token).vid, "v-otp");
    assert.deepStrictEqual(r.volunteer, { id: "v-otp", full_name: "TNV OTP", phone: "0901000001", charity_name: "Tổ chức A" });
    assert.ok(db.table("volunteers").find((v) => v.id === "v-otp").last_login_at, "cập nhật last_login_at");
    assert.strictEqual(vToken.verifyVolunteerToken(vToken.createVolunteerToken("v-otp", "ch-a")).amr, "demo", "mặc định demo");
    await withEnv({ NODE_ENV: "production", DEMO_MODE: false }, async () => {
      const a = await runMw(volunteerAuth, r.token);
      assert.ok(!a.error, a.error && a.error.message);
      assert.strictEqual(a.res.locals.volunteerId, "v-otp");
      const p = await runMw(pushActor, r.token);
      assert.ok(!p.error);
      assert.deepStrictEqual(p.res.locals.pushOwner, { kind: "volunteer", id: "v-otp" });
      const l = await runMw(locationAuth.locationActor, r.token);
      assert.ok(!l.error);
      assert.deepStrictEqual(l.res.locals.locationActor, { kind: "volunteer", id: "v-otp" });
      const demo = vToken.createVolunteerToken("v-otp", "ch-a");
      for (const mw of [volunteerAuth, pushActor, locationAuth.locationActor]) {
        const blocked = await runMw(mw, demo);
        assert.ok(blocked.error && blocked.error.statusCode === 403 && blocked.error.code === "AUTH_VERIFICATION_REQUIRED", "token demo bị chặn ở production");
      }
      // DEMO_MODE bật ở production vẫn chặn token demo
      env.DEMO_MODE = true;
      assert.strictEqual((await runMw(volunteerAuth, demo)).error.code, "AUTH_VERIFICATION_REQUIRED");
    });
  });

  await scenario("O4. Email thuộc 2 TNV ở 2 tổ chức → selection_token + 2 lựa chọn; chọn đúng → token; id của email khác / inactive / token hết 5 phút → 403", async () => {
    seedVolunteers();
    const r = await vs.verifyOtp("Multi@Mail.com", GOOD_CODE);
    assert.strictEqual(r.token, undefined);
    assert.ok(r.selection_token);
    assert.deepStrictEqual(r.options.map((o) => [o.volunteer_id, o.charity_name]).sort(), [["v-m1", "Tổ chức A"], ["v-m2", "Tổ chức B"]]);
    const chosen = await vs.selectVolunteer(r.selection_token, "v-m2");
    assert.strictEqual(vToken.verifyVolunteerToken(chosen.token).vid, "v-m2");
    assert.strictEqual(vToken.verifyVolunteerToken(chosen.token).amr, "otp");
    assert.strictEqual(chosen.volunteer.charity_name, "Tổ chức B");
    await rejects(() => vs.selectVolunteer(r.selection_token, "v-x"), "AUTH_FORBIDDEN", 403);
    await rejects(() => vs.selectVolunteer(r.selection_token, "v-m3"), "AUTH_FORBIDDEN", 403);
    await rejects(() => vs.selectVolunteer(r.selection_token, "v-khong-co"), "AUTH_FORBIDDEN", 403);
    await rejects(() => vs.selectVolunteer("rac.rac", "v-m1"), "AUTH_FORBIDDEN", 403);
    await rejects(() => vs.selectVolunteer(vToken.createVolunteerToken("v-m1", "ch-a", "otp"), "v-m1"), "AUTH_FORBIDDEN", 403);
    assert.strictEqual(vToken.verifyVolunteerToken(r.selection_token), null, "selection token không dùng làm token TNV");
    assert.deepStrictEqual(vToken.verifySelectionToken(vToken.createSelectionToken(" A@B.com ")), { email: "a@b.com" });
    const realNow = Date.now;
    Date.now = () => realNow() + 5 * MIN + 1000;
    try { await rejects(() => vs.selectVolunteer(r.selection_token, "v-m1"), "AUTH_FORBIDDEN", 403); } finally { Date.now = realNow; }
  });

  await scenario("O5. TNV bị chuyển inactive / bị xóa sau khi có token → volunteerAuth, pushActor, locationActor đều 403 AUTH_FORBIDDEN", async () => {
    seedVolunteers();
    const { token } = await vs.verifyOtp("tnv@mail.com", GOOD_CODE);
    assert.ok(!(await runMw(volunteerAuth, token)).error);
    db.table("volunteers").find((v) => v.id === "v-otp").status = "inactive";
    const off = await runMw(volunteerAuth, token);
    assert.ok(off.error && off.error.statusCode === 403 && off.error.code === "AUTH_FORBIDDEN");
    assert.strictEqual(off.res.locals.volunteerId, undefined);
    const offPush = await runMw(pushActor, token);
    assert.ok(offPush.error && offPush.error.statusCode === 403 && offPush.error.code === "AUTH_FORBIDDEN", "pushActor chặn TNV inactive");
    assert.strictEqual(offPush.res.locals.pushOwner, undefined);
    const offLoc = await runMw(locationAuth.locationActor, token);
    assert.ok(offLoc.error && offLoc.error.statusCode === 403 && offLoc.error.code === "AUTH_FORBIDDEN", "locationActor chặn TNV inactive");
    assert.strictEqual(offLoc.res.locals.locationActor, undefined);
    const vols = db.table("volunteers");
    vols.splice(vols.findIndex((v) => v.id === "v-otp"), 1);
    for (const mw of [volunteerAuth, pushActor, locationAuth.locationActor]) {
      const gone = await runMw(mw, token);
      assert.ok(gone.error && gone.error.statusCode === 403 && gone.error.code === "AUTH_FORBIDDEN", "TNV không tồn tại bị chặn");
    }
    assert.strictEqual((await runMw(volunteerAuth, "khong.hop.le")).error.statusCode, 401);
  });

  await scenario("O6. Migration 039 thay handle_new_user và bỏ qua account_type = 'volunteer'", async () => {
    const sql = require("fs").readFileSync(require("path").join(__dirname, "../database/User/039_live_location.sql"), "utf8").replace(/\r\n/g, "\n"); // checkout CRLF trên Windows
    const start = sql.indexOf("create or replace function public.handle_new_user()");
    assert.ok(start >= 0, "phải có create or replace function public.handle_new_user()");
    const body = sql.slice(start, sql.indexOf("$$;", start));
    assert.ok(body.includes("if new.raw_user_meta_data ->> 'account_type' = 'volunteer'\n     and exists (select 1 from public.volunteers v where lower(trim(v.email)) = lower(trim(new.email))) then\n    return new;"),
      "chỉ bỏ qua khi email thuộc một TNV thật (chống đặt trước bằng metadata)");
    assert.ok(body.indexOf("account_type' = 'volunteer'") < body.indexOf("insert into public.profiles"), "trả về trước khi tạo profiles");
    assert.ok(body.includes("insert into public.customer_profiles"), "giữ luồng tạo hồ sơ người mua");
  });


  await scenario("O7. requestOtp: nhánh có TNV và không có TNV đều chờ cùng hàm tới cùng mốc (vào hàm + 1500 ms)", async () => {
    seedVolunteers();
    assert.strictEqual(timing.minResponseMs, 1500);
    for (const email of ["nobody@mail.com", "off@mail.com", "tnv@mail.com"]) {
      const { result, t0, t1, deadlines } = await timedRequest(email);
      assert.deepStrictEqual(result, { message: GENERIC });
      assert.ok(deadlines.length >= 1, "phải chờ mốc thời gian: " + email);
      assert.ok(deadlines.every((d) => d === deadlines[0]), "mọi lần chờ dùng cùng một mốc");
      assert.ok(deadlines[0] >= t0 + 1500 && deadlines[0] <= t1 + 1500, "mốc = lúc vào hàm + 1500 ms");
    }
    assert.strictEqual(otp.sent.length, 1);
    // lỗi DB cũng vẫn chờ đủ mốc rồi mới báo lỗi
    const orig = db.from.bind(db);
    db.from = (name) => (name === "volunteers" ? { select: () => ({ ilike: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }) } : orig(name));
    waits.length = 0;
    try { await assert.rejects(() => vs.requestOtp("tnv@mail.com")); } finally { db.from = orig; }
    assert.strictEqual(waits.length, 1, "nhánh lỗi cũng chờ đủ mốc");
  });

  await scenario("O8. Gửi OTP tối đa 3 lần / 15 phút / email: lần 4 không gọi signInWithOtp, vẫn cùng thông báo và chờ đủ mốc", async () => {
    seedVolunteers();
    for (let i = 0; i < 3; i += 1) await vs.requestOtp(i % 2 ? "TNV@mail.com" : "tnv@mail.com");
    assert.strictEqual(otp.sent.length, 3);
    const fourth = await timedRequest("tnv@mail.com");
    assert.deepStrictEqual(fourth.result, { message: GENERIC });
    assert.strictEqual(otp.sent.length, 3, "lần thứ 4 không được gửi");
    assert.ok(fourth.deadlines.length >= 1 && fourth.deadlines[0] >= fourth.t0 + 1500);
    const row = db.table("auth_otp_attempts").find((r) => r.key === "volunteer-send:tnv@mail.com");
    assert.ok(row, "bộ đếm gửi lưu trong auth_otp_attempts với key volunteer-send:<email>");
    // hết cửa sổ 15 phút → gửi lại được
    row.window_started_at = iso(-16 * MIN); row.locked_until = iso(-MIN);
    await vs.requestOtp("tnv@mail.com");
    assert.strictEqual(otp.sent.length, 4);
    // bộ đếm gửi không ảnh hưởng bộ đếm xác minh
    assert.ok(await vs.verifyOtp("tnv@mail.com", GOOD_CODE));
  });

  await scenario("O9. 8 lần verifyOtp sai chạy song song → Supabase verifyOtp được gọi tối đa 5 lần", async () => {
    seedVolunteers();
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => vs.verifyOtp("tnv@mail.com", "000000").then(() => "ok", (e) => e.code)));
    assert.ok(otp.verifyCalls <= 5, "verifyCalls = " + otp.verifyCalls);
    assert.ok(outcomes.every((c) => c === "AUTH_INVALID_TOKEN" || c === "OTP_LOCKED"), outcomes.join(","));
    await rejects(() => vs.verifyOtp("tnv@mail.com", GOOD_CODE), "OTP_LOCKED", 429);
  });

  await scenario("O10. OTP đúng: auth user KHÔNG có profiles → xóa sau khi thu hồi phiên; có profiles → KHÔNG xóa; lỗi xóa không chặn đăng nhập", async () => {
    seedVolunteers();
    const r = await vs.verifyOtp("tnv@mail.com", GOOD_CODE);
    assert.ok(r.token);
    assert.deepStrictEqual(otp.deleted, ["auth-tnv@mail.com"], "xóa auth user không có hồ sơ");
    assert.strictEqual(otp.signOuts.length, 1, "thu hồi phiên trước khi xóa");
    // email đã có hồ sơ người mua (cùng auth user) → không bao giờ xóa
    db.table("profiles").push({ id: "auth-tnv@mail.com", full_name: "Người mua" });
    otp.deleted = [];
    assert.ok((await vs.verifyOtp("tnv@mail.com", GOOD_CODE)).token);
    assert.deepStrictEqual(otp.deleted, [], "có profiles thì không xóa");
    // email không thuộc TNV nào (403) vẫn dọn auth user mồ côi
    await rejects(() => vs.verifyOtp("nobody@mail.com", GOOD_CODE), "AUTH_FORBIDDEN", 403);
    assert.deepStrictEqual(otp.deleted, ["auth-nobody@mail.com"]);
    // xóa lỗi → chỉ ghi log, vẫn đăng nhập được
    db.table("profiles").length = 0;
    otp.deleted = []; otp.deleteError = { message: "boom" };
    assert.ok((await vs.verifyOtp("tnv@mail.com", GOOD_CODE)).token);
    assert.deepStrictEqual(otp.deleted, ["auth-tnv@mail.com"]);
    // mã sai → không xóa gì
    otp.deleted = [];
    await rejects(() => vs.verifyOtp("tnv@mail.com", "000000"), "AUTH_INVALID_TOKEN", 401);
    assert.deepStrictEqual(otp.deleted, []);
  });

  const failed = results.filter((r) => !r[0]).length;
  console.log("\n" + (results.length - failed) + "/" + results.length + " kịch bản đạt" + (failed ? ", " + failed + " KHÔNG ĐẠT" : "") + ".\n");
  process.exit(failed ? 1 : 0);
})();
