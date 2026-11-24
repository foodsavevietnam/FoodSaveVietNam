# Thiết kế: Định vị trình duyệt khi làm nhiệm vụ + đăng nhập OTP email cho tình nguyện viên

Ngày: 2026-11-22 · Trạng thái: chờ duyệt · Dự án: VC_FOOODSAVE (MIO/FoodSave)

## 1. Mục đích

- Tính tuyến đường tối ưu từ **vị trí thật** của người đang làm nhiệm vụ (không chỉ từ tọa độ cố định của cửa hàng/tổ chức).
- Cho **admin** theo dõi vị trí người dùng đang làm nhiệm vụ trên một bản đồ trong cổng quản trị.
- Tình nguyện viên (TNV) hiện **không đăng nhập được ở production** (luồng chỉ-số-điện-thoại bị cố ý tắt vì không xác minh danh tính). Muốn theo dõi TNV ở bản thật thì phải có đăng nhập có xác minh: chọn **OTP qua email**.
- Ràng buộc của người dùng: **mọi thứ phải miễn phí**.

## 2. Mục tiêu / Không làm / Thất bại dù chạy được

**Mục tiêu**
1. Khi mở web lần đầu: hiện **một hộp thông báo nhỏ một lần** xin quyền vị trí (giải thích lý do), nhớ lựa chọn, không hỏi lại.
2. Cập nhật vị trí **liên tục chỉ khi đang làm nhiệm vụ**:
   - TNV: từ lúc được giao nhiệm vụ (donation `accepted`) tới khi bàn giao xong.
   - Người mua: **tự động** từ lúc đơn đã thanh toán tới khi nhận hàng xong (`pending`/`confirmed`/`ready`, `payment_status='paid'`) — người dùng chọn 2026-11-22, kể cả khi đơn có người nhận hộ.
   - Cửa hàng, tổ chức: **không theo dõi liên tục**; chỉ lấy vị trí một lần để xác nhận/sửa tọa độ địa chỉ.
3. Admin có tab **"Bản đồ theo dõi"**: thấy mọi người đang làm nhiệm vụ, làm mới ~20 giây.
4. Tổ chức thấy vị trí TNV **của mình** khi đang làm nhiệm vụ. Cửa hàng thấy **khoảng cách/thời gian ước tính** của khách đang tới nhận đơn của cửa hàng (không thấy tọa độ chính xác).
5. Chỉ đường tối ưu: link Google Maps (miễn phí, không key) có điểm xuất phát là vị trí hiện tại, thứ tự điểm dừng tính bằng engine `src/core/routing` (`bestOrder`, `routeDirectionsLinks`).
6. TNV đăng nhập production bằng **email + mã OTP 6 số**.

**Không làm**
- Không lưu lịch sử hành trình; chỉ giữ **vị trí mới nhất**.
- Không theo dõi khi app đóng/khóa màn hình (giới hạn của trình duyệt: Geolocation chỉ chạy khi trang đang mở; không làm background tracking).
- Không dùng Google Maps JavaScript API, Socket server riêng, SMS OTP hay bất kỳ dịch vụ tính tiền nào.
- Không đổi bản đồ các trang hiện có sang Google.

**Thất bại dù chạy được**
- Gửi vị trí khi **không** có nhiệm vụ, hoặc lưu vị trí sau khi nhiệm vụ đã xong.
- Cửa hàng/tổ chức thấy được tọa độ của người không liên quan tới mình.
- Vượt mức miễn phí Netlify (125k lượt gọi function/tháng) ở lưu lượng bình thường.
- Hộp xin quyền hiện lại mỗi lần mở trang.

## 3. Ràng buộc

