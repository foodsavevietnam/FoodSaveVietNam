# Cấu trúc mã nguồn MIO

## Website: `public/`

Tất cả nội dung được phục vụ công khai nằm trong `public/`. Các file HTML giữ tên ban đầu để bảo toàn điều hướng, OAuth callback, PWA start URL và logic xác định vai trò người dùng.

`public/frontend/` chứa JavaScript và CSS dùng chung. `mio-brand.css` đồng bộ cách hiển thị logo MIO. `public/icons/` chứa logo, biểu tượng cài đặt và ảnh thay thế. Khi thêm tài nguyên mới, đặt vào các thư mục này và dùng đường dẫn tương đối từ HTML.

Tên hiển thị của dự án là **MIO**. Logo mới lấy từ `logo mới.jpg` do chủ dự án cung cấp; bản gốc và icon chuẩn hoá nằm trong `public/icons/`. Giữ các định danh kỹ thuật `FOODSAVE_*`, khoá dữ liệu trình duyệt và endpoint hiện có để bảo toàn các luồng nghiệp vụ.

`foodsave-config.js` được nạp trước các script nghiệp vụ. Nó chọn API trên cùng origin hoặc sử dụng cấu hình API đã được chủ dự án cung cấp. Không gắn địa chỉ deployment cũ cố định trong từng trang.

| Vai trò | Bản chính | Ghi chú |
| --- | --- | --- |
| Trang giới thiệu | `index.html` | — |
| Người mua web | `FOODSAVE_USER.html` | — |
| Ứng dụng PWA | `FOODSAVE_APP.html` | — |
| Cửa hàng | `FOODSAVE_PARTNER.html` | Đã tích hợp module `partner-v2` và chế độ `?demo=1` |
| Tổ chức từ thiện | `FOODSAVE_CHARITY.html` | Hỗ trợ chế độ `?demo=1` |
| Tình nguyện viên | `FOODSAVE_VOLUNTEER.html` | — |
| Quản trị | `ADMIN_FOODSAVE.html` | Đã tích hợp module `admin-v2` |
| Quản trị (cổng mới) | `public/admin/` (`/admin/`) | chạy song song `ADMIN_FOODSAVE.html`, thay dần từng màn; ES modules, không bundler |

Các trang tham khảo cũ (`_v2` và `_demo`) đã được gỡ bỏ khỏi `public/` và chuyển hướng về các trang chính tương ứng (xem `netlify.toml`).

Cấu trúc `public/admin/`: `core/` chứa lõi dùng chung (đăng nhập, gọi API, router, poll, bảng, định dạng, nhãn tiếng Việt); `screens/` mỗi màn một file cùng `manifest.js` khai báo menu; `demo/` là dữ liệu mẫu cho `?demo=1`; `styles/` là CSS của cổng. Chỉ `core/auth.js` được nhắc tới Supabase; mọi vòng lặp gọi API phải qua `core/poll.js`.

Service worker và các manifest ở gốc `public/` để giữ scope `/`. Khi thay đổi tài nguyên shell, cập nhật danh sách cache và phiên bản trong `sw.js`.

## API: `src/`

Giữ cấu trúc nghiệp vụ sẵn có:

- `routes/`: định tuyến HTTP.
- `controllers/`: xử lý yêu cầu và phản hồi.
- `services/`: nghiệp vụ đơn hàng, quyên góp, thanh toán, tài khoản và vận hành.
- `schemas/`: kiểm tra dữ liệu đầu vào.
- `core/`: thuật toán ghép đơn, tuyến đường, địa lý và nhãn sản phẩm.
- `middlewares/`, `types/`, `constants/`, `utils/`: mã hỗ trợ dùng chung.

`netlify/functions/` là lớp kết nối API vào Netlify và chứa các tác vụ định kỳ. `database/` giữ các migration theo nhóm nghiệp vụ. Việc tổ chức frontend không thay đổi dữ liệu hay chạy migration.

## Công cụ và tài liệu

`scripts/dev.mjs` chạy máy chủ giao diện chỉ phục vụ `public/`. `scripts/check-project.mjs` kiểm tra tài nguyên và cú pháp mà không chạy API. `tests/` chứa kiểm thử không cần dịch vụ bên ngoài.

`scripts/` vẫn giữ các công cụ bảo trì gốc. Các công cụ sửa HTML cũ trong `ag-patch/`, `marketing-patch/` và các bản bàn giao trước đây không thuộc quy trình chạy mới; cần kiểm tra lại đường dẫn trước khi sử dụng.

`docs/` chứa đặc tả chức năng và tài liệu backend tham khảo. Mã tự động hóa `n8n/` cùng các thư mục dữ liệu được cung cấp không nằm trong phần website được publish.

## Phạm vi lần khởi tạo lại

Đã tổ chức lại frontend và tài liệu, bổ sung điểm chạy từ `MIO`, máy chủ preview, kiểm tra mã nguồn và cấu hình publish. Không có thao tác triển khai, thay đổi database hay kết nối Git remote. URL website không thay thế cho URL kho Git.
