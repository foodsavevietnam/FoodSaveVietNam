import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/frontend/neon-activity.js', import.meta.url), 'utf8');

function createElement(tagName) {
  return {
    tagName,
    children: [],
    textContent: '',
    className: '',
    dateTime: '',
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    addEventListener() {},
  };
}

function loadScript({ feed = false, fetchImpl = async () => { throw new Error('unexpected fetch'); }, importSdk } = {}) {
  const nodes = new Map();
  const component = createElement('section');
  component.querySelector = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, createElement(selector));
    return selector === '[data-mio-activity-list]' ? nodes.get(selector) : nodes.get(selector);
  };
  const document = {
    readyState: 'loading',
    querySelector: () => feed ? component : null,
    createElement,
    addEventListener() {},
  };
  const timers = [];
  const events = new Map();
  const window = {
    location: { origin: 'http://127.0.0.1:5500' },
    FOODSAVE_API_BASE: 'http://127.0.0.1:5500/api/v1',
    fetch: fetchImpl,
    addEventListener(name, callback) { events.set(name, callback); },
    removeEventListener(name) { events.delete(name); },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
  };
  vm.runInNewContext(source, { window, document, URL, Date, Intl, Number, Array, Promise, Error, import: importSdk });
  return { activity: window.MIOActivity, component, nodes, timers, events, window };
}

test('the script stays dormant when the homepage has no activity component', () => {
  const loaded = loadScript();
  assert.equal(typeof loaded.activity.initialize, 'function');
  assert.equal(loaded.nodes.size, 0);
});

test('activity rendering uses text nodes, validates dates and caps the result', () => {
  const loaded = loadScript();
  const rows = [{ id: 'event-1', title: '<img src=x onerror=alert(1)>', created_at: '2026-11-21T12:30:00.000Z' },
    { id: 'event-2', title: 'Không có thời gian hợp lệ', created_at: 'invalid-date' }];
  loaded.activity.render(loaded.component, rows);
  const list = loaded.nodes.get('[data-mio-activity-list]');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, rows[0].title);
  assert.equal(list.children[0].children[1].dateTime, rows[0].created_at);
  assert.equal(loaded.activity.normalizeItems(Array.from({ length: 60 }, (_, index) => ({
    id: String(index), title: 'Activity', created_at: '2026-11-21T12:30:00.000Z',
  }))).length, 50);
  assert.equal(loaded.activity.normalizeItems([{
    id: 'event-3', title: 'Realtime timestamp', created_at: new Date('2026-11-21T12:30:00.000Z'),
  }])[0].created_at, '2026-11-21T12:30:00.000Z');
});

test('empty results use an accessible plain-text placeholder', () => {
  const loaded = loadScript();
  loaded.activity.render(loaded.component, []);
  const row = loaded.nodes.get('[data-mio-activity-list]').children[0];
  assert.equal(row.className, 'mio-activity-empty');
  assert.match(row.textContent, /Chưa có hoạt động/u);
});

test('initial activity fetch omits credentials and falls back without live API auth', async () => {
  const calls = [];
  const loaded = loadScript({ feed: true, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/activity')) return { ok: true, json: async () => ({ success: true, data: { items: [
      { id: 'event-1', title: 'MIO đã đăng sản phẩm mới', created_at: '2026-11-21T12:30:00.000Z' },
    ] } }) };
    return { ok: false };
  } });
  const result = await loaded.activity.initialize(loaded.component, { importSdk: async () => { throw new Error('must stay offline'); } });
  assert.equal(calls[0].url, 'http://127.0.0.1:5500/api/v1/activity');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.match(loaded.nodes.get('[data-mio-activity-list]').children[0].children[0].textContent, /sản phẩm/u);
  assert.match(loaded.nodes.get('[data-mio-activity-status]').textContent, /cập nhật trực tiếp/iu);
  result.stop();
});

test('seals the fixed same-origin query and subscribes to the authenticated Neon URL', async () => {
  const calls = [];
  const snapshots = [];
  const realtimeOptions = [];
  const sealed = { query: { sql: 'select activity rows' }, expiresAt: Date.now() + 60000 };
  const loaded = loadScript({ feed: true, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/activity')
      ? { success: true, data: { items: [] } }
      : { success: true, data: { url: 'wss://realtime.us-east-2.aws.neon.tech/branch', sealedQuery: sealed } } };
  } });
  const result = await loaded.activity.initialize(loaded.component, { importSdk: async () => ({
    createRealtimeClient: (options) => {
      realtimeOptions.push(options);
      return {
        subscribe: (query) => {
          snapshots.push(query);
          return { onChange(callback) {
            callback({ data: [{ id: 'live-event', title: 'MIO đã có hoạt động mới', created_at: new Date('2026-11-21T12:30:00.000Z') }] });
          }, onStateChange() {}, unsubscribe() {} };
        },
        close() {},
      };
    },
  }) });
  assert.equal(calls[1].url, 'http://127.0.0.1:5500/api/v1/activity/live');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.body, '{}');
  assert.equal(realtimeOptions[0].url, 'wss://realtime.us-east-2.aws.neon.tech/branch');
  assert.equal(snapshots[0], sealed);
  assert.equal(loaded.nodes.get('[data-mio-activity-list]').children[0].children[1].dateTime, '2026-11-21T12:30:00.000Z');
  assert.ok(loaded.timers[0].delay > 0);
  result.stop();
});

