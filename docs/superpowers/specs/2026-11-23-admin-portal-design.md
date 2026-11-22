# Thiết kế: Admin portal MIO/FoodSave quản lý toàn bộ tính năng người dùng

Brief v2 (2026-11-23). Kế hoạch thực thi Đợt 0-1: `docs/superpowers/plans/2026-11-23-admin-portal-dot-0-1.md`. Đợt 2-4: plan riêng khi tới lượt.

## 0. Thay đổi so với v1 (do mã nguồn đổi sau 2 commit `4e619bc`, `3ce8771`)

| Thay đổi trong repo | Ảnh hưởng plan |
|---|---|
| `database/User/039_live_location.sql` đã dùng số 039 (bảng `live_locations`, `location_consents`, thay `handle_new_user`) | SQL mới của plan đổi thành **040** (`040_admin_portal.sql`) và **041** (`041_admin_dashboard_rpc.sql`) |
| `database/User/038_api_write_hardening.sql`: thu hồi INSERT/UPDATE/DELETE `orders`, `order_items` với anon/authenticated; trigger bảo vệ trạng thái duyệt charity | Đúng hướng "chỉ qua API"; admin portal mới không bị ảnh hưởng vì backend dùng service role |
| Admin cũ thêm mục **"Bản đồ theo dõi"** (`data-p="tracking"`, `pg.tracking`, `GET /admin/live-locations`, Leaflet qua `frontend/foodsave-map.js`), hằng `TRK_POLL_MS=20000`, `TRK_IDLE_MS=15 phút`, `TRK_TIMEOUT_MS=15s`, tạm dừng khi rảnh | Thanh bên mới có **19 mục**: thêm `tracking` vào nhóm HOẠT ĐỘNG; di trú giữ nguyên nhịp poll/idle |
| HANDOFF 22/11 §3, §6, §7: hạn mức Netlify 125.000 lượt gọi/tháng; mọi vòng poll phải dừng khi tab ẩn / rảnh 15 phút; có test `tests/e2e/portal-polling-budget.spec.mjs` | Ràng buộc mới cho cổng admin: một lịch poll chung, dừng khi tab ẩn, dừng sau 15 phút rảnh, đo bằng Playwright |
| `src/schemas/commonSchemas.ts` đã có `paginationQuerySchema`, `optionalPaginationQuerySchema`, `queryBooleanSchema` | Dùng lại, không tự viết schema phân trang mới |
| `scripts/fake-supabase.js` đã có `ilike()` | Chỉ cần thêm `range()` offset thật (hiện chỉ set limit) và stub `auth.admin.*` |
| `tests/e2e/admin-tracking.spec.mjs` có sẵn mẫu stub Supabase (`page.route('**/@supabase/supabase-js**')`) và API cho trang admin; Playwright chạy dev-server cổng 5517; alias `/quan-tri` → `ADMIN_FOODSAVE.html` | Tách `FAKE_SUPABASE` thành `tests/e2e/helpers/fake-supabase.mjs` dùng chung; test cũ trên `/quan-tri` phải xanh tới khi gỡ trang cũ |
| `public/sw.js` `CACHE_VERSION = "mio-v3"` | Khi thêm `/admin/` → bỏ qua cache và lên `mio-v4` |
| Chế độ demo cổng cửa hàng/tổ chức nay chỉ bật bằng `?demo=1` (sessionStorage) | Cổng admin mới làm giống: `?demo=1` nạp lười lớp `demo/`, nhớ theo tab |
| Working tree sạch (chỉ 2 thư mục chưa theo dõi `Claude outputs/`, `_backup_mobile_fix_20261122/`) | Làm trên nhánh mới từ `sua-loi-api` |

## 1. Bối cảnh

- Dự án tại `D:\MIO\VC_FOOODSAVE` (nhánh `sua-loi-api`, HEAD `3ce8771`). Nền tảng giải cứu thực phẩm cận hạn, 4 vai trò: người mua (`FOODSAVE_USER.html`, PWA `FOODSAVE_APP.html`), cửa hàng (`FOODSAVE_PARTNER.html`), tổ chức (`FOODSAVE_CHARITY.html`), tình nguyện viên (`FOODSAVE_VOLUNTEER.html`). Backend Express + TS `src/`, API `/api/v1`, Supabase Postgres; migration SQL đánh số, **kế tiếp 040**, chủ dự án tự chạy.
- Admin hiện tại: `public/ADMIN_FOODSAVE.html` (~2300 dòng, một file) + lớp đè `public/frontend/admin-v2.js` (712 dòng). 23 mục thanh bên, trùng lặp (Tranh chấp/Trung tâm khiếu nại; Người dùng/Người dùng hệ thống; Thanh toán/Tài chính/Chi trả), số "40" ghi cứng.
  - Đã nối API thật: dashboard work strip, chính sách, tự động hóa, tài chính/sổ cái/rút tiền/tài khoản nhận tiền, khiếu nại, uy tín, nhãn, xác minh, voucher, ESG, gian lận, nhật ký, AI Agent, duyệt cửa hàng/tổ chức, `GET /admin/users`, **bản đồ theo dõi** (`GET /admin/live-locations`).
  - Còn dữ liệu mẫu: Người dùng, Quản trị viên, Lô tồn kho, Lô tặng, Đơn hàng, Thanh toán, Chi trả, Cấu hình.
  - Thiếu hẳn: tình nguyện viên, sản phẩm toàn sàn, gửi thông báo, đánh giá, liên hệ hỗ trợ, khóa/mở tài khoản, tạm ngưng cửa hàng, thêm admin qua UI, tìm kiếm toàn cục.
  - Trang cũ đọc thẳng Supabase từ trình duyệt (`ADMIN_FOODSAVE.html`: orders, partner_profiles, charity_profiles, profiles, products, donations, stores), trái nguyên tắc "frontend chỉ gọi Backend API" (`HANDOFF.md` §2).
