# MIO

Website MIO gồm các cổng người mua, cửa hàng, tổ chức từ thiện, tình nguyện viên và quản trị, cùng API Express / TypeScript và các tác vụ Netlify.

## Chạy tại máy

Từ thư mục này, dùng Node.js 20 trở lên:

```powershell
node scripts/dev.mjs
```

Mở **http://127.0.0.1:5500**. Không cần cài dependency để xem giao diện.

| Trang | Đường dẫn |
| --- | --- |
| Giới thiệu | `/` |
| Người mua | `/FOODSAVE_USER.html` |
| Ứng dụng PWA | `/FOODSAVE_APP.html` |
| Cửa hàng | `/FOODSAVE_PARTNER.html` |
| Tổ chức từ thiện | `/FOODSAVE_CHARITY.html` |
| Tình nguyện viên | `/FOODSAVE_VOLUNTEER.html` |
| Quản trị | `/ADMIN_FOODSAVE.html` |
| Chính sách / điều khoản | `/chinh-sach.html`, `/dieu-khoan.html` |

Các đường dẫn ngắn `/nguoi-mua`, `/ung-dung`, `/doi-tac`, `/tu-thien`, `/tinh-nguyen`, `/quan-tri` chuyển hướng tới trang HTML tương ứng. Tên URL cũ được giữ vì mã giao diện dùng tên trang để xác định vai trò.

Các đường dẫn demo gốc `/foodsave_partner`, `/foodsave_user`, `/foodsave_charity` cũng được hỗ trợ. Nội dung hiển thị sử dụng tên MIO và logo mới.

Cổng cửa hàng và tổ chức từ thiện có chế độ demo từ mã nguồn gốc. Những cổng khác và các thao tác dữ liệu thật cần backend. Thư viện font, bản đồ và một số ảnh bên ngoài cần Internet.

## API

API nằm trong `src/`, sử dụng Express, TypeScript, Supabase và PostgreSQL. Khi chủ dự án đã cài dependency và cấu hình dịch vụ, chạy API riêng bằng:

```powershell
npm run dev:api
```

Sau đó khởi động giao diện với proxy:

```powershell
node scripts/dev.mjs --api-origin http://127.0.0.1:8080
```

Giao diện gọi `/api/v1` trên cùng origin. Máy chủ preview chuyển tiếp các yêu cầu này tới API được chỉ định. Khi chưa cấu hình proxy, API trả thông báo 503 rõ ràng. Khi xuất bản Netlify, redirect `/api/v1/*` đưa yêu cầu vào Netlify Function.

Có thể cấu hình API riêng bằng `window.FOODSAVE_API_BASE` hoặc thẻ `meta[name="foodsave-api-base"]` trước khi nạp `frontend/foodsave-config.js`. Không đặt thông tin bí mật trong mã giao diện.

## Lệnh dự án

| Lệnh | Mục đích |
| --- | --- |
| `npm run dev` | Chạy giao diện tại cổng 5500 |
| `npm run check` | Kiểm tra cú pháp, liên kết và tài nguyên PWA |
| `npm test` | Kiểm thử preview và cấu hình giao diện |
| `npm run dev:api` | Biên dịch và chạy API đã cấu hình |
| `npm run typecheck` | Kiểm tra kiểu TypeScript của API |
| `npm run build` | Biên dịch API |
| `npm run test:order` | Bộ kiểm thử đơn hàng hiện có |

Các lệnh API cần dependency riêng của dự án. Không cần chạy chúng để xem giao diện demo.

## Netlify

Sử dụng `VC_FOOODSAVE` làm **base directory** khi kết nối kho Git từ thư mục `MIO`. Cấu hình nằm trong `netlify.toml`: publish `public`, functions `netlify/functions`, build `npm run check`. Nếu kho Git bắt đầu ngay tại `VC_FOOODSAVE`, để trống base directory.

Các biến cấu hình dịch vụ do chủ dự án thiết lập trên môi trường triển khai. Chỉ nội dung trong `public/` được xuất bản dưới dạng tệp tĩnh.

## Logo MIO

`public/icons/mio-logo.jpg` là bản sao logo được cung cấp. Logo vuông dùng trong giao diện là `mio-logo-square.png`; các icon cài ứng dụng được chuẩn hoá từ cùng hình gốc. Để tạo lại các icon trên Windows:

```powershell
node scripts/make-icons.js
```

Thay logo gốc tại `public/icons/mio-logo.jpg` trước khi chạy lệnh. Công cụ giữ nguyên hình gốc, căn logo trên nền trắng và thêm khoảng cách phù hợp cho icon PWA.

## Tài liệu

- [Neon Postgres + Realtime](docs/NEON_SETUP.md)
- [Cấu trúc dự án và phiên bản giao diện](docs/PROJECT_STRUCTURE.md)
- [Mô tả chức năng](docs/MO_TA_CHUC_NANG_GIAO_DIEN_MIO.md)
- [Thử ứng dụng người mua](docs/HUONG_DAN_THU_APP_NGUOI_MUA.md)
- [Yêu cầu PWA](docs/YEU_CAU_APP_NGUOI_MUA_PWA.md)
- [Yêu cầu quy trình đơn hàng](docs/YEU_CAU_QUY_TRINH_DON_HANG_PWA.md)
- [Tài liệu backend trước khi tổ chức lại](docs/BACKEND_REFERENCE.md)

Tài liệu backend tham khảo được giữ lại để bảo toàn thông tin. Các đường dẫn và lệnh chạy hiện hành nằm trong README này và tài liệu cấu trúc.
