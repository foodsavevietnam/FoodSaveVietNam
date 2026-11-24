# Mẫu email OTP (Supabase)

Email OTP do Supabase gửi (`signInWithOtp`), nên nội dung nằm trong Supabase Dashboard, không nằm trong code.

## Cách áp dụng

1. Supabase Dashboard → **Authentication → Email Templates**.
2. Mở lần lượt **Magic Link** và **Confirm signup**, với mỗi mục:
   - **Subject**: `Mã đăng nhập MIO: {{ .Token }}`
   - **Message body**: dán toàn bộ nội dung `otp-email.html`.
   - Bấm **Save**.
3. **Authentication → Providers → Email → Email OTP Expiration**: đặt `600` (10 phút) cho khớp với nội dung email và `GOOGLE_OTP_EXPIRES_SECONDS`.

## Ghi chú

- Logo trong email lấy từ `https://makeitorganized.netlify.app/icons/mio-logo-square.png`, chỉ hiện đúng logo tách nền sau khi deploy bản mới. Đổi tên miền thì sửa URL này và link ở chân email.
- Biến Supabase dùng trong mẫu: `{{ .Token }}` (mã 6 số), `{{ .Email }}` (email người nhận).
- Gửi thử: đăng nhập bằng Gmail trên app rồi kiểm tra hộp thư (cả mục Spam).
