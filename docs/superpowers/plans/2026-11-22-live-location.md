# Live Location + Volunteer Email OTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chia sẻ vị trí trình duyệt khi đang làm nhiệm vụ (TNV, người mua), bản đồ theo dõi cho admin/tổ chức, ETA cho cửa hàng, chỉ đường tối ưu, và đăng nhập OTP email cho TNV ở production — toàn bộ miễn phí.

**Architecture:** REST + polling trên Netlify Functions. Bảng `live_locations` (1 dòng/người) + `location_consents` + `auth_otp_attempts`. `locationService` kiểm tra nhiệm vụ đang hoạt động trước khi ghi; đọc thì dọn dòng hết nhiệm vụ. Client dùng chung `public/frontend/foodsave-location.js`. Bản đồ Leaflet/OSM sẵn có; chỉ đường bằng link Google Maps.

**Tech Stack:** Express + TypeScript + Zod, Supabase (service role), vanilla JS, Leaflet, Playwright, test offline FakeDb (`scripts/fake-supabase.js`).

**Spec:** `docs/superpowers/specs/2026-11-22-live-location-design.md` (đọc trước khi làm bất kỳ task nào).

## Global Constraints

- Không dùng dịch vụ tính tiền: không Google Maps JS API, không SMS, không Socket server.
- Nhịp gửi client: `SEND_INTERVAL_MS = 120000`, `SEND_DISTANCE_M = 300`, `MIN_SEND_MS = 60000`. Server bỏ qua nếu lần ghi trước < `55` giây (trả `{ stored: false, throttled: true }`).
- Dòng vị trí cũ hơn `2` giờ bị xóa; admin chỉ hiện dòng ≤ `30` phút; UI làm mờ dòng > `5` phút. Admin/charity poll `20` giây khi `document.visibilityState === "visible"`.
- OTP TNV: tối đa `5` lần sai / `15` phút / email, sau đó khóa `15` phút. `selection_token` hạn `5` phút.
- `LOCATION_POLICY_VERSION = "2026-11-22"`. localStorage key `mio.location.consent.v1` (mọi truy cập bọc try/catch).
- Người mua theo dõi tự động khi `payment_status='paid'` và `status in ('pending','confirmed','ready')` (kể cả có người nhận hộ).
- Hàm list/đọc trong service phải **mặc định từ chối** role ngoài danh sách (admin client bỏ qua RLS).
- Văn bản hiển thị, log, comment: tiếng Việt. Không commit (người dùng chưa yêu cầu).
- Sau mỗi task backend: `npm test`, `node scripts/test-order-policy.js`, `node scripts/test-order-flow.js`, `node scripts/test-live-location.js` đều đạt.

## Review Focus

1. Trình duyệt không có/không cho quyền vị trí, hết thời gian, hoặc trang không HTTPS → không lỗi JS, luồng đơn/nhiệm vụ chạy bình thường (Task 5 test).
2. Tọa độ rác: `(0,0)`, ngoài khoảng, `accuracy_m > 2000` → 400 `VALIDATION_ERROR`, không ghi (Task 1 test).
3. Đồng hồ thiết bị lệch: `recorded_at` ở tương lai hoặc cũ hơn 10 phút → server dùng giờ server cho `updated_at`, `recorded_at` bị kẹp về giờ server (Task 1 test).
4. Hai tab cùng người gửi song song → vẫn đúng 1 dòng, throttle đúng (Task 1 test).
5. localStorage bị chặn (chế độ riêng tư) → không lỗi; hộp xin quyền có thể hiện lại, chấp nhận được (Task 5 test).

---

### Task 1: Lõi backend chia sẻ vị trí