- Đặc tả đã duyệt: `docs/YEU_CAU_QUY_TRINH_DON_HANG_PWA.md` §14.4; bản tham chiếu `public/ADMIN_FOODSAVE_v2.html`; thiết kế định vị `docs/superpowers/specs/2026-11-22-live-location-design.md`.

## 2. Quyết định đã chốt với người dùng

1. **Cách xây:** tách module mới `public/admin/` (vanilla JS, ES modules, mỗi màn một file, không framework, không build step), dùng lại đăng nhập Supabase (cùng `storageKey 'foodsave-admin-auth'`) + API `/admin`. Nối dần màn thật; `ADMIN_FOODSAVE.html` chạy song song tới khi thay xong.
2. **Admin toàn quyền**, không phân quyền chi tiết. Màn Quản trị viên: liệt kê, thêm, khóa, thu quyền.
3. Kế thừa: UI/log/tài liệu tiếng Việt; không đọc/ghi DB từ trình duyệt; mọi hành động admin ghi `admin_audit_log` sau khi thao tác chính thành công; SQL mới có ghi chú hoàn tác; không phá API cũ; không sửa `frontend/foodsave-*.css`; tiền `*_cents` = VND nguyên; giữ tên file `FOODSAVE_*`/`ADMIN_*`.
4. **Mới (từ HANDOFF 22/11):** tôn trọng hạn mức Netlify: cổng admin có một lịch poll chung, chỉ chạy khi tab hiển thị, dừng sau 15 phút rảnh và hiện "Bấm để tiếp tục cập nhật"; mỗi request tối đa 15 giây.

**Mục tiêu đo được:** admin quản lý mọi tính năng của 4 vai trò từ một cổng; mọi số trên giao diện là số thật từ API; mọi hành động có xác nhận + lý do + nhật ký; không còn mã trạng thái thô (`no_show`, `in_review`, "cents") hiện ra; ngân sách gọi API của tab admin đang thao tác ≤ 6 lượt/phút (ngoài màn bản đồ 3 lượt/phút), rảnh 15 phút = 0.

**Không làm:** phân quyền trong nhóm admin; tiền thật; gian lận theo thiết bị/thẻ; admin gửi tin vào chat; sửa tay sổ cái/số dư; đăng Facebook thay cửa hàng; biểu đồ/BI; thư viện UI mới; TypeScript frontend; hiện mã nhận hàng 6 ký tự cho admin trước khi bàn giao; Socket/Realtime cho admin (giữ polling).

## 3. Kiến trúc thông tin: thanh bên 6 nhóm, 19 mục

Đặt tên theo "việc admin làm", sắp theo tần suất dùng trong ngày. Huy hiệu số chỉ render khi API trả > 0.