- Hạ tầng: Netlify Functions (serverless, không giữ kết nối) + Supabase. Dự án đã cập nhật dữ liệu bằng polling, không Socket ở production.
- Bản đồ: Leaflet + OpenStreetMap qua `public/frontend/foodsave-map.js` (đã có, miễn phí). Chỉ đường: deep link Google/Apple Maps từ `src/core/routing/links.ts`.
- Geolocation cần HTTPS (Netlify đã có) và người dùng cấp quyền.
- Nghị định 13/2023: vị trí cá nhân là dữ liệu nhạy cảm → cần đồng ý rõ ràng, đúng mục đích, có bằng chứng đồng ý, xóa khi hết mục đích. Cập nhật `public/chinh-sach.html` một đoạn ngắn.
- Supabase admin client bỏ qua RLS → mọi kiểm tra quyền làm trong code (bài học từ đợt sửa IDOR: hàm list phải mặc định từ chối role ngoài danh sách).
- Test offline trong `scripts/` theo kiểu `test-order-flow.js` (FakeDb) và Playwright trong `tests/e2e/`.

## 4. Các cách đã cân nhắc

| Cách | Đánh đổi | Kết quả |
|---|---|---|
| **REST + polling** (chọn) | Hợp hạ tầng Netlify, đúng cách dự án đang làm; tốn lượt gọi function nên phải giãn nhịp | **Chọn** (quyết định của Claude, người dùng giao phần kỹ thuật) |
| Supabase Realtime broadcast | Gần thời gian thực, không tốn lượt Netlify; nhưng TNV không có phiên Supabase, phải cấu hình phân quyền kênh phức tạp | Loại |
| Socket.io server riêng | Cần server chạy liên tục → không miễn phí | Loại |
| Google Maps JS API cho bản đồ | Cần key + tài khoản thanh toán | Loại (trái ràng buộc miễn phí); dùng Google Maps qua **link** thay thế |

Đăng nhập TNV (người dùng chọn **A**):
- **A. OTP email** (chọn): bảng `volunteers` đã bắt buộc `email`; hệ thống đã gửi OTP email qua `supabaseAuth.auth.signInWithOtp` cho luồng Google.
- B. Link mời do tổ chức tạo: không cần email nhưng mỗi lần đăng nhập phải nhờ tổ chức. Không chọn.
- C. SMS OTP: tốn tiền. Loại.

## 5. Thiết kế

### 5.1 Dữ liệu (migration mới `database/User/039_live_location.sql`)

- `live_locations` — **một dòng / người**:
  `actor_kind text check in ('volunteer','customer')`, `actor_id uuid`, `context_kind text check in ('donation','order')`, `context_id uuid`, `lat double precision`, `lng double precision`, `accuracy_m real`, `recorded_at timestamptz` (thời điểm trên thiết bị), `updated_at timestamptz default now()`. Khóa chính `(actor_kind, actor_id)`. Ràng buộc lat/lng hợp lệ.
- `location_consents` — bằng chứng đồng ý: `actor_kind`, `actor_id`, `granted boolean`, `policy_version text`, `decided_at timestamptz`, `user_agent text`. Khóa chính `(actor_kind, actor_id)`; đổi ý thì cập nhật dòng.
- `auth_otp_attempts` — chống dò mã OTP TNV: `key text primary key` (email đã chuẩn hóa), `failed_count int`, `window_started_at timestamptz`, `locked_until timestamptz`.
- RLS bật, không policy cho anon/authenticated (chỉ backend dùng service role đọc/ghi).

### 5.2 API (Express, mount trong `src/routes/index.ts`)

Xác thực "người gửi vị trí": middleware mới `locationActor` giống `pushActor` — nhận token TNV (HMAC) **hoặc** phiên Supabase role `customer`; role khác → 403.