test('rejects unsafe realtime URLs before creating a client', async () => {
  const loaded = loadScript({ feed: true, fetchImpl: async (url) => ({ ok: true, json: async () => ({ success: true, data:
    url.endsWith('/activity') ? { items: [] } : { url: 'javascript:alert(1)', sealedQuery: {} },
  }) }) });
  let imported = false;
  const result = await loaded.activity.initialize(loaded.component, { importSdk: async () => { imported = true; return {}; } });
  assert.equal(imported, false);
  assert.match(loaded.nodes.get('[data-mio-activity-status]').textContent, /Cập nhật trực tiếp tạm ngưng/u);
  result.stop();
});

test('a failed initial fetch never claims that the activity list was loaded', async () => {
  let calls = 0;
  const loaded = loadScript({ fetchImpl: async () => { calls += 1; return { ok: false }; } });
  const result = await loaded.activity.initialize(loaded.component);
  assert.match(loaded.nodes.get('[data-mio-activity-status]').textContent, /Chưa tải được hoạt động/u);
  assert.equal(loaded.timers.length, 1);
  assert.equal(loaded.timers[0].delay, 1000);
  result.stop();
  assert.equal(loaded.events.has('online'), false);
  assert.equal(loaded.timers[0].cancelled, true);
  await loaded.timers[0].callback();
  assert.equal(calls, 2);
});

test('a live connection recovers automatically when the initial seal request fails', async () => {
  let sealCalls = 0;
  let clients = 0;
  const loaded = loadScript({ fetchImpl: async (url) => {
    if (url.endsWith('/activity')) return { ok: true, json: async () => ({ success: true, data: { items: [] } }) };
    sealCalls += 1;
    if (sealCalls === 1) return { ok: false };
    return { ok: true, json: async () => ({ success: true, data: {
      url: 'wss://realtime.us-east-2.aws.neon.tech/branch',
      sealedQuery: { expiresAt: Date.now() + 60000 },
    } }) };
  } });
  const result = await loaded.activity.initialize(loaded.component, { importSdk: async () => ({
    createRealtimeClient() {
      clients += 1;
      return { subscribe: () => ({ onChange() {}, onStateChange(callback) { callback({ status: 'live' }); }, unsubscribe() {} }), close() {} };
    },
  }) });
  await loaded.timers[0].callback();
  assert.equal(sealCalls, 2);
  assert.equal(clients, 1);
  assert.match(loaded.nodes.get('[data-mio-activity-status]').textContent, /Đang cập nhật trực tiếp/u);
  result.stop();
});

test('a failed renewal obtains a fresh subscription and ignores the old closed state', async () => {
  let sealCalls = 0;
  let clients = 0;
  const stateCallbacks = [];
  const loaded = loadScript({ fetchImpl: async (url) => {
    if (url.endsWith('/activity')) return { ok: true, json: async () => ({ success: true, data: { items: [] } }) };
    sealCalls += 1;
    if (sealCalls === 2) return { ok: false };
    return { ok: true, json: async () => ({ success: true, data: {
      url: 'wss://realtime.us-east-2.aws.neon.tech/branch',
      sealedQuery: { expiresAt: Date.now() + 60000 },
    } }) };
  } });
  const result = await loaded.activity.initialize(loaded.component, { importSdk: async () => ({
    createRealtimeClient() {
      const index = clients++;
      return { subscribe: () => ({ onChange() {}, onStateChange(callback) { stateCallbacks[index] = callback; callback({ status: 'live' }); },
        unsubscribe() { stateCallbacks[index]?.({ status: 'closed' }); } }), close() {} };
    },
  }) });
  await loaded.timers[0].callback();
  assert.equal(loaded.timers[1].delay, 1000);
  await loaded.timers[1].callback();
  assert.equal(clients, 2);
  assert.match(loaded.nodes.get('[data-mio-activity-status]').textContent, /Đang cập nhật trực tiếp/u);
  assert.equal(loaded.timers.length, 3);
  result.stop();
});

test('a superseded asynchronous SDK load cannot replace a newer live connection', async () => {
  let sealCalls = 0;
  let imports = 0;
  let releaseSecondImport;
  let enteredSecondImport;
  const secondImportEntered = new Promise((resolve) => { enteredSecondImport = resolve; });
  const secondImport = new Promise((resolve) => { releaseSecondImport = resolve; });
  const clients = [];
  const sdk = { createRealtimeClient(options) {
    clients.push(options.url);
    return { subscribe: () => ({ onChange() {}, onStateChange(callback) { callback({ status: 'live' }); }, unsubscribe() {} }), close() {} };
  } };
  const loaded = loadScript({ fetchImpl: async (url) => {
    if (url.endsWith('/activity')) return { ok: true, json: async () => ({ success: true, data: { items: [] } }) };
    sealCalls += 1;
    return { ok: true, json: async () => ({ success: true, data: {
      url: `wss://realtime.us-east-2.aws.neon.tech/branch-${sealCalls}`,
      sealedQuery: { expiresAt: Date.now() + 60000 },
    } }) };
  } });
  const result = await loaded.activity.initialize(loaded.component, { importSdk: async () => {
    imports += 1;
    if (imports === 2) { enteredSecondImport(); return secondImport; }
    return sdk;
  } });
  const pendingRenewal = loaded.timers[0].callback();
  await secondImportEntered;
  await loaded.events.get('online')();
  releaseSecondImport(sdk);
  await pendingRenewal;
  assert.deepEqual(clients, [
    'wss://realtime.us-east-2.aws.neon.tech/branch-1',
    'wss://realtime.us-east-2.aws.neon.tech/branch-3',
  ]);
  result.stop();
});
