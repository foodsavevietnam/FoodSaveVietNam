// Phiên đăng nhập quản trị. Đây là file DUY NHẤT dưới public/admin được chạm thư viện Supabase.
// Phiên lưu riêng (storageKey) như ADMIN_FOODSAVE.html để không lẫn với phiên người mua/cửa hàng.
// URL/khóa chép từ ADMIN_FOODSAVE.html dòng 8-9 (publishable key, công khai).
export const SUPABASE_URL = 'https://idhpydhlgnxjjtyrgfkj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_kBjao9fkPwim7sJKZfWf_Q_JGRZuUOf';
const BAD_LOGIN = 'Email hoặc mật khẩu không đúng.';
const LOGIN_FAILED = 'Không đăng nhập được. Vui lòng thử lại.';

const NO_SESSION = 'Không thể đăng nhập. Vui lòng thử lại.';

// Chỉ đúng lỗi sai email/mật khẩu; 400 khác (vd chưa xác nhận email) không tính
const isBadCredential = (error) => error?.code === 'invalid_credentials'
  || /invalid login credentials/i.test(String(error?.message || ''));

export function createAuth({ supabaseUrl = SUPABASE_URL, supabaseKey = SUPABASE_KEY } = {}) {
  const lib = globalThis.window?.supabase;
  if (!lib?.createClient) throw new Error('Không tải được thư viện đăng nhập.');
  const client = lib.createClient(supabaseUrl, supabaseKey, {
    auth: { storageKey: 'foodsave-admin-auth', persistSession: true, autoRefreshToken: true },
  });

  async function signIn(email, password) {
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
      if (error) return { ok: false, message: isBadCredential(error) ? BAD_LOGIN : LOGIN_FAILED };
      if (!data?.session) return { ok: false, message: NO_SESSION };
      return { ok: true };
    } catch (error) {
      console.warn('[MIO] Lỗi đăng nhập:', error);
      return { ok: false, message: LOGIN_FAILED };
    }
  }

  async function signOut() {
    try { await client.auth.signOut(); } catch (error) { console.warn('[MIO] Lỗi đăng xuất:', error); }
  }

  async function getToken() {
    try {
      const { data } = await client.auth.getSession();
      return data?.session?.access_token || null;
    } catch { return null; }
  }

  // Làm mới phiên đúng một lần; lỗi hoặc không có phiên → false
  async function refresh() {
    try {
      const { data, error } = await client.auth.refreshSession();
      return !error && Boolean(data?.session);
    } catch { return false; }
  }

  function onChange(cb) {
    const { data } = client.auth.onAuthStateChange((_event, session) => cb(session || null));
    return () => data?.subscription?.unsubscribe();
  }

  // Chỉ admin chưa bị khóa mới vào được. 401/403 hoặc sai vai trò → đăng xuất, trả null.
  // Lỗi khác (mạng, máy chủ) ném lên để màn đăng nhập báo lỗi mà không xóa phiên.
  async function ensureAdmin(api) {
    let me;
    try {
      me = await api.get('/profile/me');
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) { await signOut(); return null; }
      throw error;
    }
    if (me?.role === 'admin' && me.status !== 'suspended') {
      return { id: me.id, full_name: me.full_name, email: me.email };
    }
    await signOut();
    return null;
  }

  return { signIn, signOut, getToken, refresh, onChange, ensureAdmin };
}
