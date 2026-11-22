// Helper Playwright dùng chung cho trang quản trị cũ (/quan-tri) và cổng mới (/admin).
// Cấu hình qua window.__FAKE_SB do test đặt bằng page.addInitScript:
//   { noSession: true }  bắt đầu ở màn đăng nhập (chưa có phiên)
//   { refreshOk: true }  refreshSession thành công (mặc định trả lỗi để test 401 khóa được)
// Bộ đếm lời gọi nằm ở window.__FAKE_SB_CALLS = { signIn, refresh }.

// Thay thư viện Supabase bằng bản giả: phiên admin hợp lệ, mọi truy vấn bảng trả về rỗng.
export const FAKE_SUPABASE = `
window.__FAKE_SB_CALLS = window.__FAKE_SB_CALLS || { signIn: 0, refresh: 0 };
window.supabase = { createClient() {
  const cfg = window.__FAKE_SB || {};
  const makeSession = () => ({ access_token: 'admin-token', user: { id: 'a1', email: 'admin@mio.vn' } });
  let session = cfg.noSession ? null : makeSession();
  const chain = table => new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'then') return resolve => resolve({ data: [], error: null, count: 0 });
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: table === 'profiles' ? { id: 'a1', role: 'admin', full_name: 'Admin Thử', email: 'admin@mio.vn', status: 'active' } : null, error: null });
      return () => chain(table);
    },
    apply() { return chain(table); },
  });
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { session = null; return {}; },
      signInWithPassword: async () => {
        window.__FAKE_SB_CALLS.signIn += 1;
        session = makeSession();
        return { data: { user: session.user, session }, error: null };
      },
      refreshSession: async () => {
        window.__FAKE_SB_CALLS.refresh += 1;
        if (window.__FAKE_SB && window.__FAKE_SB.refreshOk) {
          session = makeSession();
          return { data: { user: session.user, session }, error: null };
        }
        return { data: { user: null, session: null }, error: { message: 'Refresh token hết hạn' } };
      },
    },
    from: table => chain(table),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  };
} };
`;

/**
 * Cài stub cho một trang quản trị.
 * - api(route, { path, method, body }): xử lý mọi request tới /api/v1/** (path đã bỏ tiền tố /api/v1, còn query).
 * - fakeSb: cấu hình đặt vào window.__FAKE_SB trước khi trang chạy.
 * - ignoreStatuses: mã HTTP của request /api/v1/ được phép lỗi có chủ ý (vd [401]); mặc định không bỏ qua gì.
 * Trả { errors, calls }: errors gom pageerror và console.error (bỏ dòng log mạng của trình duyệt cho 401/500 cố ý),
 * calls ghi mọi request API { method, path, body }.
 */
export async function stubAdmin(page, { api, fakeSb, ignoreStatuses = [] } = {}) {
  const errors = [];
  const calls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const status = /status of (\d{3})(?!\d)/.exec(text)?.[1];
    if (status && ignoreStatuses.includes(Number(status)) && msg.location().url.includes('/api/v1/')) return;
    errors.push(text);
  });
  if (fakeSb) await page.addInitScript((cfg) => { window.__FAKE_SB = cfg; }, fakeSb);
  await page.route('**/@supabase/supabase-js**', (route) => route.fulfill({
    status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE,
  }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, '') + url.search;
    let body;
    try { body = request.postDataJSON() ?? undefined; } catch { body = undefined; }
    const info = { path, method: request.method(), body };
    calls.push({ ...info });
    return api(route, info);
  });
  return { errors, calls };
}