| # | Route `#/…` | Tên | Mục đích | Gộp từ | Huy hiệu | Ưu tiên |
|---|---|---|---|---|---|---|
| **HÔM NAY** |||||||
| 1 | `today` | Hôm nay | Hàng đợi việc theo mức khẩn Đỏ/Vàng/Xám; 3 ô số (tiền giữ, hôm nay, tháng này); hàng theo nhãn | Bảng điều khiển | tổng `dashboard/work` | P0 |
| **CẦN QUYẾT ĐỊNH** |||||||
| 2 | `complaints` | Khiếu nại | 3 cột chờ cửa hàng / chờ admin / đã xong; hồ sơ có ảnh + chat chỉ đọc + form quyết định | Trung tâm khiếu nại + Tranh chấp | `complaints_waiting_admin` | P0 |
| 3 | `verify` | Duyệt hồ sơ | Cửa hàng, tổ chức, tài khoản nhận tiền chờ xác minh | Xác minh + pending-partners + payout-accounts | `verification_pending` + TK chờ | P0 |
| 4 | `payouts` | Rút tiền & chi trả | Lệnh rút: duyệt / từ chối / bắt đầu chi / đã chi (mã GD) / lỗi; hiện số TK có nhật ký | Chi trả + rút tiền trong Tài chính + Thanh toán | lệnh rút `requested` | P0 |
| 5 | `alerts` | Cảnh báo gian lận | 4 loại cảnh báo tự tính, Xử lý / Bỏ qua, link sang hồ sơ | Cảnh báo gian lận | `fraud_open` | P1 |
| **HỒ SƠ** |||||||
| 6 | `customers` | Người mua | Danh sách + hồ sơ 360° (đơn, uy tín, khiếu nại, cảnh báo, lịch sử); khóa/mở tài khoản; mở khóa nhãn đỏ | Người dùng + Người dùng hệ thống + Uy tín | – | P0 |
| 7 | `stores` | Cửa hàng | Danh sách + hồ sơ 360° (giấy tờ, sản phẩm, đơn, ví, khiếu nại, lô tặng, uy tín); tạm ngưng/mở bán | Cửa hàng | – | P0 |
| 8 | `charities` | Tổ chức & tình nguyện viên | Hồ sơ 360° tổ chức, TNV mọi tổ chức, lô đã nhận, nhu cầu ghép đơn; tạm ngưng; vô hiệu TNV | Tổ chức (+ TNV mới) | – | P1 |
| **HOẠT ĐỘNG** |||||||
| 9 | `orders` | Đơn hàng | Tra cứu mọi đơn; drawer: tiến trình + hạn, món, tiền/sổ cái, chat chỉ đọc, khiếu nại, lịch sử; hủy & hoàn, vắng mặt, hoàn tất thay, ghi chú | Đơn hàng + Thanh toán (thu) | – | P0 |
| 10 | `donations` | Lô tặng & ghép đơn | Lô tặng 8 bước, TNV được phân, ảnh GPS, báo cáo; tab Nhu cầu; hủy lô | Lô tặng (+ ghép đơn mới) | – | P1 |
| 11 | `tracking` | Bản đồ theo dõi | TNV (xanh) và người mua (cam) đang làm nhiệm vụ trên bản đồ Leaflet; lọc theo loại; mờ khi > 5 phút; link chỉ đường | Bản đồ theo dõi (mới 22/11) | – | P1 |
| 12 | `inventory` | Hàng đang bán | Lô theo nhãn, sắp hết hạn, ẩn/bỏ ẩn sản phẩm vi phạm | Lô tồn kho + Quản lý nhãn | – | P1 |
| 13 | `ledger` | Tiền & sổ cái | Escrow / doanh thu / quỹ từ thiện, sổ cái lọc, đối soát, sự kiện thanh toán | Tài chính · Sổ cái (bỏ rút tiền) | lệch sổ cái > 0 | P1 |
| **TĂNG TRƯỞNG** |||||||
| 14 | `vouchers` | Khuyến mãi | Voucher toàn sàn và cửa hàng; tạo / bật / tắt | Voucher | – | P1 |
| 15 | `marketing` | Đăng bài tự động | AI Agent: tổng quan, hàng chờ, lịch sử, thiết lập; bài của cửa hàng (xem) | AI Agent | bài chờ | P2 |
| 16 | `esg` | Tác động ESG | kg cứu, CO₂, suất ăn theo tháng, top cửa hàng | Báo cáo ESG | – | P2 |
| **HỆ THỐNG** |||||||
| 17 | `rules` | Quy tắc & tự động | Tab Quy tắc (hạn theo nhãn, uy tín, khóa nhãn đỏ) + Tab Tự động (4 tác vụ, lần chạy, Chạy ngay) | Chính sách + Tự động hóa | tác vụ lỗi | P1 |
| 18 | `audit` | Nhật ký | Ai làm gì, lọc theo hành động/người/đối tượng | Nhật ký hoạt động | – | P1 |
| 19 | `settings` | Cài đặt | Tab Quản trị viên, Thông báo, Hỗ trợ (liên hệ, đơn đăng ký), Hệ thống (app_settings), Đánh giá | Cấu hình + Quản trị viên | – | P2 |

**Mẫu màn chuẩn:** tiêu đề + chú thích "?" (đọc giá trị từ `GET /admin/order-policy`) → tab lọc nhanh + ô tìm → bảng 5-7 cột → drawer phải 480px (tóm tắt → tiến trình → dữ liệu → lịch sử → hành động) → hộp xác nhận (hậu quả 1 câu + lý do bắt buộc ≥ 3 ký tự khi từ chối/bác bỏ/khóa/ẩn) → toast + bảng tải lại + huy hiệu cập nhật. Hành động chưa có API thì không hiện nút. Tìm kiếm toàn cục (phím `/`): mã đơn / SĐT / email / tên cửa hàng / tổ chức / mã khiếu nại → hồ sơ 360° trong ≤ 2 bấm. Bảng từ vựng trạng thái → chữ Việt + màu trong `core/vi.js`.

## 4. Kiến trúc frontend `public/admin/`

