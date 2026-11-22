# Admin Portal (Đợt 0 Nền + Đợt 1 Cần quyết định) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng cổng quản trị mới `public/admin/` (shell, lõi dùng chung, trang "Hôm nay", "Nhật ký") và chuyển 7 màn đã có API thật (Khiếu nại, Duyệt hồ sơ, Rút tiền & chi trả, Cảnh báo gian lận, Quy tắc & tự động, Khuyến mãi, Tác động ESG) sang cổng mới, kèm nền backend (schema list chuẩn, phân trang, test harness) cho các đợt sau.

**Architecture:** ES modules thuần trong `public/admin/` (không build step), hash router `#/<screen>`, mỗi màn một file export `{id,title,group,render,destroy}`. Đăng nhập Supabase dùng chung `storageKey 'foodsave-admin-auth'` với trang cũ; mọi dữ liệu qua `/api/v1/admin/*` bằng `core/api.js`; mọi vòng lặp qua `core/poll.js` (dừng khi tab ẩn / rảnh 15 phút). Trang cũ `ADMIN_FOODSAVE.html` chạy song song, mục đã chuyển thì chuyển hướng sang `/admin/#/<screen>`.

**Tech Stack:** Vanilla JS (ES2020 modules), CSS thuần, `@supabase/supabase-js@2.112.0` (CDN, ghim), Express + TypeScript + Zod, Supabase service role, `node --test` (tests/*.mjs), Playwright (`tests/e2e`, dev-server cổng 5517), FakeDb `scripts/fake-supabase.js`.

**Spec:** `docs/superpowers/specs/2026-11-23-admin-portal-design.md` (đọc trước khi làm bất kỳ task nào; đặc biệt mục 3 thanh bên, mục 4 kiến trúc frontend, mục 5 backend).

## Global Constraints

- Không framework, không bundler, không TypeScript ở frontend; file `.js` dưới `public/admin/` là ES module.
- `public/admin/core/auth.js` là file DUY NHẤT dưới `public/admin/` được chứa chuỗi `supabase` hoặc `createClient(`; mọi màn chỉ gọi `ctx.api`.
- Không `onclick="..."`/`onchange="..."` nội tuyến dưới `public/admin/screens/`; dùng `data-act`/`data-id` + `ui.delegate`. Mọi HTML dựng qua `html` tag tự escape; `raw()` chỉ bọc chuỗi đã do `html` sinh.
- Không `setInterval`/`setTimeout` lặp ngoài `core/poll.js`; mọi job lặp đăng ký qua `ctx.poll.add(name, fn, { everyMs, idleMs? })`.
- Ngân sách poll (spec 2.4): chạy chỉ khi `document.visibilityState === "visible"`, dừng sau rảnh `POLL_IDLE_MS = 15*60000`, tối thiểu `POLL_MIN_GAP_MS = 10000` giữa hai lần chạy cùng job khi tab hiện lại, `API_TIMEOUT_MS = 15000`. Huy hiệu `dashboard/work` làm mới `60000` ms.
- Supabase client: `storageKey: 'foodsave-admin-auth', persistSession: true, autoRefreshToken: true` (giống `ADMIN_FOODSAVE.html` dòng 12-14). CDN ghim `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.0/dist/umd/supabase.js` (cùng URL dạng mà `ADMIN_FOODSAVE.html` đang dùng; chép y nguyên).
- `index.html` phải thỏa `tests/project-integrity.test.mjs` dòng 57-76: title chứa `MIO`, không chứa `foodsave` (không phân biệt hoa thường); script đầu tiên là `foodsave-config.js` và chỉ một lần; có `<link rel="icon" href="/icons/icon-192.png">`; đúng một stylesheet `/frontend/mio-brand.css`; chuỗi `/icons/mio-logo-square.png` xuất hiện.
- Backend: Zod `.strict()`; lỗi qua `AppError`; response `sendSuccess`; list trả `{ items, total, page, limit }`; `limit` tối đa 100, mặc định 20; mọi hành động admin ghi `adminAuditService.log` SAU khi thao tác chính thành công; tên action `<đối_tượng>.<động_từ>`.
- SQL mới đánh số từ **040** (039 đã dùng). Đợt 0-1 KHÔNG cần SQL mới.
- Văn bản hiển thị, log, comment, commit message: tiếng Việt. Tiền hiện `65.000đ` (cột `*_cents` là VND nguyên). Không hiện mã thô `no_show`, `in_review`, `requested`… trên DOM; dùng `core/vi.js`.
- Không sửa `public/frontend/foodsave-*.css`, không đổi hành vi API cũ. Không commit `.env`. Commit sau mỗi task (nhánh mới `feat/admin-portal` từ `sua-loi-api`).
- Sau mỗi task backend: `npm run typecheck`, `npm run test:order`, `npm run test:admin` xanh. Sau mỗi task frontend: `npm run check`, `npm test`, `npx playwright test tests/e2e/admin-portal.spec.mjs` xanh; các spec cũ (`admin-tracking`, `ui`, `portal-*`, `location-*`) không hồi quy.

## Review Focus

1. **Phiên hết hạn giữa chừng** (token 401 khi đang mở drawer): màn phải khóa về đăng nhập, giữ nguyên `location.hash`, sau đăng nhập lại quay đúng màn, không mất dữ liệu đang lọc → test Task 2 (`api 401 → onUnauthorized`) + Task 6 (e2e 401).
2. **Tab ẩn / rảnh 15 phút** rồi quay lại: không dồn một loạt request, mỗi job chạy đúng 1 lần cách tối thiểu 10 giây → test Task 4 (fake timers) + Task 9 (polling budget e2e).
3. **API trả lỗi 500 hoặc JSON hỏng**: mỗi màn hiện thông báo tiếng Việt + nút "Thử lại", không vỡ shell, không lỗi console → test Task 2 (`BAD_RESPONSE`) + Task 6 (e2e 500).
4. **Tên/ghi chú có ký tự HTML** (`<script>`, `"`): hiện nguyên văn, không thực thi → test Task 3 (`html` escape) + Task 11 (khiếu nại có `note` chứa `<b>`).
5. **Hành động từ chối/bác bỏ với lý do rỗng hoặc < 3 ký tự**: nút gửi bị chặn phía client, backend vẫn 400/422 → test Task 11, 12, 13 (prompt lý do) + test backend có sẵn.

---

## Đợt 0: Nền

### Task 1: Shell tĩnh `public/admin/index.html` + CSS + tích hợp công cụ dự án

**Files:**
- Create: `public/admin/index.html`, `public/admin/styles/admin.css`, `public/admin/core/config.js`, `public/admin/core/app.js` (giữ chỗ: `import './config.js'; console.info('MIO admin: đang dựng');` để `check-project` không báo thiếu tham chiếu; Task 5 viết lại)
- Modify: `scripts/check-project.mjs` (HTML_FILES, danh sách module admin, nhánh kiểm cú pháp), `scripts/lib/dev-server.mjs:7-20` (PAGE_ALIASES), `public/sw.js:7,34,56`, `netlify.toml` (headers `/admin/*`)
- Test: `tests/dev-server.test.mjs`, `tests/project-integrity.test.mjs` (chạy lại, không sửa assert), `tests/admin-portal.test.mjs` (mới, chỉ phần cấu trúc)

**Interfaces:**
- Produces: `config.js` export `{ API_BASE: string, VERSION: string, DEMO: boolean, POLL_IDLE_MS: 900000, POLL_MIN_GAP_MS: 10000, API_TIMEOUT_MS: 15000, WORK_REFRESH_MS: 60000 }`; `API_BASE = window.FOODSAVE_API_BASE` (do `/frontend/foodsave-config.js` đặt), `DEMO = new URLSearchParams(location.search).get('demo') === '1' || sessionStorage['mio.demo.admin'] === '1'` (bọc try/catch; `?demo=0` xóa khóa).
- Produces: `index.html` có `<div id="app">` chứa `<aside id="sidebar">`, `<header id="topbar">`, `<main id="screen">`, `<div id="drawer">`, `<div id="modal">`, `<div id="toasts">`, `<form id="login">` (email, mật khẩu, nút, `#loginError`); body có class `admin-locked` mặc định.
- Produces: `admin.css` chứa biến `:root` chép từ `public/ADMIN_FOODSAVE.html` dòng 21-30 (`--bg`, `--side`, `--text`, `--t2`, `--t3`, `--ok`, `--warn`, `--err`, `--ac`…) + các lớp `.S`, `.S-s`, `.S-i`, `.K`, `.P`, `.P-h`, `.P-t`, `.W`, `.b`, `.b-ok/.b-w/.b-e/.b-m`, `.bt`, `.bt-p`, `.DR`, `.v2toast`, `.v2note` chép từ HTML cũ và `public/frontend/admin-v2.css`; thêm `.drawer`, `.modal`, `.skeleton`, `.poll-paused`; `@media (max-width: 1000px)` thu sidebar.

- [ ] **Step 1: Viết test cấu trúc trong `tests/admin-portal.test.mjs`**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
test('admin/index.html tồn tại và chỉ nạp script module ngoài', () => {
  const html = readFileSync('public/admin/index.html', 'utf8');
  assert.match(html, /<title>MIO — Quản trị<\/title>/u);
  assert.match(html, /<script type="module" src="\.\/core\/app\.js\?v=\d{8}[a-z]"><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>[\s\S]*?import /u, 'không được có module nội tuyến');
  for (const id of ['app', 'sidebar', 'topbar', 'screen', 'drawer', 'modal', 'toasts', 'login', 'loginError']) assert.match(html, new RegExp(`id="${id}"`));
});
test('sw.js không cache /admin/ và đã lên mio-v4', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /CACHE_VERSION = "mio-v4"/); assert.match(sw, /\/admin\//);
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node --test tests/admin-portal.test.mjs`
Expected: FAIL (ENOENT `public/admin/index.html`)

- [ ] **Step 3: Tạo `public/admin/index.html`, `styles/admin.css`, `core/config.js` theo Interfaces**

Thứ tự thẻ trong `<head>`: meta charset/viewport → `<title>` → `<link rel="icon" href="/icons/icon-192.png">` → `<link rel="stylesheet" href="/frontend/mio-brand.css">` → `<link rel="stylesheet" href="./styles/admin.css?v=…">` → `<script src="/frontend/foodsave-config.js"></script>` (script đầu tiên) → `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.0/dist/umd/supabase.js"></script>` → cuối body `<script type="module" src="./core/app.js?v=20261123a"></script>`. Logo sidebar: `<img class="mio-logo" src="/icons/mio-logo-square.png" alt="MIO" width="64" height="64">`.

- [ ] **Step 4: Sửa `scripts/check-project.mjs`**

Thêm `'admin/index.html'` vào `HTML_FILES`; thêm `export const ADMIN_MODULE_FILES = Object.freeze([...])` liệt kê `admin/core/config.js`, `admin/core/app.js` (bổ sung dần ở các task sau); trong hàm kiểm cú pháp (dòng ~209 `if (file.endsWith('.mjs'))`) mở rộng điều kiện thành `file.endsWith('.mjs') || file.startsWith('admin/')` để dùng `node --check --input-type=module`. Đưa `ADMIN_MODULE_FILES` vào vòng kiểm cùng `FRONTEND_FILES`.

- [ ] **Step 5: Sửa `scripts/lib/dev-server.mjs` PAGE_ALIASES thêm `'/admin': 'admin/index.html'`; thêm case vào `tests/dev-server.test.mjs` cạnh dòng 103**

```js
test('alias /admin mở cổng quản trị mới', async () => {
  const r = await get('/admin'); assert.equal(r.status, 302); assert.equal(r.headers.location, '/admin/index.html');
  const page = await get('/admin/index.html'); assert.equal(page.status, 200); assert.match(page.body, /Quản trị/u);
});
```

- [ ] **Step 6: Sửa `public/sw.js`**: `CACHE_VERSION = "mio-v4"`; thêm `url.pathname.indexOf("/admin/") !== 0` vào điều kiện dòng 34 và `|| url.pathname.indexOf("/admin/") === 0` vào điều kiện `return` dòng 56. Sửa `netlify.toml`: thêm khối `[[headers]] for = "/admin/*"` với `Cache-Control = "no-cache"` (đọc cấu trúc headers sẵn có trong file để đặt đúng chỗ).

- [ ] **Step 7: Chạy toàn bộ kiểm tra**

Run: `npm run check && node --test tests/admin-portal.test.mjs tests/dev-server.test.mjs tests/project-integrity.test.mjs`
Expected: PASS; `project-integrity` vẫn `checkedFiles >= 35`.

- [ ] **Step 8: Commit**

```bash
git checkout -b feat/admin-portal
git add public/admin scripts/check-project.mjs scripts/lib/dev-server.mjs public/sw.js netlify.toml tests/admin-portal.test.mjs tests/dev-server.test.mjs
git commit -m "admin: shell tĩnh public/admin, tích hợp check-project, dev-server, sw.js"
```

### Task 2: `core/api.js` + `core/router.js` (thuần, test offline)

**Files:**
- Create: `public/admin/core/api.js`, `public/admin/core/router.js`
- Test: `tests/admin-core.test.mjs` (mới)
- Modify: `scripts/check-project.mjs` (thêm 2 file vào `ADMIN_MODULE_FILES`), `package.json` script `test` (thêm `tests/admin-core.test.mjs tests/admin-portal.test.mjs`)

**Interfaces:**
- Produces `api.js`: `export class ApiError extends Error { code: string; status: number; details?: unknown }`; `export function createApi({ fetch = globalThis.fetch, getToken, baseUrl, onUnauthorized, timeoutMs = 15000 }) → { get(path, opt?), post(path, body?, opt?), patch(path, body?, opt?), put(path, body?, opt?), del(path, opt?) }`; `opt = { signal? }`. Thành công: trả `payload.data`. Lỗi: ném `ApiError` với `code` = `payload.error.code` hoặc `NETWORK` / `BAD_RESPONSE` / `TIMEOUT` / `AUTH_INVALID_TOKEN` (khi 401 không có code); thông điệp tiếng Việt: `NETWORK: 'Không kết nối được máy chủ.'`, `BAD_RESPONSE: 'Máy chủ trả dữ liệu không hợp lệ.'`, `TIMEOUT: 'Máy chủ phản hồi quá lâu.'`, `AUTH_INVALID_TOKEN|AUTH_MISSING_TOKEN: 'Phiên đăng nhập đã hết hạn.'`, `AUTH_FORBIDDEN: 'Bạn không có quyền thực hiện.'`; code khác dùng `payload.error.message`. Khi status 401: gọi `onUnauthorized()` một lần rồi ném. Không có token → ném `AUTH_MISSING_TOKEN` không gọi fetch.
- Produces `router.js`: `export function parseHash(hash) → { screen: string, params: Record<string,string> }` (`''`/`'#'`/`'#/'` → `{screen:'today', params:{}}`; `'#/orders?page=2&status=ready'` → `{screen:'orders', params:{page:'2',status:'ready'}}`; screen chỉ `[a-z0-9_-]`, ký tự khác → `today`); `export function buildHash(screen, params = {}) → string`; `export function createRouter({ onChange }) → { start(), navigate(screen, params), current() }` (nghe `hashchange`).

- [ ] **Step 1: Viết test trong `tests/admin-core.test.mjs`**

```js
test('parseHash: rỗng → today; có query → params', ...)   // 4 assert như Interfaces
test('buildHash encode giá trị', () => assert.equal(buildHash('orders', { q: 'a b' }), '#/orders?q=a%20b'));
test('api: thành công bóc data', ...)                      // fetch giả trả {success:true,data:{x:1}} → {x:1}
test('api: mạng lỗi → NETWORK', ...)                       // fetch reject → ApiError.code === 'NETWORK'
test('api: JSON hỏng → BAD_RESPONSE', ...)                 // res.json() reject, status 200
test('api: 401 → AUTH_INVALID_TOKEN + onUnauthorized', ...) // gọi đúng 1 lần
test('api: {success:false} giữ code backend', ...)        // {error:{code:'VALIDATION_ERROR',message:'x'}} → code, message 'x'
test('api: không token → AUTH_MISSING_TOKEN, không gọi fetch', ...)
test('api: timeout → TIMEOUT', ...)                        // fetch tôn trọng signal abort; timeoutMs 10
```

- [ ] **Step 2: Chạy test, xác nhận FAIL** — Run: `node --test tests/admin-core.test.mjs` → FAIL (module không tồn tại).

- [ ] **Step 3: Cài đặt `api.js`, `router.js` theo Interfaces** (timeout bằng `AbortController` riêng, gộp với `opt.signal` nếu có).

- [ ] **Step 4: Chạy test** — Run: `node --test tests/admin-core.test.mjs` → PASS 9/9.

- [ ] **Step 5: Cập nhật `ADMIN_MODULE_FILES`, script `test` trong package.json; chạy `npm run check`** → PASS.

- [ ] **Step 6: Commit** — `git commit -m "admin: lớp api và hash router có test offline"`

### Task 3: `core/ui.js`, `core/format.js`, `core/vi.js`, `core/table.js`

**Files:**
- Create: `public/admin/core/ui.js`, `public/admin/core/format.js`, `public/admin/core/vi.js`, `public/admin/core/table.js`
- Test: `tests/admin-core.test.mjs` (thêm), `scripts/check-project.mjs` (thêm 4 file)

**Interfaces:**
- `ui.js`: `html(strings, ...values)` → chuỗi, escape `& < > " '` cho mọi value trừ `Raw`; `raw(str)` → `Raw`; `esc(v)`; `toast(message, kind = 'ok')` (thêm `.v2toast` vào `#toasts`, tự xóa sau 3200 ms); `confirm({ title, body, danger?, reasonRequired?: boolean, reasonLabel?, confirmText? }) → Promise<{ ok: boolean, reason?: string }>` (khi `reasonRequired` nút xác nhận disabled tới khi `reason.trim().length >= 3`); `drawer.open(htmlString, { title }) / drawer.close()`; `delegate(root, event, selector, handler)` → hàm gỡ; `loading(container, text = 'Đang tải…')` (skeleton 3 dòng), `empty(container, text, hint?)`, `error(container, err, retry)` (nút "Thử lại", in `err.code` nhỏ). Các hàm DOM chỉ chạy khi có `document` (test node không gọi chúng).
- `format.js`: `vnd(n) → '65.000đ'`, `dt(iso) → 'HH:mm dd/MM'`, `stamp(iso) → 'yyyy-MM-dd HH:mm'` (chép `stamp` từ HTML cũ dòng 1811), `maskPhone('0901234567') → '090***567'`, `left(deadlineIso, now = Date.now()) → { text: 'còn 22 phút' | 'Đã hết hạn', level: 'ok'|'warn'|'err' }` (warn ≤ 30 phút, err ≤ 15 phút; chép ngưỡng từ `admin-v2.js` hàm `left` dòng 256).
- `vi.js`: `export const VI = { order: { awaiting_payment:['Chờ thanh toán','m'], pending:['Chờ cửa hàng nhận','w'], confirmed:['Cửa hàng đã nhận','i'], ready:['Sẵn sàng lấy','i'], completed:['Hoàn thành','ok'], cancelled:['Đã hủy','m'], no_show:['Khách vắng mặt','e'] }, complaint: { open:['Chờ cửa hàng','w'], in_review:['Chờ Admin','e'], resolved:['Đã hoàn tiền','ok'], rejected:['Đã bác bỏ','m'] }, withdrawal: { requested:['Chờ duyệt','w'], approved:['Đã duyệt','i'], processing:['Đang chuyển','i'], paid:['Đã chuyển','ok'], failed:['Chuyển lỗi','e'], rejected:['Từ chối','m'] }, payoutAccount: { pending_verification:['Chờ xác minh','w'], verified:['Đã xác minh','ok'], rejected:['Từ chối','m'], replaced:['Đã thay','m'] }, label: { green:['Xanh −20%','ok'], yellow:['Vàng −50%','w'], red:['Đỏ −80%','e'] }, ledger: { charge:'Khách trả (giữ chờ)', release:'Giải ngân cửa hàng', refund:'Hoàn khách', refund_clawback:'Thu hồi từ cửa hàng', withdraw:'Rút tiền', adjustment:'Điều chỉnh tay' }, fraud: { high_cancel_rate:'Hủy nhiều', repeat_no_show:'Vắng mặt lặp lại', long_pending_payment:'Treo thanh toán', shared_ip:'Nhiều tài khoản cùng mạng' }, severity: { high:['Cao','e'], medium:['Trung bình','w'], low:['Thấp','m'] } }`; `badge(group, code) → htmlString '<span class="b b-x">Chữ</span>'` (code lạ → hiện code trong `.b-m`, KHÔNG ném).
- `table.js`: `dataTable({ columns: [{ key, label, render?(row), sort?: boolean }], rows, pageSize = 20, sort?: { key, dir }, emptyText }) → { html(): string, state }` thuần; sort/phân trang trong bộ nhớ; nút trang dùng `data-act="page" data-page="n"`.

- [ ] **Step 1: Thêm test**

```js
test('html escape và raw', () => { assert.equal(html`<b>${'<x>'}</b>`, '<b>&lt;x&gt;</b>'); assert.equal(html`${raw('<i>ok</i>')}`, '<i>ok</i>'); });
test('vnd/dt/maskPhone/left', () => { assert.equal(vnd(65000), '65.000đ'); assert.equal(maskPhone('0901234567'), '090***567'); assert.equal(left(new Date(Date.now()+10*60000).toISOString()).level, 'err'); });
test('vi.badge mã lạ không ném', () => assert.match(badge('order', 'weird'), /b-m/));
test('dataTable sort + phân trang', ...)  // 45 dòng, pageSize 20 → trang 3 có 5 dòng; sort desc theo total
```

- [ ] **Step 2: Chạy, xác nhận FAIL.** - [ ] **Step 3: Cài đặt 4 file.** - [ ] **Step 4: Chạy test PASS; `npm run check` PASS.** - [ ] **Step 5: Commit** `"admin: ui kit, format, từ vựng tiếng Việt, bảng dữ liệu"`

### Task 4: `core/poll.js` (lịch poll chung)

**Files:**
- Create: `public/admin/core/poll.js`; Test: `tests/admin-core.test.mjs` (thêm, dùng `mock.timers` của node:test)

**Interfaces:**
- `export function createPoll({ now = Date.now, visible = () => true, idleMs = 900000, minGapMs = 10000, demo = false }) → { add(name, fn, { everyMs, idleMs? }), remove(name), touch(), tick(resume=false), pause(), resume(), isPaused(), attach(document, window) }`. `tick()` chạy job khi `visible() && !idle && now - last >= everyMs` (hoặc `>= minGapMs` khi `resume`). Rảnh ≥ `idleMs` → `isPaused() === true`, không chạy job, gọi `onPaused(true)` một lần; `touch()` khi đang paused → `tick(true)` ngay và `onPaused(false)`. `attach` nghe `pointerdown/keydown/touchstart` (capture, passive) → `touch`; `visibilitychange` hiện lại → `tick(true)`; heartbeat `setInterval(tick, 5000)` (đây là `setInterval` duy nhất cho phép). `demo=true` → không chạy gì.

- [ ] **Step 1: Test**: (a) job `everyMs 60000` chạy ở 0s, không chạy ở 30s, chạy ở 60s; (b) `visible=false` → không chạy; (c) rảnh 15 phút → paused, job không chạy; `touch()` → chạy ngay, không paused; (d) hai `tick(true)` cách 3 giây → job chạy 1 lần (minGap); (e) `demo=true` → 0 lần.
- [ ] **Step 2: FAIL.** - [ ] **Step 3: Cài đặt.** - [ ] **Step 4: PASS.** - [ ] **Step 5: Commit** `"admin: lịch poll chung dừng khi tab ẩn/rảnh 15 phút"`

### Task 5: `core/auth.js`, `core/state.js`, `core/shell.js`, `core/app.js`, `screens/manifest.js`, `screens/_pending.js`

**Files:**
- Create: 6 file trên; Modify: `scripts/check-project.mjs` (thêm), `tests/admin-portal.test.mjs` (thêm guard tĩnh)

**Interfaces:**
- `auth.js`: `createAuth({ supabaseUrl, supabaseKey })` (đọc từ `window.FOODSAVE_SUPABASE_URL/KEY` hoặc cùng cách `ADMIN_FOODSAVE.html` dòng 8-11 lấy; implementer đọc và chép) → `{ signIn(email, password) → Promise<{ ok, message? }>, signOut(), getToken() → Promise<string|null>, refresh() → Promise<boolean>, onChange(cb(session|null)), ensureAdmin(api) → Promise<{ id, full_name, email } | null> }`. `ensureAdmin` gọi `api.get('/profile/me')`, hợp lệ khi `role === 'admin' && status !== 'suspended'`, ngược lại `signOut()` và trả `null`. Thông điệp sai mật khẩu: `'Email hoặc mật khẩu không đúng.'`.
- `state.js`: `createState() → { admin, work, demo, set(key, value), subscribe(fn) }`.
- `manifest.js`: `export const GROUPS = ['HÔM NAY','CẦN QUYẾT ĐỊNH','HỒ SƠ','HOẠT ĐỘNG','TĂNG TRƯỞNG','HỆ THỐNG']`; `export const SCREENS = [ { id:'today', title:'Hôm nay', group:'HÔM NAY', badge: w => n(w.verification_pending)+n(w.complaints_waiting_admin)+n(w.withdrawals_requested)+n(w.payout_accounts_pending)+n(w.fraud_open), load: () => import('./today.js') }, …19 mục đúng thứ tự spec mục 3; mục chưa làm: `load: () => import('./_pending.js')` ]` với `const n = v => Number(v) || 0` (các trường `withdrawals_requested`, `payout_accounts_pending`, `automation_failed`, `ledger_unbalanced` chỉ có sau Task 8; trước đó huy hiệu là 0, không NaN). Huy hiệu: `complaints→complaints_waiting_admin`, `verify→verification_pending+payout_accounts_pending`, `payouts→withdrawals_requested`, `alerts→fraud_open`, `ledger→ledger_unbalanced`, `rules→automation_failed`, `marketing→marketing_queue`.
- `_pending.js`: `export default { id:'_pending', title:'Chưa nối API', render(container, ctx) }` hiện: "Màn này chưa có trên cổng mới. Mở bản cũ" + link `/quan-tri` (không chép dữ liệu mẫu).
- `shell.js`: `mountShell({ root, screens, groups, state, navigate }) → { setActive(id), setBadges(work), setAdmin(admin), setPaused(bool) }`; sidebar `.S-n` với `.S-s` nhóm và `.S-i[data-p=id]` + `<em data-badge=id>`; topbar: `<h2 id="pt">`, ô tìm (`#globalSearch`, phím `/` focus; Đợt 0 chỉ gợi ý tên màn), chuông (`#bell`, mở drawer 20 dòng `GET /admin/audit-log?limit=20`), user box + nút Đăng xuất; thanh `.poll-paused` "Đã tạm dừng cập nhật — bấm để tiếp tục".
- `app.js`: bootstrap: `DEMO` → `const { createDemoApi } = await import('../demo/index.js')` (Task 6) thay `createApi`; tạo `poll`; `auth.onChange`; nếu không có phiên → hiện `#login`; `ensureAdmin` ok → `document.body.classList.remove('admin-locked')`, `mountShell`, `router.start()`; job `poll.add('work', () => api.get('/admin/dashboard/work').then(setBadges), { everyMs: 60000 })`; `ctx = { api, ui, state, poll, params, navigate, signal, refreshWork }`; chuyển màn: `prev.destroy?.()`, `abort()`, `poll.remove('screen:*')`, `screen.innerHTML=''`, `await mod.default.render(container, ctx)`; lỗi import → `ui.error`.

- [ ] **Step 1: Thêm guard tĩnh vào `tests/admin-portal.test.mjs`**

```js
test('chỉ core/auth.js được dùng supabase', ...)       // quét public/admin/**/*.js: /supabase|createClient\(/ chỉ ở core/auth.js
test('screens không có onclick= và setInterval', ...)   // /on(click|change|submit)=/ và /setInterval|setTimeout\(.*,\s*\d{4,}/ không có trong screens/*.js
test('manifest 19 màn, mỗi màn có file hoặc _pending', ...) // import('../public/admin/screens/manifest.js'), kiểm 19 id đúng thứ tự spec, group ∈ GROUPS
```

- [ ] **Step 2: FAIL.** - [ ] **Step 3: Cài đặt 6 file.** - [ ] **Step 4: `node --test tests/admin-portal.test.mjs tests/admin-core.test.mjs` PASS; `npm run check` PASS.**
- [ ] **Step 5: Thử tay**: `node scripts/dev.mjs --port 5517` → mở `http://127.0.0.1:5517/admin/` → thấy form đăng nhập; đăng nhập admin thật (nếu có `.env`/backend) → sidebar 19 mục, mọi mục ngoài `today/audit` mở màn "Chưa nối API". Ghi kết quả vào commit message.
- [ ] **Step 6: Commit** `"admin: auth, shell, router, manifest 19 màn, màn chờ"`

### Task 6: Lớp demo + helper Playwright + e2e khung

**Files:**
- Create: `public/admin/demo/index.js`, `public/admin/demo/fixtures/{work,audit,finance,labels,esg,automation,policy}.js`, `tests/e2e/helpers/fake-supabase.mjs`, `tests/e2e/admin-portal.spec.mjs`
- Modify: `tests/e2e/admin-tracking.spec.mjs:9-31` (thay khối `FAKE_SUPABASE` bằng `import { FAKE_SUPABASE } from './helpers/fake-supabase.mjs'`)

**Interfaces:**
- `demo/index.js`: `createDemoApi() → cùng giao diện createApi`; map `METHOD path` → fixture; `POST/PATCH/PUT` cập nhật trạng thái trong bộ nhớ và trả `{ ok: true }`; đường dẫn lạ → ném `ApiError('RESOURCE_NOT_FOUND', 'Chưa có dữ liệu mẫu cho ' + path, 404)`. Auth demo: `app.js` khi `DEMO` bỏ qua `#login`, `admin = { full_name: 'Quản trị viên (xem thử)' }`, hiện thanh `.v2demo` "Chế độ xem thử · dữ liệu mẫu".
- Fixtures: `export default { ... }` đúng shape API thật (đọc `adminOpsService.workStrip`, `adminAuditService.list`, `ledgerService.financeSummary`, `labelOverview`, `esgReport`, `automationRunService.overview`, `adminController.orderPolicy` để lấy tên trường).
- `helpers/fake-supabase.mjs`: `export const FAKE_SUPABASE` (chuỗi JS y hệt khối hiện tại dòng 9-31 của `admin-tracking.spec.mjs`) và `export async function stubAdmin(page, { api }) ` cài `page.route('**/@supabase/supabase-js**')` + `page.route('**/api/v1/**', api)` + gom `pageerror`/`console.error` → mảng `errors`.

- [ ] **Step 1: Viết `tests/e2e/admin-portal.spec.mjs`**

```js
test('shell: 19 mục sidebar, huy hiệu từ dashboard/work, không lỗi console', ...)   // goto '/admin/index.html#/today'; expect .S-i count 19; em[data-badge=complaints] text '3'
test('401 → màn đăng nhập, giữ hash, đăng nhập lại quay về #/audit', ...)
test('500 ở màn → hiện nút Thử lại, bấm → gọi lại API', ...)
test('?demo=1 → không gọi API thật, hiện thanh xem thử', ...)                     // đếm route '**/api/v1/**' === 0
```

- [ ] **Step 2: `npx playwright test tests/e2e/admin-portal.spec.mjs` → FAIL.** - [ ] **Step 3: Cài đặt demo + helper; refactor `admin-tracking.spec.mjs` dùng helper.** - [ ] **Step 4: `npx playwright test tests/e2e/admin-portal.spec.mjs tests/e2e/admin-tracking.spec.mjs` → PASS.** - [ ] **Step 5: Commit** `"admin: chế độ xem thử, helper Playwright dùng chung, e2e khung"`

### Task 7: Nền backend: schema list, phân trang, mount routes admin mới, test harness

**Files:**
- Create: `src/schemas/adminSchemas.ts`, `src/services/adminListing.ts`, `src/routes/admin/index.ts`, `scripts/test-admin-api.js`
- Modify: `src/utils/requestContext.ts` (thêm `auditActor`), `src/controllers/adminController.ts:22-25` (import `auditActor` thay bản cục bộ), `src/services/adminOpsService.ts:18-24` (`loadNames` → import `loadByIds` từ adminListing), `src/routes/adminRoutes.ts` (cuối file `adminRoutes.use(adminPortalRoutes)`), `scripts/fake-supabase.js:183` (`range` offset thật), thêm stub `auth.admin`, `package.json` script `"test:admin": "tsc && node scripts/test-admin-api.js"`

**Interfaces:**
- `adminSchemas.ts`: `export const sanitizeSearch = (q: string) => q.replace(/[,()%\\]/g, ' ').trim().slice(0, 80)`; `export const adminListQuerySchema = <S extends readonly string[]>(opts: { sortKeys: S; statusEnum?: z.ZodEnum<any>; extra?: z.ZodRawShape }) => paginationQuerySchema.extend({ q: z.string().trim().max(80).optional(), status: opts.statusEnum?.optional(), sort: z.enum(opts.sortKeys).optional(), ...opts.extra }).strict()`.
- `adminListing.ts`: `export interface ListResult<T> { items: T[]; total: number; page: number; limit: number }`; `export async function paginate<T>(query, { page, limit }): Promise<ListResult<T>>` (dùng `.range((page-1)*limit, page*limit-1)` và `count: "exact"` đã đặt ở `select`); `export function applySearch(query, q: string | undefined, columns: string[])` → `query.or(columns.map(c => `${c}.ilike.%${sanitizeSearch(q)}%`).join(','))` khi `q`; `export async function loadByIds(table, ids, columns): Promise<Map<string, Row>>` (chép từ `loadNames`); `export const maskPhone` re-export từ `partnerOpsService`.
- `requestContext.ts`: `export const auditActor = (req): { userId: string; name: string | null }` (chép từ adminController dòng 22-25).
- `src/routes/admin/index.ts`: `export const adminPortalRoutes = Router()`; hiện rỗng, chỉ `adminPortalRoutes.get("/_portal/health", (_req,res) => sendSuccess(res, { ok: true }))` để test mount.
- `fake-supabase.js`: `range(from, to) { this.offsetN = from; this.limitN = to - from + 1; return this; }` và áp `offsetN` trong `run()`; `supabaseAdmin.auth.admin = { createUser, getUserById, deleteUser, listUsers }` lưu vào bảng giả `auth_users` (chỉ cần cho đợt sau, nhưng thêm ngay cùng test).
- `scripts/test-admin-api.js`: chép khung đầu `scripts/test-order-flow.js` (env giả, `FakeDb`, require từ `dist/`), hàm `run(name, fn)` + `expect`, tổng kết số kịch bản.

- [ ] **Step 1: Viết kịch bản A1-A4 trong `scripts/test-admin-api.js`**: A1 `adminListQuerySchema({sortKeys:['created_at.desc']}).parse({page:'2',limit:'10',q:'a,(b)%'})` → `q` giữ nguyên ở schema, `sanitizeSearch` trả `'a  b '.trim()`; A2 `limit:'101'` ném ZodError; A3 `paginate` trên FakeDb 45 dòng, page 3 limit 20 → 5 items, total 45; A4 `GET /admin/_portal/health` qua controller/route giả (gọi handler) trả `{ok:true}`.
- [ ] **Step 2: `npm run test:admin` → FAIL (module chưa có).** - [ ] **Step 3: Cài đặt.** - [ ] **Step 4: `npm run typecheck && npm run test:order && npm run test:admin` → PASS (79/79 + 4/4).** - [ ] **Step 5: Commit** `"backend: schema list chuẩn, phân trang, mount routes admin mới, test harness"`

### Task 8: Mở rộng `workStrip` và bộ lọc `audit-log`

**Files:**
- Modify: `src/services/adminOpsService.ts:316-338` (workStrip), `src/services/adminAuditService.ts` (list có filter), `src/routes/adminRoutes.ts:74` (query schema audit-log), `src/controllers/adminController.ts:88-91`
- Test: `scripts/test-admin-api.js` (B1-B3)

**Interfaces:**
- `workStrip()` trả thêm (giữ mọi trường cũ): `withdrawals_requested`, `payout_accounts_pending` (tách từ `withdrawals_pending`, vẫn trả `withdrawals_pending` = tổng), `orders_today: { new, completed, no_show }` (theo ngày giờ VN: `created_at`/`completed_at`/`updated_at` ≥ 00:00 +07:00 hôm nay), `donations_open` (status `open`), `tracking_active` (đếm `live_locations` có `updated_at` trong 30 phút; lỗi/bảng chưa có → 0), `ledger_unbalanced` (0/1 từ `ledgerService.reconcile().balanced`, lỗi → 0), `automation_failed` (số job có `last_error` trong `automationRunService.overview()`, lỗi → 0).
- `adminAuditService.list(limit, filter?: { action?: string; actor_id?: string; target_type?: string; target_id?: string; from?: string; to?: string })`: `action` prefix match (`ilike action%`).
- Route `GET /admin/audit-log` query: `limit` (cũ) + 6 trường tùy chọn (`from/to` `z.string().datetime({offset:true})`), `.strict()`; shape trả không đổi (mảng).

- [ ] **Step 1: Kịch bản B1** `workStrip` trên FakeDb có 2 withdrawals requested + 1 payout_account pending → `withdrawals_requested 2`, `payout_accounts_pending 1`, `withdrawals_pending 3`; B2 `orders_today` đếm đúng theo mốc 00:00 +07; B3 `list(100, { action: 'verification.' , target_id })` chỉ trả đúng dòng.
- [ ] **Step 2: FAIL.** - [ ] **Step 3: Cài đặt.** - [ ] **Step 4: typecheck + test:order + test:admin PASS.** - [ ] **Step 5: Commit** `"backend: workStrip thêm số hôm nay, tách rút tiền; audit-log có bộ lọc"`

### Task 9: Màn `today` (Hôm nay) + `audit` (Nhật ký) + e2e ngân sách poll

**Files:**
- Create: `public/admin/screens/today.js`, `public/admin/screens/audit.js`, `tests/e2e/admin-portal-polling-budget.spec.mjs`
- Modify: `public/admin/demo/fixtures/work.js` (shape mới Task 8), `tests/e2e/admin-portal.spec.mjs` (thêm 2 test)

**Interfaces:**
- `today.js`: `render` gọi song song `api.get('/admin/dashboard/work')`, `'/admin/finance/summary'`, `'/admin/labels'`, `'/admin/esg?month=YYYY-MM'`, `'/admin/automation'`; vẽ theo sơ đồ spec mục 4 (khối VIỆC CẦN LÀM 3 mức: Đỏ = `complaints_waiting_admin` + `withdrawals_requested`; Vàng = `verification_pending` + `payout_accounts_pending` + `fraud_open` (mức Cao); Xám = `customers_locked` + `automation_failed`); mỗi dòng `data-act="go" data-screen="…"` → `ctx.navigate`; 4 ô số (Tiền đang giữ / Hôm nay / Tháng này / Hàng theo nhãn); đăng ký `ctx.poll.add('screen:today', draw, { everyMs: 60000 })`. Mỗi khối lỗi riêng → `ui.error` cục bộ, các khối khác vẫn vẽ.
- `audit.js`: bộ lọc (hành động prefix, loại đối tượng, từ/đến ngày), bảng `dataTable` 100 dòng mới nhất, `detail` hiện JSON rút gọn trong `<details>`; `data-act="filter"`.

- [ ] **Step 1: e2e thêm vào `admin-portal.spec.mjs`**: (a) `#/today` hiện 3 khối mức, dòng khiếu nại bấm → hash `#/complaints`; (b) `#/audit` lọc `action=verification.` → request có `?limit=100&action=verification.`; (c) `today` với `finance/summary` 500 → khối Tiền hiện Thử lại, khối Việc vẫn có dữ liệu.
- [ ] **Step 2: Viết `admin-portal-polling-budget.spec.mjs`** theo mẫu `tests/e2e/portal-polling-budget.spec.mjs`: dùng `page.clock`; mở `#/today`, đếm request `/api/v1/**` trong 5 phút giả lập khi có thao tác (kỳ vọng ≤ 12: work 5 + today 5 + lần đầu); tab ẩn 5 phút → 0 thêm; rảnh 15 phút → 0 thêm và thấy `.poll-paused`; bấm → tối đa 2 request ngay.
- [ ] **Step 3: FAIL.** - [ ] **Step 4: Cài đặt 2 màn.** - [ ] **Step 5: `npx playwright test tests/e2e/admin-portal*.spec.mjs` PASS; `npm run check` PASS.** - [ ] **Step 6: Commit** `"admin: màn Hôm nay và Nhật ký, test ngân sách poll"`

### Task 10: Tách `adminSettingsService` khỏi `marketingService`

**Files:**
- Create: `src/services/adminSettingsService.ts`; Modify: `src/services/marketingService.ts:247-256` (xóa `getAppSetting/setAppSetting` cục bộ, import từ service mới); Test: `scripts/test-admin-api.js` (C1)

**Interfaces:** `export const adminSettingsService = { get<T>(key: string, fallback: T): Promise<T>, set(key: string, value: unknown, actor?: AuditActor): Promise<void> }` (hành vi y hệt hàm cũ; `set` có `actor` thì ghi audit `settings.update` với `{ key, before, after }`).

- [ ] **Step 1: C1**: `set('ai_agent', {enabled:false}, actor)` → `get('ai_agent')` trả đúng, `admin_audit_log` có 1 dòng `settings.update`; `marketingService.adminSetSettings` vẫn chạy (gọi và đọc lại).
- [ ] **Step 2: FAIL.** - [ ] **Step 3: Cài đặt.** - [ ] **Step 4: typecheck + test:order + test:admin PASS.** - [ ] **Step 5: Commit** `"backend: tách adminSettingsService dùng chung"`

---

## Đợt 1: Cần quyết định (chuyển cơ học từ `admin-v2.js`)

Quy tắc chung cho Task 11-16: chép hàm vẽ từ `public/frontend/admin-v2.js` (dòng ghi ở từng task) gần nguyên văn; chỉ đổi: `window.X =` → hàm cục bộ; `onclick="X(...)"` → `data-act="x" data-id="..."` + `ui.delegate`; `rerender(key)` → `draw()`; `prompt/confirm/alert` → `await ctx.ui.confirm({ reasonRequired })`; `api(path, opt)` → `ctx.api.get/post/patch/put`; nhãn trạng thái → `badge()` của `core/vi.js`; `setInterval` → `ctx.poll.add('screen:<id>', …)`. Sau mỗi hành động: `ctx.ui.toast(...)`, `draw()`, `ctx.refreshWork()`. Mỗi màn thêm fixture demo tương ứng và cập nhật `MIGRATED` ở Task 17.

### Task 11: Màn `complaints` (gộp Trung tâm khiếu nại + Tranh chấp)

**Files:** Create `public/admin/screens/complaints.js`, `public/admin/demo/fixtures/complaints.js`; Test: `tests/e2e/admin-portal.spec.mjs`
**Nguồn:** `admin-v2.js` dòng 250-402 (`CMP`, `cmpLoad`, `cmpCode`, `stBadge`, `pg.hub`, `pg.disputes`, form quyết định, chat chỉ đọc `GET /orders/:id/messages`).
**Interfaces:** 3 cột `open` / `in_review` / `resolved|rejected` (tab lọc trên mobile); drawer hồ sơ: ảnh (`<img>` chỉ khi URL bắt đầu `https://`), phản hồi cửa hàng, chat (nếu API trả `CHAT_FORBIDDEN` hiện "Chỉ xem được chat khi đơn có khiếu nại"), form quyết định: `refund_full` / `refund_partial` (`refund_cents` 1..total-1) / `reject` (+ checkbox `is_false_claim`), `note` ≥ 3 ký tự bắt buộc → `POST /admin/complaints/:id/decision`. Khối "5 ô tổng quan" và "3 cửa hàng bị khiếu nại nhiều nhất" của `pg.disputes` đặt ở đầu màn.

- [ ] **Step 1: e2e**: (a) cột Chờ Admin có 1 thẻ từ fixture; (b) mở drawer, chọn Bác bỏ với note rỗng → nút disabled; nhập `'Ảnh không khớp <b>đơn</b>'` → request body `{decision:'reject', note:'Ảnh không khớp <b>đơn</b>'}`; drawer hiện note đã escape (không có thẻ `<b>` thật trong DOM); (c) `refund_partial` với `refund_cents` ≥ total → không gửi.
- [ ] **Step 2: FAIL.** - [ ] **Step 3: Cài đặt.** - [ ] **Step 4: PASS + `npm run check`.** - [ ] **Step 5: Commit** `"admin: màn Khiếu nại (gộp trung tâm khiếu nại và tranh chấp)"`

### Task 12: Màn `verify` (Duyệt hồ sơ)

**Files:** Create `screens/verify.js`, `demo/fixtures/verify.js`
**Nguồn:** `admin-v2.js` dòng 555-571 (`Page('verification', …)`), phần tài khoản nhận tiền trong `pg.finance` dòng 138-249 (`FIN.acc`, `PATCH /admin/payout-accounts/:id`).
**Interfaces:** 3 tab: Cửa hàng (`GET /admin/verification` → `stores`), Tổ chức (`charities`), Tài khoản nhận tiền (`GET /admin/payout-accounts?status=pending_verification`); hành động Duyệt (`decision:'approve'`) / Từ chối (`reason` bắt buộc ≥ 3) → `POST /admin/verification/:kind/:id/decision`; TK: Xác minh / Từ chối → `PATCH /admin/payout-accounts/:id {decision:'verify'|'reject', note}`; cảnh báo "tên lệch" khi `holder_name` ≠ tên chủ (chép điều kiện từ `FIN` cũ); lịch sử 30 dòng (`history`).

- [ ] **Step 1: e2e**: Từ chối cửa hàng không lý do → bị chặn; có lý do → body đúng, toast "Đã từ chối", huy hiệu `verify` giảm sau `refreshWork` (fixture work đổi).
- [ ] **Step 2-5:** FAIL → cài đặt → PASS → Commit `"admin: màn Duyệt hồ sơ (cửa hàng, tổ chức, tài khoản nhận tiền)"`

### Task 13: Màn `payouts` (Rút tiền & chi trả)

**Files:** Create `screens/payouts.js`, `demo/fixtures/payouts.js`
**Nguồn:** `admin-v2.js` dòng 138-249 phần `FIN.wd` (lệnh rút, `PATCH /admin/withdrawals/:id` với `decision: approve|reject|start|pay|fail`, `bank_txn_ref` khi `pay`, `POST /admin/withdrawals/:id/reveal-account`).
**Interfaces:** tab theo trạng thái (`requested` mặc định); drawer: thông tin cửa hàng, TK che 4 số cuối, nút "Hiện số đầy đủ (ghi nhật ký)" → `reveal-account` hiện 60 giây rồi che lại; nút theo trạng thái: `requested` → Duyệt/Từ chối(lý do); `approved` → Bắt đầu chi; `processing` → Đã chi (bắt buộc `bank_txn_ref` 3..80) / Thất bại (lý do).

- [ ] **Step 1: e2e**: `pay` không mã GD → chặn; có mã → body `{decision:'pay', bank_txn_ref:'FT123'}`; reveal → request POST và số hiện rồi che sau 60 giây (clock).
- [ ] **Step 2-5:** FAIL → cài đặt → PASS → Commit `"admin: màn Rút tiền & chi trả"`

### Task 14: Màn `alerts` (Cảnh báo gian lận)

**Files:** Create `screens/alerts.js`, `demo/fixtures/alerts.js`
**Nguồn:** `admin-v2.js` dòng 619-646 (`Page('risks', …)`, `POST /admin/fraud-alerts/handle {key,status,note}`), khối `not_detected`.
**Interfaces:** 5 ô lọc (Tổng / Đang mở / Cao / Trung bình / Thấp; bấm ô để lọc, bấm lại bỏ lọc), bảng; hành động Xử lý / Bỏ qua (note tùy chọn ≤ 300); loại cảnh báo qua `VI.fraud`, mức qua `VI.severity`; link "Mở hồ sơ" → `#/customers?id=…` (màn Đợt 2; tới lúc đó rơi vào `_pending`). Khối "Không phát hiện được" giữ nguyên chữ từ API `not_detected`.

- [ ] **Step 1: e2e**: số ở ô "Cao" bằng số dòng sau khi bấm; Xử lý → body `{key, status:'handled'}` và dòng đổi trạng thái không cần reload.
- [ ] **Step 2-5:** FAIL → cài đặt → PASS → Commit `"admin: màn Cảnh báo gian lận"`

### Task 15: Màn `rules` (Quy tắc & tự động)

**Files:** Create `screens/rules.js`, `demo/fixtures/{policy,automation}.js` (policy có từ Task 6)
**Nguồn:** `admin-v2.js` dòng 462-521 (`readPolicyForm`, `policyErrors`, `PUT /admin/order-policy`, `POST /admin/order-policy/reset`), 522-542 (`Page('automation', …)`, `POST /admin/automation/:job/run`).
**Interfaces:** 2 tab. Tab Quy tắc: bảng 3 nhãn × 4 ô số (`payMinutes, pickupMinutes, cancelFreeBeforePickupMinutes, finalReminderMinutes`) + 5 ô chung; kiểm tra client như `policyErrors` (ví dụ hủy miễn phí < hạn lấy hàng); "Lưu cấu hình" → `confirm` → `PUT`; "Khôi phục mặc định" → `confirm(danger)` → `POST reset`; ghi chú `time_scale !== 1`. Tab Tự động: 4 job, lần chạy gần nhất, lỗi gần nhất, số chạy/lỗi 7 ngày, nút "Chạy ngay" → `POST /admin/automation/:job/run`; sau khi chạy `draw()`; `ctx.poll.add('screen:rules', draw, { everyMs: 60000 })` chỉ khi đang ở tab Tự động.

- [ ] **Step 1: e2e**: nhập hủy miễn phí 100 > hạn lấy 90 → báo lỗi, không gửi; hợp lệ → `PUT` body đúng cấu trúc `labels.green…`; "Chạy ngay" label-automation → POST đúng path.
- [ ] **Step 2-5:** FAIL → cài đặt → PASS → Commit `"admin: màn Quy tắc & tự động"`

### Task 16: Màn `vouchers` (Khuyến mãi) + `esg` (Tác động ESG)

**Files:** Create `screens/vouchers.js`, `screens/esg.js`, `demo/fixtures/vouchers.js` (esg có từ Task 6)
**Nguồn:** `admin-v2.js` dòng 572-601 (form tạo voucher `POST /admin/vouchers`, bật/tắt `PATCH /admin/vouchers/:id {is_active}`), 602-618 (`ESGM` tháng, `GET /admin/esg?month=`).
**Interfaces:** vouchers: bảng (mã, tên, giảm, hiệu lực, lượt dùng, trạng thái, cửa hàng/Toàn sàn), form tạo (validate client giống `voucherBodySchema`: mã `^[A-Za-z0-9_-]{3,30}$`, `percent_off` hoặc `fixed_discount_cents` chỉ một, `starts_at < expires_at`), bật/tắt có `confirm`. esg: chọn tháng (`<input type="month">`), 4 ô số + bảng top cửa hàng.

- [ ] **Step 1: e2e**: tạo voucher mã `ab` → chặn; `MIO10` 10% → POST body đúng, `starts_at/expires_at` ISO có offset; đổi tháng → GET `?month=2026-10`.
- [ ] **Step 2-5:** FAIL → cài đặt → PASS → Commit `"admin: màn Khuyến mãi và Tác động ESG"`

### Task 17: Chuyển hướng trang cũ cho các mục đã di trú

**Files:**
- Modify: `public/frontend/admin-v2.js:9-12` (thêm `MIGRATED` + bọc `go`), `public/ADMIN_FOODSAVE.html` (dải thông báo trong `.T` header, dòng ~414)
- Test: `tests/e2e/admin-tracking.spec.mjs` (không hồi quy), `tests/e2e/admin-portal.spec.mjs` (thêm 1 test)

**Interfaces:** `var MIGRATED = { hub: 'complaints', disputes: 'complaints', verification: 'verify', finance: 'payouts', payouts: 'payouts', risks: 'alerts', policy: 'rules', automation: 'rules', vouchers: 'vouchers', esg: 'esg', audits: 'audit', dashboard: null }` (giá trị `null` = chưa chuyển); bọc `go(p)`: nếu `MIGRATED[p]` → `location.href = '/admin/index.html#/' + MIGRATED[p]`; `dashboard` giữ trang cũ (Đợt 4 mới chuyển). Dải: "Cổng quản trị mới đang thay dần trang này — Mở cổng mới" (link `/admin/`), có nút đóng nhớ `sessionStorage 'mio.admin.newPortalBanner'`. Mục `tracking`, `agent`, `merchants`, `charities`, `sysusers`, `users`, `reputation`, `inventory`, `donations`, `orders`, `payments`, `admins`, `config` vẫn chạy ở trang cũ.

- [ ] **Step 1: e2e** trong `admin-portal.spec.mjs`: mở `/quan-tri` (stub như `admin-tracking`), bấm `.S-i[data-p="hub"]` → URL kết thúc `/admin/index.html#/complaints`; bấm `.S-i[data-p="tracking"]` → vẫn ở trang cũ (không đổi URL).
- [ ] **Step 2: FAIL.** - [ ] **Step 3: Cài đặt.** - [ ] **Step 4: `npx playwright test` (toàn bộ) PASS; `npm run check`; `npm test` PASS.** - [ ] **Step 5: Commit** `"admin: chuyển hướng mục đã di trú sang cổng mới"`

### Task 18: Tài liệu bàn giao Đợt 0-1

**Files:** Modify `HANDOFF.md` (thêm mục "Cập nhật 2026-11-xx: cổng quản trị mới /admin (Đợt 0-1)"), `docs/PROJECT_STRUCTURE.md` (thêm `public/admin/` vào bảng vai trò), `README.md` (dòng chạy `/admin/`).

Nội dung HANDOFF bắt buộc: cách mở (`/admin/`, `?demo=1`), phiên dùng chung với `/quan-tri`, 7 màn đã chuyển + bảng `MIGRATED`, ràng buộc poll và số lượt đo được từ `admin-portal-polling-budget.spec.mjs`, lệnh test (`npm run check`, `npm test`, `npm run test:admin`, `npx playwright test tests/e2e/admin-portal*.spec.mjs`), việc còn lại = Đợt 2-4 theo spec, không có SQL mới ở đợt này.

- [ ] **Step 1: Viết tài liệu.** - [ ] **Step 2: `npm run check && npm test && npm run test:order && npm run test:admin && npx playwright test` tất cả PASS; dán số kịch bản vào HANDOFF.** - [ ] **Step 3: Commit** `"docs: bàn giao cổng quản trị mới Đợt 0-1"`

---

## Tự kiểm tra plan (đã chạy)

- Phủ spec: mục 4 (kiến trúc frontend) → Task 1-6, 9; mục 5 dòng "Hôm nay", "Nhật ký", "Rút tiền" → Task 8; "Cài đặt › Hệ thống" phần tách service → Task 10; mục 6 Đợt 0 + Đợt 1 → Task 1-18; mục 8 kiểm thử → Task 2, 6, 9, 17. Đợt 2-4 (hồ sơ 360°, đơn hàng, lô tặng, bản đồ, cài đặt, SQL 040/041) KHÔNG nằm trong plan này, sẽ có plan riêng.
- Tên nhất quán: `createApi/ApiError` (Task 2) dùng ở Task 5, 6; `createPoll` + `ctx.poll.add(name, fn, {everyMs})` (Task 4) dùng ở Task 9, 15; `badge(group, code)` (Task 3) dùng ở Task 11-16; `workStrip` trường mới (Task 8) dùng ở `manifest.js` (Task 5) và `today.js` (Task 9): `withdrawals_requested`, `payout_accounts_pending`, `automation_failed`, `ledger_unbalanced`; `FAKE_SUPABASE`/`stubAdmin` (Task 6) dùng ở Task 9, 11-17.
- Review Focus: mục 1 → Task 2 + 6; mục 2 → Task 4 + 9; mục 3 → Task 2 + 6 + 9(c); mục 4 → Task 3 + 11; mục 5 → Task 11, 12, 13.