- `POST /location/consent` `{ granted, policy_version }` → upsert `location_consents`.
- `POST /location` `{ lat, lng, accuracy_m, recorded_at, context: { kind, id } }`:
  - Bắt buộc đã có `location_consents.granted = true`.
  - Kiểm tra **nhiệm vụ đang hoạt động** thuộc đúng người gửi:
    - TNV + `donation`: có `donation_assignments` (hoặc `assigned_volunteer_id`) của TNV này cho donation, donation ở trạng thái đang chạy (`accepted`, `in_route`, `picked_up` và trạng thái giao/phân phát chưa xong — builder lấy danh sách trạng thái thực từ `donationService`/`teamService`), và assignment chưa `done_at`.
    - Người mua + `order`: `orders.customer_id = actor`, `payment_status = 'paid'`, `status in ('pending','confirmed','ready')`.
  - Không hợp lệ → **409 `NO_ACTIVE_TASK`** và xóa dòng `live_locations` của người đó (client dừng theo dõi khi nhận 409).
  - Hợp lệ → upsert `live_locations`. Nếu lần ghi trước < 55 giây → bỏ qua, trả 200 `{ throttled: true }`.
- `DELETE /location` → xóa vị trí của chính mình (nút "Dừng chia sẻ").
- `GET /admin/live-locations` (admin): danh sách người đang chia sẻ: tên, nhóm, nhiệm vụ (mã đơn/mã lô), tọa độ, độ chính xác, `updated_at`, điểm đến (tọa độ cửa hàng/tổ chức), link chỉ đường. Lọc theo nhóm. Bỏ dòng cũ hơn 30 phút.
- `GET /charity/volunteers/live` (charity): chỉ TNV thuộc `charity_id` của người gọi.
- `GET /partner/orders/:id/customer-eta` (partner, đơn của cửa hàng mình): trả `distance_km`, `eta_minutes`, `updated_at` — **không trả tọa độ**.
- Dọn dẹp: khi đơn hoàn tất/hủy/vắng mặt hoặc TNV hoàn tất bàn giao → xóa `live_locations` tương ứng (gọi trong service chuyển trạng thái). Tác vụ `order-automation` (5 phút) xóa thêm dòng cũ hơn 2 giờ.

### 5.3 Đăng nhập TNV bằng OTP email

- `POST /volunteer/otp/request { email }` → luôn trả cùng một thông báo ("Nếu email đã được tổ chức đăng ký, mã sẽ được gửi") để không lộ email nào tồn tại. Chỉ gửi khi có TNV với email đó và `status != 'inactive'`. Gửi bằng `supabaseAuth.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`.
- *(Quyết định của Claude)* `signInWithOtp` gửi kèm `options.data.account_type = 'volunteer'`. Migration 039 sửa trigger `handle_new_user` (định nghĩa mới nhất trong `database/Admin/014_admin_login_security.sql` / `database/Charity/010_admin_charity_onboarding.sql`) để **bỏ qua tạo `profiles`/`customer_profiles`** khi `account_type = 'volunteer'`. Auth user của TNV vì vậy không có profile → `authMiddleware` từ chối → không thành tài khoản người mua. Email trùng tài khoản partner/charity/customer đã có: không tạo gì mới; OTP chỉ chứng minh sở hữu email; phiên Supabase sinh ra khi verify bị thu hồi ngay (`admin.signOut`), backend chỉ trả token TNV.
- `POST /volunteer/otp/verify { email, code }` → kiểm tra khóa trong `auth_otp_attempts` (tối đa **5 lần sai / 15 phút** mỗi email, sau đó khóa 15 phút) → `supabaseAuth.auth.verifyOtp({ email, token: code, type: 'email' })` → tra TNV theo email → cấp token TNV.
- *(Quyết định của Claude)* Email trùng nhiều dòng `volunteers` (cùng người làm TNV cho nhiều tổ chức; bảng không có unique email): sau khi verify đúng, nếu có nhiều dòng `status != 'inactive'` thì trả danh sách tổ chức kèm một `selection_token` ngắn hạn (5 phút, HMAC); `POST /volunteer/otp/select { selection_token, volunteer_id }` cấp token cho dòng được chọn. Một dòng → cấp token luôn. Không thêm unique index (tránh migration lỗi trên dữ liệu đang có).
- Token TNV thêm claim `amr: 'otp' | 'demo'`:
  - `volunteerAuth` và `pushActor`/`locationActor` **chấp nhận token `otp` ở production**; token `demo` (từ đăng nhập số điện thoại) vẫn chỉ chạy khi `DEMO_MODE` và không phải production — giữ nguyên hành vi hiện tại.
  - `volunteerAuth` kiểm tra lại `volunteers.status != 'inactive'` mỗi request (một truy vấn nhỏ) để khóa được TNV ngay.