**Files:**
- Create: `database/User/039_live_location.sql` (bảng `live_locations`, `location_consents`, `auth_otp_attempts` theo spec §5.1; RLS bật, không policy)
- Create: `src/services/locationService.ts`, `src/middlewares/locationAuth.ts`, `src/routes/locationRoutes.ts`, `src/schemas/locationSchemas.ts`
- Modify: `src/routes/index.ts` (mount `apiRoutes.use("/location", locationRoutes)` cạnh `/push`), `src/constants/errors.ts` (thêm `LOCATION_CONSENT_REQUIRED`, `NO_ACTIVE_TASK`, `OTP_LOCKED`)
- Modify nếu thiếu tính năng: `scripts/fake-supabase.js` (upsert theo khóa ghép, delete, `.is`, `.in`, `.lt`)
- Test: `scripts/test-live-location.js` (mới, cùng khuôn `test-order-flow.js`: đặt env giả trước khi require, FakeDb, `scenario()`, in `N/M kịch bản đạt`, exit 1 khi có lỗi)

**Interfaces — Produces:**
- `type LocationActor = { kind: "volunteer" | "customer"; id: string }`
- `type LocationContext = { kind: "donation" | "order"; id: string }`
- `locationService.setConsent(actor: LocationActor, granted: boolean, policyVersion: string, userAgent?: string): Promise<{ granted: boolean }>`
- `locationService.report(actor: LocationActor, input: { lat: number; lng: number; accuracy_m?: number; recorded_at?: string; context: LocationContext }): Promise<{ stored: boolean; throttled: boolean }>` — ném 403 `LOCATION_CONSENT_REQUIRED`, 409 `NO_ACTIVE_TASK` (và xóa dòng của actor).
- `locationService.isActiveTask(actor: LocationActor, context: LocationContext): Promise<boolean>` — TNV: có `donation_assignments` của TNV với `done_at is null` cho donation có `status in ('accepted','in_route','completed')` và chưa `distribution_done_at` khi stage là `distribute`; hoặc `donations.assigned_volunteer_id = actor` với `status in ('accepted','in_route')`. Người mua: `orders.customer_id = actor`, `payment_status='paid'`, `status in ('pending','confirmed','ready')`. Kind không khớp (customer+donation, volunteer+order) → false.
- `locationService.clear(actor: LocationActor): Promise<void>`
- `middleware locationActor` → `res.locals.locationActor: LocationActor`. Token TNV hợp lệ: cùng điều kiện cổng như `pushActor` hiện tại (Task 3 sẽ thay bằng helper chung). Không phải TNV → `authMiddleware` + `requireRoles("customer")`.
- Routes: `POST /location/consent` `{ granted: boolean, policy_version: string }`; `POST /location` (schema `.strict()`: `lat` −90..90, `lng` −180..180, không cùng = 0, `accuracy_m` 0..2000 optional, `recorded_at` ISO optional, `context`); `DELETE /location`.

- [ ] **Step 1: Viết test thất bại** trong `scripts/test-live-location.js`, các kịch bản:
  - `L1` chưa consent → `report` ném `LOCATION_CONSENT_REQUIRED`; sau `setConsent(true)` → `{ stored: true }`, có đúng 1 dòng `live_locations`.
  - `L2` người mua + đơn của người khác / đơn `awaiting_payment` / đơn `completed` → `NO_ACTIVE_TASK`, dòng cũ của actor bị xóa.
  - `L3` TNV + donation không được giao / assignment đã `done_at` → `NO_ACTIVE_TASK`; TNV được giao, donation `in_route` → stored.
  - `L4` gọi `report` 2 lần liên tiếp (giả lập 2 tab, `Promise.all`) → vẫn 1 dòng; lần trong 55 giây trả `throttled: true`; chỉnh `updated_at` lùi 56 giây → stored.
  - `L5` `recorded_at` ở tương lai 1 giờ → dòng lưu `recorded_at` ≤ giờ server.
  - `L6` schema route: `lat: 0, lng: 0`, `lat: 91`, `accuracy_m: 5000` → bị `locationSchemas` từ chối (gọi `safeParse`).
  - `L7` `locationActor`: token TNV khi `DEMO_MODE=false` → 403 `AUTH_VERIFICATION_REQUIRED`; `DEMO_MODE=true` → `{ kind: "volunteer", id }`; không token → 401.
  - `L8` `setConsent(false)` sau khi có dòng → `report` ném `LOCATION_CONSENT_REQUIRED` và dòng bị xóa.
