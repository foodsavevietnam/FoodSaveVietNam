# Hướng dẫn cổng quản trị mới /admin (Đợt 0-1)

> Bàn giao ngày 23/11/2026. Cổng dùng dự án Supabase của repo này (`idhpydhlgnxjjtyrgfkj`), cùng khóa với `public/ADMIN_FOODSAVE.html`.


Đặc tả: `docs/superpowers/specs/2026-11-23-admin-portal-design.md`. Cổng mới chạy song song với trang cũ `ADMIN_FOODSAVE.html`, thay dần từng màn. **Đợt này không có SQL mới, bạn không phải chạy gì trên Supabase.**

**Cách mở**
- Bản thật: `/admin/` (Netlify).
- Trên máy bạn: chạy `node scripts/dev.mjs --api-origin http://127.0.0.1:8080`, rồi mở `http://127.0.0.1:5500/admin/`.
- Thêm `?demo=1` vào đường dẫn để xem dữ liệu mẫu (không gọi API). Thêm `?demo=0` để thoát.
- Đăng nhập dùng chung phiên với `/quan-tri`: đã đăng nhập bên này thì bên kia không hỏi lại.

**9 màn đã chạy dữ liệu thật:** Hôm nay, Nhật ký, Khiếu nại, Duyệt hồ sơ, Rút tiền & chi trả, Cảnh báo gian lận, Quy tắc & tự động, Khuyến mãi, Tác động ESG. Các mục còn lại trên menu hiện "Chưa nối API" và nút "Mở trang cũ → mục …" (nêu tên mục tương ứng ở trang cũ, ví dụ Tiền & sổ cái → mục "Tài chính · Sổ cái").

**Trang cũ tự chuyển sang trang mới** (bảng `MIGRATED` trong `public/frontend/admin-v2.js`):

| Mục ở trang cũ | Màn ở cổng mới |
|---|---|
| `hub` | Khiếu nại |
| `verification` | Duyệt hồ sơ |
| `payouts` | Rút tiền & chi trả |
| `risks` | Cảnh báo gian lận |
| `policy`, `automation` | Quy tắc & tự động |
| `vouchers` | Khuyến mãi |
| `esg` | Tác động ESG |
| `audits` | Nhật ký |

Hai mục **chưa chuyển**: `disputes` (khiếu nại cũ chưa có mã lý do, màn mới không xử lý được, nên khiếu nại cũ vẫn xử lý ở trang cũ mục Tranh chấp) và `finance` (trang cũ còn sổ cái; cổng mới chỉ có sổ cái từ Đợt 3).

**Thay đổi backend (không đổi API cũ)**
- `workStrip` (dải việc cần làm) thêm số liệu hôm nay và tách "rút tiền chờ" với "tài khoản nhận tiền chờ duyệt". Đã sửa lỗi đếm sai tên bảng (`payout_accounts` thành `store_payout_accounts`): trước đây số tài khoản chờ luôn ra 0.
- `audit-log` có bộ lọc (hành động, người làm, loại đối tượng, từ/đến ngày). Màn Nhật ký có ô chọn "Người làm" lấy từ những người có trong 100 dòng đã tải, và hiện nhãn tiếng Việt cho nhóm/đối tượng/chi tiết (Rút tiền, Tài khoản nhận tiền, Khiếu nại, Cài đặt; "Số tiền hoàn", "Mã giao dịch"…); khóa chi tiết lạ hiện nguyên ở phần "Khác".
- Quyết định rút tiền, duyệt tài khoản nhận tiền, xử lý khiếu nại và xem số tài khoản nay đều được ghi vào Nhật ký hoạt động (trước đây không ghi).
- Tách `adminSettingsService` ra khỏi `marketingService.ts` để dùng chung (chưa đổi hành vi).

**Hạn mức Netlify (đo bằng `tests/e2e/admin-portal-polling-budget.spec.mjs`, mỗi tab admin)**

| Tình huống | Số lượt gọi API |
|---|---|
| Mở cổng lần đầu ở Hôm nay | 6 lượt (hồ sơ admin, dải việc, tiền, nhãn, ESG, tác vụ tự động) |
| Mở màn Hôm nay, có thao tác 5 phút | 13 lượt (khoảng 2,6 lượt/phút; ngưỡng test là 30) |
| Tab bị ẩn 5 phút | 0 |
| Rảnh từ 15 phút trở lên | Tự dừng, hiện "tạm dừng"; 4 phút sau đó 0 lượt |
| Bấm tiếp tục sau khi dừng | 5 lượt trong 2 giây đầu (ngưỡng 6) |
| Tab hiện lại | 5 lượt trong 2 giây đầu |

Cách chạy: dải việc làm mới 60 giây, 4 ô còn lại của màn Hôm nay làm mới 120 giây. Mọi vòng lặp đều chạy qua `ctx.poll.add` trong `public/admin/core/poll.js`, không màn nào tự đặt `setInterval`.

**Lệnh kiểm tra** (kết quả chạy ngày 23/11, tất cả đạt)
- `npm run check`: đạt, 76 file.
- `npm run typecheck`: đạt.
- `npm test`: 109 đạt, 0 lỗi.
- `npm run test:order`: 8 kịch bản chính sách + 84 kịch bản quy trình đơn đạt.
- `npm run test:admin`: 17/17 kịch bản đạt.
- `npx playwright test`: 169 đạt (gồm các test `admin-portal*.spec.mjs`).

**Giới hạn còn lại cần biết**
- Khiếu nại cũ (chưa có mã lý do): cổng mới chỉ hiện nút "Mở trang cũ → mục Tranh chấp", chưa xử lý được.
- Ở trạng thái "đã duyệt" của lệnh rút tiền, nút ghi "Hủy lệnh" nhưng hộp xác nhận và thông báo vẫn dùng chữ "Từ chối".
- Rút tiền: tab Chờ duyệt / Đã duyệt / Từ chối hỏi máy chủ đúng trạng thái (`?status=…`, tối đa 100 lệnh mới nhất của trạng thái đó; đủ 100 thì hiện "100+"). Tab Đang chi / Đã chi / Chi thất bại tải 100 lệnh mới nhất mọi trạng thái rồi lọc trên máy (API chưa lọc được 3 trạng thái này), nên lệnh cũ hơn không hiện và màn ghi rõ "Chỉ tính trong 100 lệnh rút mới nhất". Số lượng chỉ hiện ở tab đang mở; các tab khác không hiện số vì không có nguồn đếm chính xác.
- Bấm gửi lặp lại cùng một quyết định rút tiền vẫn ghi thêm một dòng Nhật ký (kết quả tiền không bị nhân đôi).
- Nếu một file JavaScript của cổng tải lỗi, nút Đăng nhập giữ trạng thái tắt (form không gửi mật khẩu đi đâu); cần tải lại trang.
- Màn hẹp (≤ 1000px) thanh bên thu nhỏ nhưng vẫn giữ chữ; điện thoại (≤ 640px) thanh bên thành dải ngang cuộn được ở đầu trang.
- Mã trạng thái lạ do máy chủ thêm sau này (ví dụ ở Khuyến mãi) có thể hiện mã thô thay vì chữ tiếng Việt.

**Việc tiếp theo:** Đợt 2-4 theo `docs/superpowers/specs/2026-11-23-admin-portal-design.md` mục 6. Đợt 2 cần chạy SQL 040 (sẽ có file riêng khi làm, bạn chỉ chạy khi được báo).
