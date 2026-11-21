# Mô tả chức năng giao diện MIO

Tài liệu mô tả hai cổng giao diện trong `FOODSAVE_CHARITY.html` và `FOODSAVE_PARTNER.html`.

## 1. Cổng tổ chức từ thiện — `FOODSAVE_CHARITY.html`

### Trang giới thiệu

- Giới thiệu dịch vụ tiếp nhận thực phẩm hỗ trợ cho các tổ chức từ thiện.
- Trình bày số liệu tác động, cách hoạt động, nhóm tổ chức phù hợp và câu hỏi thường gặp.
- Nút **Đăng ký tổ chức** mở biểu mẫu đăng ký; **Đăng nhập** mở màn hình truy cập tài khoản.
- Thanh điều hướng cuộn đến các phần chính của trang.

### Đăng ký và đăng nhập

- Đăng nhập tài khoản tổ chức; giao diện có các luồng OTP, QR và khôi phục mật khẩu.
- Đăng ký theo từng bước: xác thực email người đại diện, thông tin đại diện, giấy tờ KYC, hồ sơ tổ chức, quy mô phục vụ và thông tin liên hệ.
- Cho phép tải tài liệu, ảnh logo/ảnh bìa và nhập vị trí tổ chức.
- Hiển thị trạng thái gửi hồ sơ và chờ quản trị viên xét duyệt.

### Cổng quản lý tổ chức

- **Tổng quan:** tình hình hoạt động và các chỉ số chính.
- **Donation Inbox:** xem lô thực phẩm được đề nghị và xử lý tiếp nhận.
- **Ghép đơn / Pickup:** theo dõi lô hàng, tình trạng lấy hàng và giao nhận.
- **Bản đồ & tuyến đường:** hỗ trợ xem vị trí và điều phối nhận hàng.
- **Tình nguyện viên:** quản lý danh sách và phân công người nhận/phân phối.
- **Người hưởng lợi:** quản lý các nhóm cộng đồng được hỗ trợ.
- **Báo cáo, Gallery, Cộng đồng, Tác động & CO₂:** theo dõi kết quả, ảnh hoạt động và tác động xã hội/môi trường.
- **Cài đặt:** quản lý thông tin tổ chức và tài khoản.

## 2. Cổng đối tác cửa hàng — `FOODSAVE_PARTNER.html`

### Trang giới thiệu

- Giới thiệu dịch vụ bán thực phẩm cận hạn và lợi ích cho cửa hàng.
- Trình bày các bước hoạt động, gói dịch vụ, câu hỏi thường gặp và nút đăng ký/đăng nhập.
- Thanh điều hướng cuộn đến phần tổng quan, cách hoạt động, gói dịch vụ và FAQ.

### Đăng ký và đăng nhập

- Đăng nhập tài khoản cửa hàng; giao diện có các luồng OTP, QR và khôi phục mật khẩu.
- Đăng ký theo từng bước: xác thực, loại hình kinh doanh, thông tin người đại diện/eKYC, hồ sơ cửa hàng, giờ hoạt động và thiết lập tài chính.
- Hỗ trợ tải giấy tờ, đọc thông tin từ ảnh khi dịch vụ OCR khả dụng và cho phép chỉnh sửa thông tin đã nhận dạng.
- Hiển thị trạng thái hồ sơ đang chờ xét duyệt.

### Cổng quản lý cửa hàng

- **Tổng quan:** hoạt động bán hàng và các chỉ số cửa hàng.
- **Đơn hàng:** xem và xử lý đơn, cập nhật trạng thái giao nhận.
- **Kho hàng:** quản lý sản phẩm, giá và hàng cận hạn.
- **Quyên góp:** tạo/theo dõi lô thực phẩm dành cho tổ chức từ thiện.
- **Marketing Studio:** tạo nội dung quảng bá và quản lý chiến dịch.
- **Phân tích, Xếp hạng, Vi phạm/Khiếu nại:** xem hiệu quả và xử lý vấn đề phát sinh.
- **Ví người bán:** theo dõi số dư và giao dịch.
- **Cài đặt:** thông tin cửa hàng, giờ hoạt động và cấu hình tài khoản.

## 3. Cách chạy trên máy

1. Giữ hai file HTML cùng thư mục với thư mục `frontend` và các tài nguyên cục bộ được liên kết trong trang.
2. Mở `FOODSAVE_CHARITY.html` hoặc `FOODSAVE_PARTNER.html` bằng trình duyệt. Chế độ demo được bật sẵn, không cần khởi động backend.
3. Chọn **Đăng nhập** để xem tài khoản mẫu và nút điền nhanh:
   - Charity: `demo@charity.mio` / `mio2026`
   - Partner: `demo@partner.mio` / `mio2026`
4. Trang dùng dữ liệu mẫu ngay trong trình duyệt. Các thay đổi trong lúc demo không gửi lên máy chủ và sẽ trở về dữ liệu mẫu ban đầu khi tải lại trang.
5. Phông chữ, biểu tượng và bản đồ có thể cần Internet. Các tính năng tích hợp với dịch vụ bên ngoài như camera, bản đồ hoặc OCR vẫn phụ thuộc trình duyệt và thư viện tương ứng.

## 4. Điều chỉnh hiển thị

- Đã bật lại phần hướng dẫn/mô tả ngắn trong các biểu mẫu đăng ký Charity và Partner vốn bị stylesheet tối giản ẩn.
- Cho phép cuộn toàn trang ở màn hình đăng ký dài để nội dung không bị cắt ở chiều cao màn hình.
- Giữ màu chữ I của logo MIO là cam để đồng nhất với mẫu logo.
- Đã thêm chế độ demo với dữ liệu mẫu riêng cho hai cổng; các lời gọi API/backend bị chặn trong chế độ này.