- Token cũ không có `amr` coi như `demo`.
- `FOODSAVE_VOLUNTEER.html`: màn đăng nhập thêm luồng email → mã 6 số; khi `demo_mode` thì vẫn hiện thêm đăng nhập số điện thoại như cũ.
- **Điều kiện vận hành**: Supabase mặc định chỉ gửi rất ít email/giờ. Bản thật cần cấu hình SMTP riêng miễn phí trong Supabase (ví dụ Gmail SMTP hoặc gói miễn phí của Brevo/Resend). Đây là việc cấu hình của người dùng, ghi vào `HANDOFF.md`.

### 5.4 Client dùng chung: `public/frontend/foodsave-location.js`

- `FoodSaveLocation.init({ apiBase, getAuthHeader })` gọi khi trang tải.
- **Hộp xin quyền một lần**: thẻ nhỏ góc dưới, nội dung: MIO dùng vị trí khi bạn đang làm nhiệm vụ (lấy/giao hàng, đi nhận đơn) để chỉ đường tối ưu; chỉ chia sẻ trong lúc làm nhiệm vụ và xóa khi xong. Nút **Cho phép** / **Để sau**. Lựa chọn lưu `localStorage['mio.location.consent.v1']` (bọc try/catch); không hiện lại dù chọn gì. Nếu trình duyệt đã có quyền `granted`/`denied` (Permissions API) thì không hiện hộp.
  - **Cho phép** → gọi `getCurrentPosition` để trình duyệt hiện hộp quyền thật → nếu đã đăng nhập, `POST /location/consent`.
  - Đăng nhập sau khi đã chọn → gửi consent lúc đó.
  - Trang hồ sơ có công tắc "Chia sẻ vị trí khi làm nhiệm vụ" để đổi ý.
- `FoodSaveLocation.startTask({ kind, id })` / `stopTask()`: trang gọi khi có/hết nhiệm vụ đang hoạt động. Dùng `watchPosition` (enableHighAccuracy), gửi khi **di chuyển ≥ 300 m hoặc đã ≥ 120 giây**, không bao giờ dưới 60 giây. Nhận 409 → dừng. Tab ẩn → vẫn theo dõi (trình duyệt có thể tạm dừng); trang đóng → dừng.
- `FoodSaveLocation.current()` trả vị trí gần nhất cho việc tính tuyến/chỉ đường.

### 5.5 Các trang

| Trang | Thay đổi |
|---|---|
| `FOODSAVE_USER.html`, `FOODSAVE_APP.html` (người mua) | Nạp `foodsave-location.js`; hộp xin quyền; `startTask` khi có đơn đã thanh toán chưa nhận; nút "Chỉ đường tới cửa hàng" (link Google Maps, origin = vị trí hiện tại) |
| `FOODSAVE_VOLUNTEER.html` | Đăng nhập OTP email; hộp xin quyền; `startTask` theo nhiệm vụ đang chạy; "Chỉ đường" dùng thứ tự điểm dừng tối ưu từ vị trí hiện tại |
| `FOODSAVE_PARTNER.html` | Hộp xin quyền; nút "Dùng vị trí hiện tại" để xác nhận tọa độ cửa hàng (một lần); chi tiết đơn hiện "Khách cách ~X km · cập nhật Y phút trước" |
| `FOODSAVE_CHARITY.html` | Hộp xin quyền; "Dùng vị trí hiện tại" cho tọa độ tổ chức; bản đồ nhỏ TNV của tổ chức đang làm nhiệm vụ |
| `ADMIN_FOODSAVE.html` (trang `/quan-tri`) | Tab mới "Bản đồ theo dõi": bản đồ Leaflet, chấm màu theo nhóm (TNV/người mua), danh sách bên cạnh, lọc theo nhóm, chấm mờ nếu cập nhật > 5 phút; làm mới 20 giây khi tab hiển thị (`document.visibilityState`) |