```
public/admin/
  index.html              shell: title "MIO — Quản trị", script đầu frontend/foodsave-config.js, favicon /icons/icon-192.png,
                          1 stylesheet /frontend/mio-brand.css, logo /icons/mio-logo-square.png (thỏa tests/project-integrity),
                          supabase-js@2.112.0 ghim phiên bản, <script type="module" src="./core/app.js?v=YYYYMMDDx">
  styles/admin.css        token màu/typo từ :root của ADMIN_FOODSAVE.html + lớp .b/.K/.P/.W/.bt + admin-v2.css (gộp 1 file)
  core/app.js             bootstrap: ?demo=1 (nhớ sessionStorage 'mio.demo.admin') → import('../demo/index.js') lười; ctx; auth gate; shell; router
  core/config.js          apiBase = window.FOODSAVE_API_BASE (cùng origin), cho phép <meta name="foodsave-api-base">
  core/auth.js            DUY NHẤT file chứa 'supabase': storageKey 'foodsave-admin-auth'; signIn/signOut/getToken/onChange;
                          ensureAdmin() qua GET /profile/me (role==='admin' && status!=='suspended'); 401 → refreshSession 1 lần → khóa, giữ hash
  core/api.js             createApi({fetch,getToken,baseUrl,onUnauthorized,timeoutMs:15000}) → get/post/patch/put/del; ApiError{code,status,details}
  core/router.js          hash router '#/orders?page=2' → {screen,params}; thuần, test được
  core/poll.js            lịch poll chung (mẫu FS.poll của foodsave-live-data.js): chạy khi tab hiển thị, dừng sau 15 phút rảnh,
                          hiện "Bấm để tiếp tục cập nhật", khoảng cách tối thiểu 10 giây khi tab hiện lại
  core/state.js           admin, work (GET /admin/dashboard/work qua poll 60 giây + sau mỗi hành động), demo flag
  core/ui.js              html`` tự escape + raw(); toast; confirm/prompt (Promise, ô lý do); drawer; delegate(); loading/empty/error(retry)
  core/table.js           dataTable({columns,rows,sort,filter,page})
  core/format.js          vnd, dt, stamp, maskPhone
  core/vi.js              từ vựng trạng thái/màu
  core/shell.js           thanh bên 6 nhóm từ manifest, header + breadcrumb + tìm kiếm + chuông (audit-log 20) + user box; responsive
  screens/manifest.js     [{id,title,group,order,badge(work),load:()=>import('./x.js')}] cho 19 màn
  screens/*.js            19 màn + _pending.js (màn "chưa nối API", không chép dữ liệu mẫu)
  screens/tracking.js     chép logic TRK_* từ ADMIN_FOODSAVE.html (poll 20s qua core/poll, stale 5 phút, timeout 15s); nạp lười
                          frontend/foodsave-map.js + foodsave-map.css + Leaflet chỉ khi vào màn này; destroy() gỡ map và timer
  demo/index.js           createDemoApi() cùng giao diện; chỉ nạp khi ?demo=1; thanh "Chế độ xem thử"
  demo/fixtures/*.js      dữ liệu mẫu theo nhóm endpoint; Playwright dùng lại làm payload mock
```

Hợp đồng screen: `export default { id, title, group, badge?(work), async render(container, ctx), destroy?() }`, `ctx = {api, ui, state, poll, params, navigate, signal, refreshWork}`. Router gọi `destroy()`, hủy `AbortController`, gỡ mọi job poll của màn, xóa container, rồi `render()`. Màn không chạm `window.*` (trừ `tracking` dùng `window.FoodSaveMap`/`window.L` qua một adapter), không `onclick=""` nội tuyến, mọi HTML qua `html``` tự escape.

Di trú từ code cũ: chép hàm vẽ từ `admin-v2.js` / `ADMIN_FOODSAVE.html` gần nguyên văn, chỉ đổi 4 thứ cơ học (`window.X=` → cục bộ; `onclick` → `data-act`; `rerender(key)` → `draw()`; `prompt/confirm` → `ctx.ui.*`); mọi `setInterval` → `ctx.poll`. Chuyển hướng dần: bảng `MIGRATED=[...]` đầu `admin-v2.js`, bọc `go(p)` → `location.href='/admin/#/'+map[p]` + dải "Cổng quản trị mới" ở header trang cũ.

Sửa kèm: `scripts/check-project.mjs` (thêm `admin/index.html` vào `HTML_FILES`, `ADMIN_MODULE_FILES`, kiểm module bằng `node --check --input-type=module`); `scripts/lib/dev-server.mjs` (`PAGE_ALIASES['/admin']='admin/index.html'`; cuối cùng `/quan-tri` → `admin/index.html`) + `tests/dev-server.test.mjs`; `public/sw.js` (bỏ `/admin/` khỏi cache, `CACHE_VERSION` → `mio-v4`); `netlify.toml` (`/admin/*` no-cache; cuối cùng đổi redirect `/quan-tri`).

Tiêu chí gỡ `ADMIN_FOODSAVE.html` + `admin-v2.js/.css`: 19 mục đều có màn thật; test "không Supabase ngoài auth.js" xanh; Playwright 19 màn + 6 drawer xanh; `admin-tracking.spec.mjs` được viết lại trỏ `/admin/#/tracking`; checklist tay ký; chạy ổn 2 chu kỳ phát hành; cập nhật `PROJECT_STRUCTURE.md`, `HANDOFF.md`, `HTML_FILES`.