- [ ] **Step 2:** `npx tsc && node scripts/test-live-location.js` → FAIL (module chưa có).
- [ ] **Step 3:** Viết migration, schemas, service, middleware, routes như Interfaces.
- [ ] **Step 4:** `npm test && node scripts/test-live-location.js && node scripts/test-order-flow.js` → tất cả đạt.

### Task 2: Đọc vị trí theo vai trò, ETA, dọn dẹp, tuyến tối ưu cho TNV

**Files:**
- Modify: `src/services/locationService.ts`, `src/routes/adminRoutes.ts`, `src/routes/charityRoutes.ts`, `src/routes/partnerRoutes.ts`, `src/services/orderService.ts` (sau khi cập nhật `status: "completed"` ở ~dòng 708 gọi `clearForContext`), `src/services/teamService.ts` (`completeStage` sau khi set `done_at` → `clear({kind:"volunteer", id})` nếu TNV không còn assignment mở), `src/services/orderAutomationService.ts` (`run()` gọi `pruneInactive()` và đưa số dòng xóa vào kết quả), `src/services/volunteerService.ts` (`listTasks` gắn `route`)
- Test: `scripts/test-live-location.js`

**Interfaces — Consumes:** Task 1. `bestOrder`, `routeDirectionsLinks`, `roadKm`, `travelMinutes` từ `src/core/routing`.
**Produces:**
- `type LiveLocationView = { actor_kind; actor_id; name: string; context_kind; context_id; context_code: string; lat: number; lng: number; accuracy_m: number | null; updated_at: string; destination: { lat: number; lng: number; label: string } | null; directions_url: string | null }`
- `locationService.clearForContext(context: LocationContext): Promise<void>`
- `locationService.pruneInactive(now?: Date): Promise<number>` — xóa dòng cũ > 2 giờ và dòng mà `isActiveTask` = false.
- `locationService.listForAdmin(filter: { kind?: "volunteer" | "customer" }): Promise<LiveLocationView[]>` — chỉ dòng ≤ 30 phút, gọi `pruneInactive` trước.
- `locationService.listForCharity(actorId: string): Promise<LiveLocationView[]>` — chỉ TNV có `charity_id` thuộc `charity_profiles.owner_id = actorId`.
- `locationService.customerEta(partnerId: string, orderId: string): Promise<{ distance_km: number | null; eta_minutes: number | null; updated_at: string | null }>` — đơn phải thuộc cửa hàng của partner (không thì 404); **không bao giờ trả lat/lng**.
- Routes: `GET /admin/live-locations?kind=` (đã có `requireRoles("admin")` ở router), `GET /charity/volunteers/live` (`authMiddleware` + `requireRoles("charity")`), `GET /partner/orders/:id/customer-eta` (`requireRoles("partner")`).
- `listTasks` thêm trường `route: { ordered_stops: Array<{ lat; lng; label }>; directions: DirectionsLinks } | null` cho nhiệm vụ đang chạy khi TNV có dòng `live_locations` (origin = vị trí đó).

- [ ] **Step 1: Test thất bại** — kịch bản:
  - `R1` admin thấy TNV + người mua, có `name`, `context_code`, `destination`, `directions_url` bắt đầu `https://www.google.com/maps/dir/`; lọc `kind: "customer"` chỉ còn người mua; dòng 31 phút không hiện.
  - `R2` charity A chỉ thấy TNV của A, không thấy TNV của B; role khác gọi service (`listForCharity` với user không sở hữu charity) → mảng rỗng.
  - `R3` `customerEta` của partner sở hữu → có `distance_km` > 0, `eta_minutes` > 0 và **object không có khóa `lat`/`lng`**; partner khác → `RESOURCE_NOT_FOUND`.
  - `R4` đơn chuyển `completed` qua `updateOrderStatus` → dòng người mua bị xóa; `pruneInactive` xóa dòng của đơn bị hủy và dòng > 2 giờ.
  - `R5` `listTasks` của TNV có vị trí → `route.ordered_stops[0]` là điểm gần vị trí TNV hơn, `route.directions.google` có origin = tọa độ TNV; không có vị trí → `route: null`.
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3:** cài đặt theo Interfaces.
- [ ] **Step 4:** toàn bộ test (Global Constraints) đạt.

