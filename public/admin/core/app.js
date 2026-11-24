// Khởi động cổng quản trị: cổng đăng nhập, khung giao diện, router, lịch poll, vòng đời màn.
import { API_BASE, API_TIMEOUT_MS, POLL_IDLE_MS, POLL_MIN_GAP_MS, WORK_REFRESH_MS, DEMO } from './config.js';
import { createApi } from './api.js';
import { createAuth } from './auth.js';
import { createRouter, buildHash } from './router.js';
import { createPoll } from './poll.js';
import { createState } from './state.js';
import { mountShell } from './shell.js';
import { stamp } from './format.js';
import { actionLabel } from './vi.js';
import * as ui from './ui.js';
import { GROUPS, SCREENS } from '../screens/manifest.js';

const { html } = ui;
const $ = (id) => document.getElementById(id);
const SESSION_EXPIRED = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
const NOT_ADMIN = 'Tài khoản này không có quyền quản trị.';
// 401 lặp lại ngay sau một lần làm mới phiên thành công → khóa luôn, không làm mới vòng tròn
const REFRESH_GUARD_MS = 30000;

const state = createState({ demo: DEMO });
let shell = null;
const poll = createPoll({
  idleMs: POLL_IDLE_MS, minGapMs: POLL_MIN_GAP_MS, demo: DEMO, onPaused: (paused) => shell?.setPaused(paused),
});
const router = createRouter({ onChange: (route) => showScreen(route) });
const navigate = (screen, params) => router.navigate(screen, params);

let api = null;
let auth = null;
let entered = false;
let routerStarted = false;
let detachPoll = null;
let current = null; // { screen, controller }
let seq = 0;
let refreshing = false;
let refreshedAt = -Infinity;
let loginBusy = false;

// Gộp các lần gọi chồng nhau (app + màn Hôm nay) thành một request
let workInflight = null;
function refreshWork() {
  if (!entered) return Promise.resolve();
  workInflight ??= (async () => {
    try {
      const data = await api.get('/admin/dashboard/work');
      state.set('work', data);
      shell?.setBadges(data);
    } catch (error) {
      console.warn('[MIO] Không tải được số việc cần làm:', error);
    } finally {
      workInflight = null;
    }
  })();
  return workInflight;
}

function teardownScreen() {
  ui.closeModal(); // hộp xác nhận của màn cũ trả { ok: false }, không treo lại khi quay về
  ui.drawer.close();
  if (!current) return;
  try { current.screen?.destroy?.(); } catch (error) { console.warn('[MIO] Lỗi khi đóng màn:', error); }
  current.controller.abort();
  current = null;
  poll.remove('screen:*');
}

async function showScreen({ screen, params }) {
  if (!entered) return;
  const def = SCREENS.find((s) => s.id === screen);
  if (!def) {
    // Màn lạ → Hôm nay, thay hash tại chỗ để nút Back không quay lại hash hỏng
    history.replaceState(null, '', buildHash('today'));
    return showScreen({ screen: 'today', params: {} });
  }
  const token = ++seq;
  teardownScreen();
  const container = $('screen');
  container.innerHTML = '';
  shell.setActive(def.id);
  document.title = `${def.title} · MIO — Quản trị`;
  const controller = new AbortController();
  current = { screen: null, controller };
  try {
    const mod = await def.load();
    if (token !== seq) return;
    current.screen = mod.default;
    await mod.default.render(container, {
      api, ui, state, poll, params, navigate, signal: controller.signal, refreshWork, screen: { id: def.id, title: def.title },
    });
  } catch (error) {
    if (token !== seq || controller.signal.aborted) return;
    console.warn(`[MIO] Không mở được màn ${def.id}:`, error);
    // Lỗi không phải ApiError (lỗi nạp module…) thì hiện thông điệp tiếng Việt chung
    const shown = error?.code ? error : { message: 'Không tải được màn này.' };
    ui.error(container, shown, () => { if (token === seq) showScreen({ screen: def.id, params }); });
  }
}

function showLogin(message = '') {
  document.body.classList.add('admin-locked');
  $('loginError').textContent = message;
}

// Khóa cổng nhưng giữ nguyên location.hash để đăng nhập lại quay về đúng màn
function lock(message = '') {
  if (entered) {
    entered = false;
    seq += 1;
    teardownScreen();
    poll.remove('work');
    detachPoll?.();
    detachPoll = null;
  }
  ui.closeModal(); // không để hộp xác nhận cũ hiện lại sau khi đăng nhập lại
  refreshedAt = -Infinity; // phiên mới sau khi đăng nhập lại được làm mới 1 lần như thường
  showLogin(message);
}