## 5. Backend: API và SQL cần thêm

Quy ước: `src/schemas/adminSchemas.ts` có `adminListQuerySchema({sortKeys,statusEnum})` = `paginationQuerySchema` (có sẵn trong `commonSchemas.ts`) mở rộng `q?(≤80, làm sạch , ( ) % \)`, `status?`, `sort` whitelist, cờ bool qua `queryBooleanSchema`; trả `{items,total,page,limit}` qua `src/services/adminListing.ts` (`paginate`, `applySearch`, `loadByIds` chuyển từ `loadNames` trong `adminOpsService.ts`, `maskPhone` từ `partnerOpsService.ts`). Routes mới `src/routes/admin/*.ts` mount cuối `adminRoutes.ts` (sau `requireRoles("admin")`, không sửa endpoint cũ). Controllers `src/controllers/admin/*`, services `adminXxxService.ts`. `auditActor` chuyển ra `src/utils/requestContext.ts`. Tên audit `<đối_tượng>.<động_từ>`.

| Màn | Dùng lại (đã có) | Thêm mới | Audit |
|---|---|---|---|
| Hôm nay | `dashboard/work`, `finance/summary`, `labels`, `esg`, `automation` | tách `withdrawals_pending` thành lệnh rút / TK chờ; thêm `orders_today{new,completed,no_show}`, `donations_open`, `tracking_active` vào `workStrip` (`adminOpsService.ts:316`); `GET /admin/dashboard/overview?days=7|30` (RPC `fs_admin_overview`, fallback count) | – |
| Khiếu nại / Duyệt hồ sơ / Gian lận | `complaints`, `verification`, `payout-accounts`, `fraud-alerts` | – | có sẵn |
| Rút tiền | `withdrawals`, `reveal-account` | `?store_id&page&limit` tùy chọn (`optionalPaginationQuerySchema`), giữ shape cũ khi không có `page` | có sẵn |
| Bản đồ theo dõi | `GET /admin/live-locations?kind=` (`locationService.listForAdmin`, cửa sổ 30 phút, giới hạn LIST_LIMIT) | – | – |
| Người mua | `GET /admin/users`, `customers/:id/unlock` | `GET /admin/accounts` (role/status/sort, q ilike full_name/phone/email), `GET /admin/accounts/:id` (profile + auth + trust + thống kê đơn + partner/charity + 10 đơn + 20 auth log + đồng ý chia sẻ vị trí `location_consents` + 20 audit), `POST /admin/accounts/:id/status {active|suspended, reason}` | `account.suspend/unsuspend` |
| Cửa hàng | approve/reject, verification, payout-accounts | `GET /admin/stores`, `GET /admin/stores/:id` (store + chủ + partner_profile che CCCD/thuế, không bank_*, TK qua service, ví qua `ledgerService`, uy tín/vi phạm, tóm tắt sản phẩm, 10 đơn, khiếu nại, lô tặng, audit), `POST /admin/stores/:id/status` (suspended → catalog tự ẩn vì đã lọc `stores.status='active'` ở `catalogService.ts:138,216`; mở lại chỉ `active` khi `is_verified`), `GET /admin/stores/:id/products` | `store.suspend/unsuspend` |
| Tổ chức & TNV | verification charity, `charityService.updateVolunteer` (mở cho admin) | `GET /admin/charities(/:id)`, `POST /admin/charities/:id/status`, `GET /admin/volunteers(/:id)` (kèm `location_consents`, lần đăng nhập OTP), `POST /admin/volunteers/:id/status` | `charity.*`, `volunteer.status` |
| Đơn hàng | `orderService.updateOrderStatus(adminId,"admin",…)` (hủy → hoàn 100% qua ledger + provider + trả kho, `cancelled_by='admin'`; no_show không cần hạn); hoàn tiền đơn `completed` chỉ qua khiếu nại | `GET /admin/orders` (status/payment/settlement/store/customer/from/to/has_complaint; q = order_number hoặc SĐT), `GET /admin/orders/:id` (đơn + items + events + messages chỉ đọc + khiếu nại + reviews + ledger + payment_events + vị trí khách nếu đang theo dõi + `refund_capability`), `POST /admin/orders/:id/status {cancelled|no_show|completed, reason}` → gọi service + `order_events admin_action`; `POST /admin/orders/:id/note` | `order.cancel/no_show/complete/note`, `order.chat_view` |
| Lô tặng | `donationService.updateDonationStatus`, `/matching/needs`, `/donations/:id/photos|report` | `GET /admin/donations(/:id)` (không trả `pickup_code`; kèm vị trí TNV đang đi nếu có), `POST /admin/donations/:id/cancel` | `donation.cancel` |
| Hàng đang bán | `labels`, `labelAutomationService` | `GET /admin/products(/:id)`, `POST /admin/products/:id/visibility {hide|unhide, reason}` (hide: `is_active=false, blocked_reason="[Admin] …", admin_hidden_*`; unhide: xóa cờ + chạy lại nhãn); guard trong `catalogService.updateProduct`: partner không bật lại khi `admin_hidden_at` (409) | `product.hide/unhide` |
| Tiền & sổ cái | `finance/*`, `ledger` | `GET /admin/payments`, `GET /admin/payments/summary` | – |
| Nhật ký | `audit-log` | filter tùy chọn `action/actor_id/target_type/target_id/from/to` | – |
| Cài đặt › Quản trị viên | SQL 015 làm mẫu; `handle_new_user` (bản 039) vẫn ép role `customer` trừ metadata customer/partner/charity | `GET /admin/admins`, `POST /admin/admins {email, full_name, password≥10}` (`auth.admin.createUser` → `profiles.update role=admin` bằng service role → xóa `customer_profiles`; lỗi giữa chừng → `deleteUser`), `POST /admin/admins/grant`, `POST /admin/admins/:id/status`, `POST /admin/admins/:id/revoke`; không tự khóa mình, không để 0 admin active | `admin.*` |
| Cài đặt › Thông báo | `createNotification`, `pushService.sendToAllCustomers/sendToUser` | `POST /admin/notifications {target: role|user|users≤200, title, body, push?}`, `GET /admin/notifications`, `GET /admin/notifications/stats`; `adminNotifyLimiter` 10 req/10 phút + cooldown 1 broadcast/role/10 phút | `notification.send` |
| Cài đặt › Hỗ trợ | – | `GET/PATCH /admin/contact-messages`, `GET/PATCH /admin/applications` (payload che `bank|account|cccd|tax`) | `contact.update`, `application.update` |
| Cài đặt › Hệ thống | `getAppSetting/setAppSetting` (`marketingService.ts:247`) | tách `adminSettingsService`; `GET /admin/settings`, `PUT /admin/settings/:key` registry whitelist + Zod theo khóa | `settings.update` |
| Cài đặt › Đánh giá | `sellerReputationService.updateSellerRatingAverage` | `GET /admin/reviews`, `POST /admin/reviews/:id/visibility` | `review.hide/unhide` |
| Tìm kiếm | – | `GET /admin/search?q=` gom orders, profiles, stores, charity_profiles, complaints; ≤ 5 kết quả/nhóm | – |