### Task 3: Đăng nhập OTP email cho TNV + chấp nhận token OTP ở production

**Files:**
- Modify: `database/User/039_live_location.sql` (thêm `create or replace function public.handle_new_user()` chép từ `database/Admin/014_admin_login_security.sql`, thêm ở đầu thân: `if new.raw_user_meta_data ->> 'account_type' = 'volunteer' then return new; end if;`)
- Modify: `src/utils/volunteerToken.ts`, `src/middlewares/volunteerAuth.ts`, `src/middlewares/pushAuth.ts`, `src/middlewares/locationAuth.ts`, `src/services/volunteerService.ts`, `src/routes/volunteerRoutes.ts`
- Test: `scripts/test-live-location.js`; cập nhật `scripts/test-order-flow.js` P9 nếu hành vi đổi (token `demo` vẫn bị chặn ngoài demo; thêm khẳng định token `otp` được chấp nhận khi `NODE_ENV=production`).

**Interfaces — Produces:**
- `createVolunteerToken(volunteerId: string, charityId: string, amr: "otp" | "demo" = "demo"): string`; payload có `amr`; token thiếu `amr` coi là `"demo"`.
- `isVolunteerTokenUsable(payload: VolunteerTokenPayload): boolean` = `payload.amr === "otp" || (env.NODE_ENV !== "production" && env.DEMO_MODE)`. Dùng ở cả 3 middleware (thay cổng hiện tại). Cổng chặn trả 403 `AUTH_VERIFICATION_REQUIRED` như cũ.
- `volunteerAuth` sau khi xác thực: đọc `volunteers.status`; `inactive` hoặc không tồn tại → 403 `AUTH_FORBIDDEN`.
- `createSelectionToken(email: string): string` / `verifySelectionToken(token: string): { email: string } | null` (HMAC, hạn 5 phút, cùng secret khác tiền tố).
- `volunteerService.requestOtp(email: string): Promise<{ message: string }>` — luôn trả `"Nếu email đã được tổ chức đăng ký, mã sẽ được gửi."`; chỉ gọi `supabaseAuth.auth.signInWithOtp({ email, options: { shouldCreateUser: true, data: { account_type: "volunteer" } } })` khi có TNV `status != 'inactive'` khớp email (so sánh lowercase, trim).
- `volunteerService.verifyOtp(email: string, code: string): Promise<{ token: string; volunteer: {...} } | { selection_token: string; options: Array<{ volunteer_id: string; charity_name: string }> }>` — kiểm `auth_otp_attempts` (khóa → 429 `OTP_LOCKED`); `supabaseAuth.auth.verifyOtp({ email, token: code, type: "email" })`; sai → tăng đếm, 401 `AUTH_INVALID_TOKEN`; đúng → reset đếm, thu hồi phiên Supabase vừa sinh (`supabaseAdmin.auth.admin.signOut(access_token)`), cập nhật `last_login_at`, cấp token `amr: "otp"`.
- `volunteerService.selectVolunteer(selectionToken: string, volunteerId: string)` → token `amr: "otp"` nếu `volunteerId` thuộc email trong selection token và không `inactive`; ngược lại 403.
- Routes: `POST /volunteer/otp/request { email }`, `POST /volunteer/otp/verify { email, code: /^\d{6}$/ }`, `POST /volunteer/otp/select { selection_token, volunteer_id: uuid }`.
- Đăng nhập số điện thoại cũ (`login`) giữ nguyên, cấp `amr: "demo"`.

