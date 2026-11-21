# Neon Postgres + Realtime cho MIO

## Phạm vi tích hợp

Project Neon: `bold-hill-63205594`, tổ chức `org-shy-resonance-89642526`, nhánh `production`, vùng `aws-ap-southeast-1`.

Supabase tiếp tục cung cấp đăng nhập, lưu ảnh, sản phẩm, đơn hàng, quyên góp và các nghiệp vụ hiện có. Neon bổ sung bảng hoạt động cộng đồng trong schema riêng `mio` và cập nhật Realtime trên trang chủ. Không di chuyển hay nhân bản toàn bộ dữ liệu Supabase sang Neon.

Sau khi API tạo sản phẩm, đơn hàng hoặc quyên góp thành công, backend ghi một hoạt động ẩn danh vào Neon. Thông tin công khai chỉ gồm mã sự kiện ngẫu nhiên, loại sự kiện, tiêu đề cố định và thời gian; không gửi tên, giá, địa chỉ hay mã đơn hàng lên trình duyệt. Ghi nhận là best effort: mất kết nối Neon không làm giao dịch Supabase thất bại, nhưng có thể bỏ lỡ hoạt động trong feed.

## Cấu hình

`neon.ts` tại gốc workspace khai báo Realtime. `neon deploy` áp dụng cấu hình và kéo các biến Neon về `.env.local`. Không đưa tệp này vào Git hoặc thư mục `public/`.

Backend nạp cấu hình Supabase hiện có trong `VC_FOOODSAVE/.env` và cấu hình Neon trong `.env.local` tại gốc workspace. Biến đã có trong process được ưu tiên. URL Neon được tách thành `NEON_DATABASE_URL`; URL PostgreSQL Supabase cũ được giữ riêng trong `SUPABASE_DATABASE_URL` để nghiệp vụ uy tín không bị chuyển nhầm sang Neon.

Các biến Neon cần cho backend:

- `DATABASE_URL`: kết nối pooled cho lưu lượng ứng dụng; loader dùng nó làm `NEON_DATABASE_URL` khi nhận diện URL Neon.
- `DATABASE_URL_UNPOOLED`: kết nối trực tiếp để chạy migration.
- `NEON_REALTIME_URL`: URL WebSocket có thể gửi ra trình duyệt.
- `NEON_REALTIME_SECRET`: chỉ dùng trên server để seal truy vấn; không được gửi ra trình duyệt.

Neon dùng `pg` với xác minh TLS khi chạy server Node lâu dài. Trong Netlify Functions, adapter dùng `@neondatabase/serverless` qua HTTP cho các câu SQL độc lập. Realtime dùng SDK chính thức `@neon/realtime`, với truy vấn đọc cố định do backend seal; trình duyệt không được chọn SQL hay ghi trực tiếp.

## Chạy từ thư mục MIO

```powershell
npm run build
npm run db:neon:migrate
npm run start:neon
```

Giao diện: `http://127.0.0.1:5500`. API: `http://127.0.0.1:8082`. Port 8080 đang được một dịch vụ khác sử dụng trên máy kiểm thử nên launcher Neon mặc định dùng 8082. Đổi cổng API bằng `$env:PORT = '8083'` trước khi chạy.

Launcher giữ `LABEL_AUTOMATION_INTERVAL_MS=0` nếu chưa có thiết lập riêng. Chỉ bật lại tác vụ tự động khi đã chủ động chọn môi trường dữ liệu phù hợp.

## Migration

Migration Neon riêng: `database/Neon/001_mio_activity.sql`. Nó chỉ thêm schema `mio`, bảng `activity_events` và index, có thể chạy lại. Không áp dụng toàn bộ SQL Supabase lên Neon. Bảng hoạt động có primary key để Realtime theo dõi thay đổi; public feed không chứa dữ liệu riêng tư.

## Kiểm thử

```powershell
npm test
npm --prefix VC_FOOODSAVE run test:order
npm run test:neon:e2e
```

Lệnh E2E yêu cầu app đang chạy. Nó kết nối qua `http://127.0.0.1:5500`, nhận sealed query qua API, đăng ký Realtime, ghi một hoạt động bằng service backend, xác nhận cập nhật live và bản ghi trả về qua API, rồi xóa bản ghi thử và đóng kết nối. Không tạo đơn hàng hoặc chạy thanh toán thật. Có thể đổi địa chỉ bằng `MIO_API_ORIGIN`.

Đã kiểm thử Chromium với trang chủ thật: hai API trả 200, WebSocket Neon kết nối và giao diện hiển thị “Đang cập nhật trực tiếp.” Bộ kịch bản đơn hàng dùng database giả trong bộ nhớ, không thay thế kiểm thử nghiệp vụ thanh toán thật.

## Khi đưa mã lên Netlify

`neon deploy` triển khai dịch vụ Neon, không xuất bản mã website lên Netlify. Cần publish mã ứng dụng và cấu hình các biến Neon trên Netlify cùng cấu hình Supabase hiện có. Đặt `NEON_DATABASE_URL` rõ ràng hoặc `DATABASE_URL` là URL Neon; nếu vẫn dùng kết nối PostgreSQL trực tiếp của Supabase, cấu hình `SUPABASE_DATABASE_URL` riêng.

Danh sách allowed origins của Realtime nằm trong `neon.ts`. Khi đổi tên miền giao diện, cập nhật danh sách rồi chạy `neon deploy --update-existing`.

## Hạn chế đã xác nhận

- PostgreSQL trực tiếp cũ của Supabase chưa kết nối được từ máy kiểm thử; backend dùng fallback hiện có cho tính điểm uy tín. Điều này không phải kết nối Neon.
- MoMo và chi trả ngân hàng tự động vẫn cần hoàn thiện như trước.
- Không kiểm thử đăng nhập bằng tài khoản người thật hoặc thanh toán thật trong lần thiết lập này.
- `npm audit` báo 3 vấn đề trong dependency hiện có (1 moderate, 2 high). Một bản sửa yêu cầu nâng Zod sang major mới; chưa áp dụng thay đổi phá vỡ tương thích trong lần tích hợp này.