Sửa nhỏ an toàn (có test): `orderService.loadCheckoutProducts` (dòng ~104) thêm `stores!inner(status)` và 409 nếu cửa hàng ≠ active (hiện chưa kiểm tra).

**SQL `database/Admin/040_admin_portal.sql`** (chạy sau 039, trước Đợt 2; chạy lại được; có hoàn tác): cột `suspended_at/suspended_reason` cho `profiles`, `stores`(+`suspended_by`), `charity_profiles`; `products.admin_hidden_at/reason/by`; `reviews.hidden_at/reason/by` + policy `reviews_public_select using (hidden_at is null or public.is_admin())`; `contact_messages`/`applications` thêm `admin_note, handled_by, handled_at`; `pg_trgm` + chỉ mục tìm kiếm/phân trang (profiles role+status+created, full_name/phone/email trgm, stores name trgm + status, orders status+created + order_number trgm, products admin_hidden/store+label, donations status, notifications type admin-%, admin_audit_log target/actor, payment_events created, contact/applications status). Không đụng `handle_new_user`. Không tạo bảng ghi chú riêng.
**SQL `database/Admin/041_admin_dashboard_rpc.sql`** (Đợt 4): hàm `fs_admin_overview(p_days)` returns jsonb, revoke anon/authenticated.

## 6. Lộ trình theo đợt (mỗi đợt: typecheck sạch, `npm run test:order` + `npm run test:e2e` không hồi quy, test đợt đạt, cập nhật HANDOFF.md)