- [ ] **Step 1: Test thất bại** (giả `supabaseAuth.auth.signInWithOtp`/`verifyOtp` trong test, đếm số lần gọi):
  - `O1` email không có TNV → thông báo chung, `signInWithOtp` **không** được gọi; email có TNV → cùng thông báo, được gọi 1 lần với `data.account_type === "volunteer"`.
  - `O2` sai mã 5 lần → lần 6 ném `OTP_LOCKED` dù mã đúng; lùi `locked_until` → đúng mã thì đăng nhập được và đếm về 0.
  - `O3` mã đúng, 1 dòng TNV → token có `amr: "otp"`; với `env.NODE_ENV = "production"`, `DEMO_MODE = false`: `volunteerAuth`, `pushActor`, `locationActor` đều chấp nhận token này; token từ `createVolunteerToken(id, cid)` (demo) bị 403.
  - `O4` email thuộc 2 TNV ở 2 tổ chức → trả `selection_token` + 2 options; `selectVolunteer` với id hợp lệ → token; id của email khác → 403; selection token quá 5 phút → 403.
  - `O5` TNV chuyển `inactive` sau khi có token → `volunteerAuth` trả 403 `AUTH_FORBIDDEN`.
  - `O6` migration 039 chứa `account_type' = 'volunteer'` trong `handle_new_user` (đọc file, kiểm chuỗi).
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3:** cài đặt theo Interfaces.
- [ ] **Step 4:** toàn bộ test đạt (kể cả P9 đã cập nhật).

### Task 4: Client dùng chung `foodsave-location.js` + hộp xin quyền một lần

**Files:**
- Create: `public/frontend/foodsave-location.js`, `public/frontend/foodsave-location.css`
- Modify: `public/chinh-sach.html` (đoạn "Dữ liệu vị trí": mục đích, chỉ khi làm nhiệm vụ, chỉ giữ vị trí mới nhất, xóa khi xong, đổi ý trong hồ sơ)
- Test: `tests/e2e/location.spec.mjs` (Playwright, trang thử `tests/e2e/fixtures/location.html` nạp script và stub API bằng `page.route`)

**Interfaces — Produces (`window.FoodSaveLocation`):**
- `init({ apiBase: string, getAuthHeader: () => string | null }): void` — hiện hộp xin quyền nếu chưa có lựa chọn trong localStorage và `navigator.permissions` không báo `granted`/`denied`.
- `consentState(): "granted" | "denied" | "unknown"`; `setConsent(granted: boolean): Promise<void>` (lưu local + `POST /location/consent` nếu có auth header).
- `startTask(context: { kind: "donation" | "order"; id: string }): void`; `stopTask(): void` (gọi `DELETE /location`).
- `current(): { lat: number; lng: number; accuracy_m: number; at: number } | null`
- `directionsUrl(destination: { lat: number; lng: number }): string` — `https://www.google.com/maps/dir/?api=1&destination=lat,lng` (+ `&origin=lat,lng` khi có `current()`), `travelmode=driving`.
- Hộp: nội dung theo spec §5.4; nút `data-location-allow` "Cho phép", `data-location-later` "Để sau".

- [ ] **Step 1: Test thất bại** — Playwright:
  - hộp hiện ở lần tải đầu; bấm "Để sau" → tải lại không hiện.
  - `grantPermissions(['geolocation'])` + `setGeolocation`; bấm "Cho phép" → có request `POST /location/consent` `{ granted: true }`; `startTask` → có `POST /location` với tọa độ; gọi lần 2 ngay → không gửi thêm (MIN_SEND_MS); API trả 409 → `stopTask` tự chạy, không gửi tiếp.
  - Không có quyền (không grant) → không có `pageerror`.
  - `localStorage` ném lỗi (`page.addInitScript` ghi đè getter) → không có `pageerror`.
- [ ] **Step 2:** `npx playwright test tests/e2e/location.spec.mjs` → FAIL.
- [ ] **Step 3:** cài đặt.
- [ ] **Step 4:** `npx playwright test` toàn bộ đạt.

### Task 5: Trang người mua + cửa hàng

**Files:** Modify `public/FOODSAVE_USER.html`, `public/FOODSAVE_APP.html`, `public/FOODSAVE_PARTNER.html` (và `_v2` chỉ nếu đang được dùng — xem `netlify.toml`/link nội bộ). Test: thêm vào `tests/e2e/location.spec.mjs` hoặc `tests/e2e/ui.spec.mjs`.

