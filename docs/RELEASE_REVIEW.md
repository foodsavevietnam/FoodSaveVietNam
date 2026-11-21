# MIO — release review, 2026-11-21

## Phạm vi đã kiểm tra

Ba lượt review độc lập cho frontend, backend và dependency/schema; các nhóm đã kiểm tra chéo bản sửa của nhau. Không cam kết chất lượng tuyệt đối hoặc coi kiểm thử mô phỏng là thanh toán thật.

Đã sửa:

- Chuẩn hoá đường dẫn API khi Netlify chuyển tiếp vào Lambda.
- Chặn đăng nhập và phiên tình nguyện viên cũ thiếu OTP trên production; giữ đăng nhập Supabase của người mua.
- Chặn chủ tổ chức tự duyệt trạng thái qua API; giữ nguyên trạng thái duyệt khi cập nhật hồ sơ.
- Bắt lỗi JSON hỏng/quá lớn bằng phản hồi 400/413 an toàn, không ghi nội dung request vào log.
- Giới hạn thời gian truy vấn Neon HTTP, giữ kết nối Neon và Supabase tách biệt.
- Bỏ giá trị khóa MoMo cố định; cấu hình thiếu trả 501 trước khi gọi mạng.
- Sửa schema Zod 4, tránh PATCH đặt lại dữ liệu không được gửi và đọc đúng query `false`.
- Sửa tràn giao diện mobile, nhãn nút đóng, khôi phục Realtime và race khi tải SDK.
- Đóng gói SDK Realtime cùng website, không phụ thuộc tải module từ CDN lúc chạy.

## Kiểm chứng

Build TypeScript và bundle Netlify Functions thành công. Bộ kiểm thử gồm máy chủ preview, cách nạp môi trường, schema, phân quyền, định tuyến Lambda và frontend. Bộ đơn hàng: 8 kiểm thử chính sách và 79 kịch bản dùng database giả. Kiểm thử Neon thật xác nhận ghi Postgres, nhận thay đổi Realtime, đọc qua API và dọn bản ghi thử.

Chromium: 13 trang HTML trên viewport 390 và 1440, không lỗi JavaScript hoặc tràn ngang; đã kiểm tra khôi phục feed sau mất kết nối. Không tạo giao dịch thanh toán thật hoặc thay đổi dữ liệu người dùng để kiểm thử.

`npm audit` sau nâng cấp báo 0 vulnerabilities.

## Triển khai công khai

Mã đã được push vào nhánh `main` của `foodsavevietnam/FoodSaveVietNam`. Site Netlify gắn với repo là `makeitorganized.netlify.app`.

Lần build đầu thiếu TypeScript vì `NODE_ENV=production` bỏ qua devDependencies; đã thêm `NPM_FLAGS=--include=dev` vào cấu hình build và xác nhận Netlify publish thành công. 58 kiểm thử hồi quy đạt trên gói release; 26 lượt kiểm tra Chromium công khai đạt cho 13 trang ở viewport 390/1440. API và luồng ghi Postgres → Realtime → đọc API của Neon đã qua E2E trên site công khai.

Theo lựa chọn của chủ dự án, cấu hình Supabase trên Netlify dùng bộ cấu hình đang hoạt động trong thư mục MIO, thay cho project cũ không truy cập được. Giá trị bí mật chỉ được cập nhật qua môi trường Netlify, không đưa vào Git. Cấu hình Neon được giữ nguyên.

Sau khi deploy lại với cấu hình đã chọn: health, danh sách sản phẩm, cửa hàng và hoạt động đều trả HTTP 200; route hồ sơ thiếu đăng nhập trả 401, JSON không hợp lệ trả 400. Kiểm thử Neon E2E trên site công khai tiếp tục đạt và dọn bản ghi thử thành công.

## Phần cần chủ dự án xác minh trước khi vận hành dữ liệu thật

- Chính sách RLS/trigger đang áp dụng trên Supabase cần đối chiếu migration `database/Admin/014_admin_login_security.sql` và `database/User/038_api_write_hardening.sql`. File 038 được chuẩn bị nhưng **chưa áp dụng lên database**. Lần kiểm tra kết nối PostgreSQL Supabase trực tiếp bị từ chối; API Supabase vẫn đọc được danh mục.
- Scheduled Functions giữ `AUTOMATION_ENABLED=false` cho tới khi database sẵn sàng, để không tự sửa đơn hàng/sản phẩm khi chưa kiểm chứng migration. Sau khi xác minh, bật biến này trên Netlify và deploy lại.
- Đăng nhập tình nguyện viên bằng số điện thoại cần triển khai OTP thật. Production từ chối cơ chế thiếu xác thực thay vì cấp phiên không an toàn.
- Thanh toán dùng `simulated`, chi trả dùng `manual`; MoMo/ngân hàng thật cần cấu hình và kiểm thử sandbox riêng.

Các giới hạn này phải được giữ trong báo cáo triển khai; chúng không được coi là đã hoàn tất chỉ vì build thành công.