| Đợt | Frontend | Backend / SQL | Tiêu chí nghiệm thu |
|---|---|---|---|
| **0 Nền** | `docs/superpowers/specs/2026-11-23-admin-portal-design.md` (bản thiết kế này, nếu được phép ghi vào repo); `public/admin/` shell + core (auth, api, router, poll, state, ui, table, format, vi, shell) + manifest 19 mục + `_pending`; màn `today` + `audit`; check-project, dev-server alias, sw.js `mio-v4`, netlify.toml; `tests/admin-core.test.mjs`, `tests/admin-portal.test.mjs` (cấm Supabase ngoài auth.js, cấm `onclick=`, cấm `setInterval` ngoài core/poll.js); `tests/e2e/helpers/fake-supabase.mjs` tách từ `admin-tracking.spec.mjs`; khung `tests/e2e/admin-portal.spec.mjs` + `admin-portal-polling-budget.spec.mjs` | `adminSchemas.ts` (dựa `commonSchemas`), `adminListing.ts`, `src/routes/admin/` mount, `auditActor` dùng chung, `adminSettingsService` tách; `scripts/fake-supabase.js` thêm `range` offset + stub `auth.admin`; khung `scripts/test-admin-api.js` + script `test:admin` | Đăng nhập/đăng xuất/hết phiên hoạt động; `today` số thật; không số nào trong HTML tĩnh; không lỗi console; ngân sách poll đo được (tab rảnh 15 phút = 0 lượt) |
| **1 Cần quyết định** | `complaints`, `verify`, `payouts`, `alerts`, `rules`, `vouchers`, `esg`: chuyển cơ học từ `admin-v2.js`; bật `MIGRATED` | tách `withdrawals_pending`, số hôm nay vào `workStrip`; filter `audit-log` | 100% hành động ở 4 hàng đợi tạo dòng `admin_audit_log`; lý do rỗng bị chặn; không chữ `no_show/in_review/cents` trên DOM |
| **2 Hồ sơ 360°** | `customers`, `stores`, `charities` (+ TNV), tìm kiếm toàn cục, link chéo | accounts, admins(list), stores, charities, volunteers, search; `POST …/status`; guard `loadCheckoutProducts`; **SQL 040** | Tìm kiếm tới đúng hồ sơ ≤ 2 bấm; hồ sơ người mua ≥ 8 trường thật; ngưng cửa hàng → không đặt được đơn (test) |
| **3 Hoạt động** | `orders` (drawer đầy đủ), `donations`, `tracking` (di trú TRK_*, nạp Leaflet lười, viết lại `admin-tracking.spec.mjs` cho `/admin/#/tracking`), `inventory`, `ledger` | orders, donations, products (+ guard `updateProduct`), payments, reviews | Admin hủy đơn đã trả: hoàn tiền, ledger cân, kho về, `cancelled_by='admin'`, audit có `refund_cents`; lô tặng hoàn tất hiện đủ 8 mốc + ảnh; bản đồ: 2 marker + lọc + tạm dừng khi rảnh (test cũ chuyển sang xanh) |
| **4 Tăng trưởng + Hệ thống + dọn** | `marketing` (chuyển AI Agent từ HTML), `settings` (admins, thông báo, hỗ trợ, hệ thống, đánh giá); mobile thu gọn; `ADMIN_FOODSAVE.html` chuyển hướng toàn bộ sang `/admin/`; `/quan-tri` → `/admin/`; gỡ file cũ khi đạt tiêu chí §4 | admins create/grant/status/revoke, notifications + limiter, contact/applications, settings registry, `dashboard/overview`; **SQL 041** | 19 mục chạy dữ liệu thật; Playwright 19 màn + 6 drawer xanh; HANDOFF có mục "Admin portal mới" |

## 7. Ma trận tính năng người dùng → chỗ admin quản lý

| Vai trò | Tính năng | Mục admin | Hành động |
|---|---|---|---|
| Người mua | Đăng ký/đăng nhập (email, Google, SĐT) | Người mua | xem provider/lần đăng nhập; khóa/mở |
| | Xem sản phẩm, nhãn giá | Hàng đang bán | xem theo nhãn; ẩn sản phẩm |
| | Đặt hàng, trả trước, QR, hủy | Đơn hàng, Quy tắc | xem; hủy & hoàn; vắng mặt; hoàn tất thay; chỉnh mốc hạn |
| | Uy tín, khóa nhãn đỏ | Người mua; Quy tắc | mở khóa; chỉnh ngưỡng |
| | Khiếu nại, chat | Khiếu nại; Đơn hàng › Chat | quyết định; đọc chat khi có khiếu nại |
| | Chia sẻ vị trí khi chờ nhận hàng | Bản đồ theo dõi; Đơn hàng › drawer; Người mua › Tổng quan | xem vị trí (30 phút), trạng thái đồng ý chia sẻ |
| | Voucher | Khuyến mãi | tạo/bật/tắt |
| | Thông báo, push | Cài đặt › Thông báo | gửi; thống kê |
| | Đánh giá | Cài đặt › Đánh giá | ẩn/bỏ ẩn |
| | Tác động CO₂ | Tác động ESG | xem |
| Cửa hàng | Đăng ký + giấy tờ | Duyệt hồ sơ; Cửa hàng | duyệt/từ chối |
| | Hồ sơ, bán hàng | Cửa hàng | tạm ngưng/mở |
| | Sản phẩm, nhãn | Hàng đang bán; Quy tắc & tự động | ẩn; chạy nhãn ngay |
| | Đơn, vắng mặt, "khách cách ~X km", phản hồi khiếu nại | Đơn hàng; Khiếu nại | can thiệp; quyết định |
| | Ví, TK nhận tiền, rút tiền | Rút tiền & chi trả; Tiền & sổ cái | xác minh TK; duyệt/chi; hiện số TK có nhật ký |
| | Uy tín, vi phạm | Cửa hàng | xem |
| | Tặng hàng | Lô tặng | xem, hủy lô |
| | Voucher cửa hàng | Khuyến mãi | tắt vi phạm |
| | Marketing / Fanpage | Đăng bài tự động | xem bài; AI Agent |
| Tổ chức | Đăng ký + giấy tờ | Duyệt hồ sơ; Tổ chức | duyệt/từ chối; tạm ngưng |
| | Donation inbox, ghép đơn | Lô tặng & ghép đơn | xem; hủy lô/nhu cầu |
| | Phân TNV, ảnh minh chứng, bản đồ TNV trực tiếp | Lô tặng › drawer; Bản đồ theo dõi | xem ảnh + GPS; duyệt ảnh; phân lại |
| | Người hưởng lợi, báo cáo, gallery | Tổ chức › Báo cáo | xem |
| | Thêm TNV | Tổ chức & TNV | xem mọi TNV; vô hiệu |
| TNV | Đăng nhập OTP email / SĐT, nhiệm vụ, ảnh, chia sẻ vị trí, trạng thái | Tổ chức & TNV; Lô tặng › Hành trình; Bản đồ theo dõi | xem; vô hiệu |
| Xuyên suốt | Tác vụ, chính sách, gian lận, sổ cái, admin, nhật ký | Quy tắc & tự động; Cảnh báo; Tiền & sổ cái; Cài đặt; Nhật ký | chạy ngay; sửa; xử lý; đối soát; thêm/khóa/thu quyền; lọc |