**Consumes:** Task 4 API; `GET /partner/orders/:id/customer-eta` (Task 2); `FoodSaveMap.currentPosition` sẵn có.
- Người mua: nạp script, `init`; khi danh sách đơn có đơn `payment_status='paid'` & `status in (pending,confirmed,ready)` → `startTask({kind:"order", id})` (đơn mới nhất); không còn → `stopTask()`. Nút "Chỉ đường tới cửa hàng" dùng `directionsUrl(store)`. Hồ sơ có công tắc "Chia sẻ vị trí khi làm nhiệm vụ" → `setConsent`.
- Cửa hàng: `init`; nút "Dùng vị trí hiện tại" cạnh ô tọa độ cửa hàng; chi tiết đơn hiện "Khách cách ~X km · cập nhật Y phút trước" từ ETA API (ẩn khi null).

- [ ] **Step 1:** Test Playwright: trang người mua và cửa hàng nạp không `pageerror`, `window.FoodSaveLocation` tồn tại; với API stub có đơn đã thanh toán → có `POST /location`.
- [ ] **Step 2:** FAIL → **Step 3:** cài đặt → **Step 4:** `npx playwright test` đạt.

### Task 6: Trang tình nguyện viên + tổ chức

**Files:** Modify `public/FOODSAVE_VOLUNTEER.html`, `public/FOODSAVE_CHARITY.html`. Test Playwright.

**Consumes:** Task 3 routes OTP; Task 2 `route` trong `/volunteer/tasks`, `GET /charity/volunteers/live`; Task 4 API.
- TNV: màn đăng nhập mặc định email → mã 6 số (`/volunteer/otp/request`, `/otp/verify`, màn chọn tổ chức khi có `selection_token` → `/otp/select`); giữ đăng nhập số điện thoại khi `demo_mode`. `init` với header `Bearer <token TNV>`; nhiệm vụ đang chạy → `startTask({kind:"donation", id})`. Nút "Chỉ đường" dùng `task.route.directions.google` nếu có, nếu không giữ cách cũ.
- Tổ chức: `init`; "Dùng vị trí hiện tại" cho tọa độ tổ chức; bản đồ nhỏ (Leaflet qua `FoodSaveMap.createMap`) các TNV đang làm nhiệm vụ, poll 20 giây khi tab hiển thị.

- [ ] **Step 1:** Test: TNV đăng nhập email → mã (API stub) → vào danh sách nhiệm vụ; có 2 tổ chức → hiện màn chọn; trang tổ chức hiện bản đồ với marker từ stub; không `pageerror`.
- [ ] **Step 2:** FAIL → **Step 3:** cài đặt → **Step 4:** `npx playwright test` đạt.

### Task 7: Tab "Bản đồ theo dõi" ở admin + tài liệu vận hành

**Files:** Modify `public/ADMIN_FOODSAVE.html` (và `ADMIN_FOODSAVE_v2.html` nếu đang dùng), `HANDOFF.md`. Test Playwright.

**Consumes:** `GET /admin/live-locations` (Task 2); Leaflet + `foodsave-map.js` (nạp giống các trang khác đang nạp Leaflet).
- Mục menu `data-p="tracking"` "Bản đồ theo dõi"; trang có bản đồ, danh sách bên cạnh (tên, nhóm, mã đơn/lô, cập nhật X phút trước, link chỉ đường), bộ lọc Tất cả/TNV/Người mua; marker màu theo nhóm; mờ khi > 5 phút; poll 20 giây khi tab hiển thị và đang ở trang này.
- `HANDOFF.md`: cấu hình SMTP miễn phí cho Supabase, chạy migration 039, cảnh báo hạn mức Netlify và nơi chỉnh `SEND_INTERVAL_MS`/`SEND_DISTANCE_M`.

- [ ] **Step 1:** Test: admin (API stub) mở trang tracking → có 2 marker + 2 dòng danh sách; lọc "Người mua" còn 1; không `pageerror`.
- [ ] **Step 2:** FAIL → **Step 3:** cài đặt → **Step 4:** toàn bộ test (backend + `npx playwright test`) đạt.