function enter(admin) {
  state.set('admin', admin);
  shell ??= mountShell({
    root: $('app'), screens: SCREENS, groups: GROUPS, state, navigate,
    onLogout: logout, onBell: openBell, onResume: () => poll.touch(),
  });
  shell.setAdmin(admin);
  entered = true;
  document.body.classList.remove('admin-locked');
  $('loginError').textContent = '';
  if (!detachPoll) detachPoll = poll.attach(document);
  poll.touch(); // hết trạng thái tạm dừng cũ (nếu có) trước khi thêm job
  poll.add('work', refreshWork, { everyMs: WORK_REFRESH_MS, immediate: false });
  refreshWork();
  if (routerStarted) showScreen(router.current());
  else { routerStarted = true; router.start(); }
}

async function handleUnauthorized() {
  if (!entered || refreshing || DEMO) return;
  if (Date.now() - refreshedAt < REFRESH_GUARD_MS) { lock(SESSION_EXPIRED); return; }
  refreshing = true;
  let ok = false;
  try { ok = await auth.refresh(); } finally { refreshing = false; }
  if (!entered) return;
  if (!ok) { lock(SESSION_EXPIRED); return; }
  refreshedAt = Date.now();
  showScreen(router.current());
  refreshWork();
}

async function logout() {
  if (DEMO) { location.href = '/admin/index.html?demo=0'; return; }
  lock('');
  state.set('admin', null);
  state.set('work', null);
  await auth.signOut();
}

async function openBell() {
  ui.drawer.open(html`<div data-role="bell-list" style="padding:8px 0"></div>`, { title: 'Hoạt động gần đây' });
  const box = document.querySelector('#drawer [data-role="bell-list"]');
  if (!box) return;
  ui.loading(box);
  try {
    const data = await api.get('/admin/audit-log?limit=20');
    if (!box.isConnected) return;
    const rows = (Array.isArray(data) ? data : data?.items || []).slice(0, 20);
    if (!rows.length) { ui.empty(box, 'Chưa có hoạt động nào.'); return; }
    box.innerHTML = rows.map((r) => html`<div class="DR"><div class="DR-l">${stamp(r.created_at)}</div>
      <div class="DR-v"><b>${r.actor_name || 'Hệ thống'}</b><br>${actionLabel(r.action)}</div></div>`).join('');
  } catch (error) {
    if (box.isConnected) ui.error(box, error, openBell);
  }
}

async function tryEnter(explicit) {
  let admin;
  try {
    admin = await auth.ensureAdmin(api);
  } catch (error) {
    showLogin(error?.message || 'Không kết nối được máy chủ.');
    return;
  }
  if (!admin) { showLogin(explicit ? NOT_ADMIN : ''); return; }
  enter(admin);
}

let bootError = '';

async function onLoginSubmit(e) {
  e.preventDefault(); // không bao giờ để trình duyệt gửi form (mật khẩu lọt lên URL/log)
  const form = e.currentTarget;
  if (!auth) {
    $('loginError').textContent = bootError || 'Cổng quản trị đang khởi động. Vui lòng thử lại sau giây lát.';
    return;
  }
  if (loginBusy) return;
  const button = form.querySelector('button[type="submit"]');
  loginBusy = true;
  button.disabled = true;
  $('loginError').textContent = '';
  try {
    const result = await auth.signIn(form.elements.email.value, form.elements.password.value);
    if (!result.ok) { $('loginError').textContent = result.message; return; }
    form.elements.password.value = '';
    await tryEnter(true);
  } finally {
    loginBusy = false;
    button.disabled = false;
  }
}

// Gắn ở cấp module, trước khi tạo auth và trước mọi await: kể cả khi khởi động lỗi, form vẫn bị chặn gửi.
// Nút submit tắt sẵn trong HTML (module lỗi nạp → không bao giờ gửi form); chỉ bật khi handler đã gắn.
$('login').addEventListener('submit', onLoginSubmit);
$('login').querySelector('button[type="submit"]').disabled = false;

function showDemoBar() {
  if (document.querySelector('.v2demo')) return;
  const bar = document.createElement('div');
  bar.className = 'v2demo';
  bar.setAttribute('role', 'status');
  bar.textContent = 'Chế độ xem thử · dữ liệu mẫu';
  document.body.append(bar);
}

async function boot() {
  if (DEMO) {
    const { createDemoApi } = await import('../demo/index.js');
    api = createDemoApi();
    showDemoBar();
    enter({ full_name: 'Quản trị viên (xem thử)' });
    return;
  }
  auth = createAuth();
  api = createApi({
    fetch: (...args) => globalThis.fetch(...args),
    getToken: auth.getToken,
    baseUrl: API_BASE,
    onUnauthorized: handleUnauthorized,
    timeoutMs: API_TIMEOUT_MS,
  });
  // Phiên bị xóa ở nơi khác (tab khác, làm mới phiên thất bại) → khóa, giữ hash
  auth.onChange((session) => { if (!session && entered) lock(SESSION_EXPIRED); });
  if (await auth.getToken()) await tryEnter(false);
  else showLogin('');
}

boot().catch((error) => {
  console.error('[MIO] Không khởi động được cổng quản trị:', error);
  bootError = 'Không khởi động được cổng quản trị. Vui lòng tải lại trang.';
  showLogin(bootError);
});