## 8. Kiểm thử và xác minh end-to-end

- Offline: `npm run typecheck`; `npm run check`; `npm test` (thêm `tests/admin-core.test.mjs`, `tests/admin-portal.test.mjs`); `npm run test:order` (không hồi quy sau khi mở rộng fake-supabase); `npm run test:admin` (`scripts/test-admin-api.js`: listing/phân trang/làm sạch q; khóa tài khoản + không tự khóa + không còn 0 admin + rollback tạo admin; ngưng cửa hàng chặn đặt đơn; ẩn sản phẩm chặn partner bật lại; admin hủy đơn hoàn tiền ledger cân; broadcast + cooldown 429; ẩn đánh giá tính lại sao; settings whitelist; dashboard fallback RPC).
- Playwright (`npm run test:e2e`, dev-server cổng 5517): `tests/e2e/admin-portal.spec.mjs` dùng `helpers/fake-supabase.mjs` + fixtures `public/admin/demo/fixtures`; mỗi màn vào `#/<id>`, chờ dữ liệu, bấm một hành động, assert body request, `pageerror`/`console.error` rỗng; test 500 thấy "Thử lại"; test 401 thấy đăng nhập và quay lại đúng hash; `admin-portal-polling-budget.spec.mjs` đo lượt gọi 5 phút (đang thao tác ≤ 30, rảnh 15 phút = 0, tab ẩn = 0) theo mẫu `portal-polling-budget.spec.mjs`. Các spec cũ (`admin-tracking`, `location-*`, `portal-*`, `ui`) phải xanh.
- Tay (chủ dự án, Supabase thật, sau SQL 040/041): `today` khớp DB; duyệt 1 hồ sơ → thông báo + nhật ký; khóa 1 tài khoản → API 403; ngưng 1 cửa hàng → sản phẩm biến mất trên `FOODSAVE_USER.html`; admin hủy 1 đơn → "Chạy đối soát ngay" KHỚP; bản đồ theo dõi hiện TNV thật đang đi lấy hàng.
- Dev local: `node scripts/dev.mjs --api-origin http://127.0.0.1:8080`, mở `http://127.0.0.1:5500/admin/`.

## 9. Rủi ro còn lại và giả định

- Hạn mức Netlify 125.000 lượt/tháng: cổng admin thêm tải; ngân sách mục 2.4 và test poll là bắt buộc, theo dõi số lượt tuần đầu.
- `ilike` cần `pg_trgm` (trong SQL 040); không tạo được extension thì vẫn chạy, chậm hơn.
- Tạo admin bằng mật khẩu nhập tay (chưa có mời email); broadcast không thu hồi; ẩn đánh giá chỉ tính lại sao khi seller reputation hoạt động.
- Số "hôm nay" theo giờ VN (+7h).
- Giữ `?demo=1` ở cổng mới (lớp `demo/` nạp lười, nhớ theo tab như cổng cửa hàng/tổ chức).
- Ghi bản thiết kế vào `docs/superpowers/specs/` cần người dùng cho phép (lần trước bị từ chối); nếu không, plan này là nguồn duy nhất.

## 10. Cách thực thi (Orchestrator)

Mỗi đợt tách task card (id, mục tiêu, input, output, tiêu chí pass, skill, model, phụ thuộc, brief_version=2), chạy song song các task độc lập (frontend màn ↔ backend endpoint ↔ SQL ↔ test), mọi output qua `task-reviewer` độc lập (PASS/FAIL có bằng chứng, tối đa 2 lần thử lại), kiểm chứng bằng chạy lệnh test thật. Skill: `superpowers:writing-plans` → `subagent-driven-development`, `test-driven-development` cho service/endpoint, `frontend-design` cho shell/admin.css, `verification-before-completion` trước mỗi báo cáo đợt.
