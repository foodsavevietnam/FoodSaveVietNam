import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const readRepoFile = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

function extractFunctionBlock(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Không tìm thấy "${signature}"`);
  const braceStart = source.indexOf('{', start);
  assert.notEqual(braceStart, -1, `Không tìm thấy thân hàm cho "${signature}"`);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (!inDouble && !inTemplate && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`Không đóng đủ ngoặc nhọn cho "${signature}"`);
}

test('FOODSAVE_VOLUNTEER.html nạp foodsave-pwa.js trước IIFE chính và gọi FSPwa.init cùng phạm vi với function api(', async () => {
  const html = readRepoFile('public/FOODSAVE_VOLUNTEER.html');
  const pwaSource = readRepoFile('public/frontend/foodsave-pwa.js');

  const pwaScriptMatches = [...html.matchAll(/<script\s+src="frontend\/foodsave-pwa\.js\?v=([^"]+)"><\/script>/g)];
  assert.equal(pwaScriptMatches.length, 1, 'FOODSAVE_VOLUNTEER.html chỉ được nạp foodsave-pwa.js đúng 1 lần');
  assert.equal(pwaScriptMatches[0][1], '20261030a', 'Phiên bản ?v= của foodsave-pwa.js phải đồng bộ với các cổng khác');

  const inlineScripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(inlineScripts.length, 1, 'FOODSAVE_VOLUNTEER.html chỉ có duy nhất 1 khối inline script IIFE chính');

  const pwaScriptIndex = pwaScriptMatches[0].index;
  const mainIifeScriptIndex = inlineScripts[0].index;
  assert.ok(pwaScriptIndex < mainIifeScriptIndex, 'foodsave-pwa.js phải được nạp trước khối IIFE chính');

  const mainIifeCode = inlineScripts[0][1];
  assert.doesNotThrow(() => new vm.Script(mainIifeCode, { filename: 'FOODSAVE_VOLUNTEER.html' }));
  assert.match(mainIifeCode, /\bfunction\s+api\s*\(\s*path\s*,\s*options\s*\)/);
  assert.match(mainIifeCode, /\bFSPwa\.init\s*\(\s*\{\s*role:\s*'volunteer'/);
  assert.doesNotMatch(html, /\bon(click|change|submit)\s*=/i, 'Không được có inline event handler trong FOODSAVE_VOLUNTEER.html');

  // Kiểm chứng thực thi: FSPwa.init dùng được hàm api nội bộ để gọi /push/public-key mà không bị ReferenceError
  const apiFnCode = extractFunctionBlock(mainIifeCode, 'function api(path, options)');
  const requestedPaths = [];
  const warnings = [];
  const swReady = { pushManager: { getSubscription: async () => null } };
  const windowObj = {
    location: { protocol: 'https:', hostname: 'makeitorganized.netlify.app', port: '', origin: 'https://makeitorganized.netlify.app' },
    navigator: {
      userAgent: 'Mozilla/5.0',
      serviceWorker: {
        addEventListener() {},
        register: async () => ({}),
        ready: Promise.resolve(swReady)
      }
    },
    Notification: { permission: 'default' },
    PushManager: function PushManager() {},
    addEventListener() {},
    console: { warn: (...args) => warnings.push(args.join(' ')) }
  };
  const documentObj = {
    readyState: 'complete',
    addEventListener() {},
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, appendChild() {}, remove() {} }),
    body: { appendChild() {} }
  };
  const context = vm.createContext({
    window: windowObj,
    navigator: windowObj.navigator,
    Notification: windowObj.Notification,
    PushManager: windowObj.PushManager,
    document: documentObj,
    console: windowObj.console,
    setTimeout: () => 0,
    fetch: async (url) => {
      requestedPaths.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { enabled: true, public_key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' } })
      };
    }
  });
  windowObj.window = windowObj;

  vm.runInContext(pwaSource, context);
  vm.runInContext(`
    (function () {
      var TOKEN_KEY = 'foodsave-volunteer-token';
      function lsGet() { return 'vol-token-123'; }
      function apiBase() { return window.location.origin + '/api/v1'; }
      ${apiFnCode}
      if (window.FSPwa) window.FSPwa.init({ role: 'volunteer', request: function (path, options) { return api(path, options); } });
    })();
  `, context);

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(warnings, [], 'FSPwa.init không được phát sinh cảnh báo ReferenceError: api is not defined');
  assert.deepEqual(requestedPaths, ['https://makeitorganized.netlify.app/api/v1/push/public-key']);
});

test('FOODSAVE_USER.html: loadProducts không truy vấn trực tiếp Supabase .from("products") mà đồng bộ qua FS.sync.refresh', async () => {
  const html = readRepoFile('public/FOODSAVE_USER.html');
  const loadProductsCode = extractFunctionBlock(html, 'async function loadProducts()');

  assert.doesNotMatch(loadProductsCode, /\.from\s*\(\s*['"]products['"]\s*\)/, 'loadProducts không được gọi thẳng .from("products")');
  assert.doesNotMatch(loadProductsCode, /\bfoodsaveSupabaseClient\s*\(/, 'loadProducts không được khởi tạo Supabase client để đọc bảng products');
  assert.match(loadProductsCode, /window\.FS\s*&&\s*window\.FS\.sync\s*&&\s*typeof\s+window\.FS\.sync\.refresh\s*===\s*'function'/);
  assert.match(html, /window\.loadProducts\s*=\s*loadProducts\s*;/);
  assert.doesNotMatch(html, /addEventListener\s*\(\s*['"]DOMContentLoaded['"]\s*,\s*loadProducts\s*\)/, 'Không gọi trùng loadProducts lúc DOMContentLoaded để tránh double-fetch');

  let refreshCount = 0;
  let renderMarketCount = 0;
  let supabaseFromCount = 0;
  const products = [{ id: 'p-1', name: 'Bánh mì nguyên cám' }];
  const windowObj = {
    FS: {
      sync: {
        refresh: async () => {
          refreshCount += 1;
        }
      }
    }
  };
  const context = vm.createContext({
    window: windowObj,
    PRODUCTS: products,
    console,
    foodsaveSupabaseClient: () => ({ from: () => { supabaseFromCount += 1; throw new Error('Forbidden direct Supabase read'); } }),
    renderMarket: () => { renderMarketCount += 1; },
    renderHome: () => {}
  });

  vm.runInContext(`
    let loadProductsInFlight = null;
    ${loadProductsCode}
    window.loadProducts = loadProducts;
  `, context);

  const result = await windowObj.loadProducts();
  assert.equal(supabaseFromCount, 0);
  assert.equal(refreshCount, 1);
  assert.equal(renderMarketCount, 1);
  assert.equal(result.length, 1);
  assert.equal(windowObj.__foodsaveSupabaseProductsReady, false);
});

test('FOODSAVE_USER.html: loadCustomerTrust chặn gọi /customers/me/trust khi chưa đăng nhập và gọi lại khi có phiên hợp lệ', async () => {
  const html = readRepoFile('public/FOODSAVE_USER.html');
  const hasSessionCode = extractFunctionBlock(html, 'async function hasCustomerAuthSession()');
  const loadTrustCode = extractFunctionBlock(html, 'async function loadCustomerTrust()');

  const guardIndex = loadTrustCode.indexOf('hasCustomerAuthSession()');
  const requestIndex = loadTrustCode.indexOf("'/customers/me/trust'");
  assert.notEqual(guardIndex, -1, 'loadCustomerTrust phải gọi guard hasCustomerAuthSession()');
  assert.ok(guardIndex < requestIndex, 'Guard kiểm tra đăng nhập phải chạy trước khi gửi request /customers/me/trust');

  const storage = new Map();
  let currentAuthHeader = null;
  const apiCalls = [];
  const sessionSavedListeners = [];

  const windowObj = {
    CUSTOMER_TRUST: null,
    userPoints: 100,
    FoodSaveCurrentAuth: null,
    addEventListener(type, fn) {
      if (type === 'foodsave:session-saved') sessionSavedListeners.push(fn);
    },
    FS: {
      sync: {
        authHeader: () => currentAuthHeader,
        request: async (path) => {
          apiCalls.push(path);
          return { points: 95, no_show_count: 0, no_show_limit: 3, window_days: 30, red_banned: false, blocked: false };
        }
      }
    }
  };
  const localStorageObj = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key)
  };
  let uiUpdated = 0;
  const context = vm.createContext({
    window: windowObj,
    localStorage: localStorageObj,
    updateReputationUI: () => { uiUpdated += 1; },
    readFoodSaveAuthSession: () => {
      const raw = localStorageObj.getItem('foodsave.auth.session.customer');
      return raw ? JSON.parse(raw) : null;
    }
  });

  vm.runInContext(`
    ${hasSessionCode}
    ${loadTrustCode}
    window.loadCustomerTrust = loadCustomerTrust;
    window.addEventListener('foodsave:session-saved', (event) => {
      if (!event.detail || !event.detail.role || event.detail.role === 'customer') {
        loadCustomerTrust();
      }
    });
  `, context);

  // Khách chưa đăng nhập: tuyệt đối không phát sinh HTTP request (tránh 401 mỗi 60s)
  const guestResult = await windowObj.loadCustomerTrust();
  assert.equal(guestResult, null);
  assert.deepEqual(apiCalls, []);
  assert.equal(uiUpdated, 0);

  // Khi khách đăng nhập xong: có Bearer token -> gọi /customers/me/trust và cập nhật điểm uy tín
  currentAuthHeader = 'Bearer valid-customer-jwt';
  storage.set('foodsave.auth.session.customer', JSON.stringify({ role: 'customer', accessToken: 'valid-customer-jwt' }));
  for (const listener of sessionSavedListeners) listener({ detail: { role: 'customer' } });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(apiCalls, ['/customers/me/trust']);
  assert.equal(windowObj.userPoints, 95);
  assert.equal(uiUpdated, 1);
});

test('src/server.ts chỉ chạy labelAutomationService khi AUTOMATION_ENABLED=true và LABEL_AUTOMATION_INTERVAL_MS > 0', () => {
  const serverTs = readRepoFile('src/server.ts');
  assert.match(
    serverTs,
    /env\.AUTOMATION_ENABLED\s*&&\s*env\.LABEL_AUTOMATION_INTERVAL_MS\s*>\s*0/,
    'src/server.ts phải kiểm tra env.AUTOMATION_ENABLED trước khi đặt timer và chạy runLabelAutomation'
  );
  assert.match(serverTs, /Label automation is disabled on boot/);

  const runServerBoot = (automationEnabled, intervalMs) => {
    const script = `
      const assert = require('node:assert/strict');
      const http = require('node:http');
      let automationRuns = 0;
      const infoLogs = [];
      const intervals = [];

      http.createServer = () => ({ listen(_port, cb) { if (cb) cb(); }, close(cb) { if (cb) cb(); } });
      global.setInterval = (fn, ms) => { const token = { fn, ms }; intervals.push(token); return token; };
      global.clearInterval = () => {};

      const mockModule = (rel, exports) => {
        const resolved = require.resolve(rel);
        require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
      };

      mockModule('./dist/app.js', { app: {} });
      mockModule('./dist/config/env.js', {
        env: {
          PORT: 8080,
          AUTOMATION_ENABLED: ${JSON.stringify(automationEnabled)},
          LABEL_AUTOMATION_INTERVAL_MS: ${JSON.stringify(intervalMs)},
          LOG_LEVEL: 'info'
        }
      });
      mockModule('./dist/config/postgres.js', {
        isPostgresAvailable: async () => true,
        postgresPool: { end: async () => {} }
      });
      mockModule('./dist/neon/database.js', { closeNeonPool: async () => {} });
      mockModule('./dist/realtime/socketServer.js', { initializeSocketServer() {} });
      mockModule('./dist/services/labelAutomationService.js', {
        labelAutomationService: {
          run: async () => { automationRuns += 1; return { updated: 0 }; }
        }
      });
      mockModule('./dist/utils/logger.js', {
        logger: {
          info(msg, meta) { infoLogs.push({ msg, meta }); },
          warn() {},
          error() {},
          debug() {}
        }
      });

      require('./dist/server.js');
      console.log(JSON.stringify({ automationRuns, intervalCount: intervals.length, infoLogs }));
    `;
    const res = spawnSync(process.execPath, ['--input-type=commonjs', '-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true
    });
    assert.equal(res.status, 0, res.stderr || res.stdout || 'Không chạy được kiểm thử cô lập dist/server.js');
    return JSON.parse(res.stdout.trim().split('\n').at(-1));
  };

  const disabledBoot = runServerBoot(false, 300000);
  assert.equal(disabledBoot.automationRuns, 0, 'AUTOMATION_ENABLED=false thì không được tự chạy labelAutomationService');
  assert.equal(disabledBoot.intervalCount, 0, 'AUTOMATION_ENABLED=false thì không được đặt setInterval');
  assert.ok(
    disabledBoot.infoLogs.some((entry) => entry.msg === 'Label automation is disabled on boot'),
    'Phải ghi log rõ ràng lúc boot khi automation đang tắt'
  );

  const enabledBoot = runServerBoot(true, 300000);
  assert.equal(enabledBoot.automationRuns, 1, 'AUTOMATION_ENABLED=true và interval > 0 thì chạy ngay 1 lượt lúc boot');
  assert.equal(enabledBoot.intervalCount, 1, 'AUTOMATION_ENABLED=true và interval > 0 thì đặt đúng 1 timer');
});