### 5.6 Tuyến đường tối ưu

- Backend: `GET /volunteer/tasks` trả thêm `route` cho nhiệm vụ đang chạy khi có `live_locations` của TNV: điểm dừng sắp xếp bằng `bestOrder` với điểm xuất phát = vị trí hiện tại, kèm `routeDirectionsLinks` (Google + Apple). Không có vị trí → giữ hành vi cũ.
- Người mua: link chỉ đường tạo phía client (origin = `FoodSaveLocation.current()`, destination = tọa độ cửa hàng).

### 5.7 Hạn mức miễn phí

- Nhịp gửi 120 giây/300 m, tối thiểu 60 giây (người dùng đồng ý 2026-11-22); admin/charity poll 20 giây chỉ khi tab hiển thị. Ước tính: 100 nhiệm vụ/ngày × 45 phút × 0,5 lượt/phút ≈ 68k lượt/tháng, cộng lượt poll và API hiện có. Người mua theo dõi từ lúc thanh toán nên thời gian theo dõi dài hơn 45 phút → con số thực có thể cao hơn; theo dõi số lượt trên Netlify sau khi chạy. Nhịp gửi đặt bằng hằng số ở client (`SEND_INTERVAL_MS`, `SEND_DISTANCE_M`) để chỉnh nhanh; ghi cảnh báo này trong `HANDOFF.md`.

## 6. Kiểm thử và tiêu chí nghiệm thu

1. `scripts/test-live-location.js` (offline, FakeDb), mỗi mục một kịch bản:
   - Không có consent → 403; consent xong → ghi được.
   - TNV gửi cho nhiệm vụ không phải của mình / đã xong → 409 và dòng bị xóa.
   - Người mua gửi cho đơn chưa thanh toán / đã hoàn tất / của người khác → 409.
   - Gửi dày < 55 giây → throttled, không ghi.
   - Đơn hoàn tất / bàn giao xong → dòng vị trí bị xóa; dọn dòng > 2 giờ.
   - `GET /admin/live-locations` chỉ admin; charity chỉ thấy TNV của mình; partner chỉ nhận ETA, không có `lat`/`lng`, và chỉ cho đơn của cửa hàng mình.
   - OTP TNV: email không tồn tại trả cùng thông báo; sai 5 lần → khóa; đúng → token `amr: 'otp'` dùng được khi `NODE_ENV=production`; token `demo` vẫn bị chặn ở production; TNV `inactive` bị chặn.
2. Playwright (`tests/e2e/`): hộp xin quyền hiện một lần (tải lại không hiện), dùng `context.grantPermissions(['geolocation'])` + `setGeolocation`; admin mở được tab "Bản đồ theo dõi" không lỗi.
3. Toàn bộ `npm test`, `test-order-policy.js`, `test-order-flow.js`, Playwright hiện có vẫn đạt.

## 7. Để builder tự quyết

- Tên file/hàm cụ thể, cấu trúc service (`locationService.ts`), schema Zod chi tiết.
- Giao diện cụ thể của hộp xin quyền và tab admin, miễn theo phong cách hiện có của từng trang.
- Danh sách trạng thái donation "đang chạy" chính xác (lấy từ code hiện tại).
- `ADMIN_FOODSAVE_v2.html`/`FOODSAVE_PARTNER_v2.html`: chỉ cập nhật nếu đang được dùng (kiểm tra `netlify.toml`, link nội bộ); nếu không, bỏ qua.

## 8. Việc người dùng phải làm (ngoài code)

- Cấu hình SMTP miễn phí trong Supabase để OTP email TNV gửi được ở bản thật.
- Chạy migration `039_live_location.sql` trên Supabase.
