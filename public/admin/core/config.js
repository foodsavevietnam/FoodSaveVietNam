// Cấu hình cổng quản trị. API_BASE do /frontend/foodsave-config.js đặt.
// Địa chỉ/khóa dịch vụ đăng nhập nằm trong core/auth.js (file duy nhất được chạm thư viện đăng nhập).
export const API_BASE = window.FOODSAVE_API_BASE;
export const VERSION = '20261123a';
export const POLL_IDLE_MS = 900000;
export const POLL_MIN_GAP_MS = 10000;
export const API_TIMEOUT_MS = 15000;
export const WORK_REFRESH_MS = 60000;

const DEMO_KEY = 'mio.demo.admin';
function readDemo() {
  try {
    const flag = new URLSearchParams(location.search).get('demo');
    if (flag === '1') { sessionStorage.setItem(DEMO_KEY, '1'); return true; }
    if (flag === '0') { sessionStorage.removeItem(DEMO_KEY); return false; }
    return sessionStorage.getItem(DEMO_KEY) === '1';
  } catch { return false; }
}
export const DEMO = readDemo();
