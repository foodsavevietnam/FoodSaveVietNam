import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const read = (rel) => readFileSync(path.join(rootDir, rel), 'utf8');

test('all 4 Supabase consumers read from FOODSAVE_SUPABASE_URL and FOODSAVE_SUPABASE_ANON_KEY', async () => {
  const files = [
    'public/frontend/foodsave-auth-client.js',
    'public/FOODSAVE_USER.html',
    'public/ADMIN_FOODSAVE.html',
    'public/admin/core/auth.js',
  ];

  for (const rel of files) {
    const src = read(rel);
    assert.match(src, /FOODSAVE_SUPABASE_URL/, `${rel} must read FOODSAVE_SUPABASE_URL`);
    assert.match(src, /FOODSAVE_SUPABASE_ANON_KEY/, `${rel} must read FOODSAVE_SUPABASE_ANON_KEY`);
  }

  // Runtime check for public/admin/core/auth.js picking up window.FOODSAVE_SUPABASE_* overrides
  const { createAuth, SUPABASE_URL, SUPABASE_KEY } = await import('../public/admin/core/auth.js');
  assert.equal(SUPABASE_URL, 'https://idhpydhlgnxjjtyrgfkj.supabase.co');
  assert.equal(SUPABASE_KEY, 'sb_publishable_kBjao9fkPwim7sJKZfWf_Q_JGRZuUOf');

  const prevWindow = globalThis.window;
  let captured = null;
  globalThis.window = {
    FOODSAVE_SUPABASE_URL: 'https://staging-admin.supabase.co',
    FOODSAVE_SUPABASE_ANON_KEY: 'sb_publishable_staging_admin',
    supabase: {
      createClient: (url, key) => {
        captured = { url, key };
        return { auth: {} };
      },
    },
  };
  try {
    createAuth();
    assert.deepEqual(captured, {
      url: 'https://staging-admin.supabase.co',
      key: 'sb_publishable_staging_admin',
    });
  } finally {
    globalThis.window = prevWindow;
  }
});

test('netlify.toml isolates deploy previews and redirects retired _v2/_demo pages', () => {
  const toml = read('netlify.toml');

  const previewMatch = toml.match(/\[context\.deploy-preview\.environment\][\s\S]*?(?=\n\[|$)/);
  assert.ok(previewMatch, 'Missing [context.deploy-preview.environment] block');
  const previewBlock = previewMatch[0];
  assert.match(previewBlock, /AUTOMATION_ENABLED\s*=\s*"false"/);
  assert.match(previewBlock, /PAYMENT_PROVIDER\s*=\s*"simulated"/);
  assert.match(previewBlock, /PAYOUT_PROVIDER\s*=\s*"manual"/);
  assert.match(previewBlock, /DEMO_MODE\s*=\s*"false"/);

  const redirects = [
    ['/FOODSAVE_PARTNER_v2.html', '/FOODSAVE_PARTNER.html'],
    ['/ADMIN_FOODSAVE_v2.html', '/admin/'],
    ['/FOODSAVE_APP_demo.html', '/FOODSAVE_APP.html'],
  ];
  for (const [from, to] of redirects) {
    const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedTo = to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `\\[\\[redirects\\]\\]\\s*from\\s*=\\s*"${escapedFrom}"\\s*to\\s*=\\s*"${escapedTo}"\\s*status\\s*=\\s*302`,
    );
    assert.match(toml, re, `Missing 302 redirect ${from} -> ${to}`);
  }
});

function createOrderFlowHarness({ realtimeEnabled = false, hidden = false } = {}) {
  const source = read('public/frontend/foodsave-order-flow.js');

  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const intervals = new Map();

  function fakeSetTimeout(fn, ms) {
    const id = nextTimerId++;
    timers.set(id, { fn, runAt: now + Number(ms || 0), ms: Number(ms || 0) });
    return id;
  }
  function fakeClearTimeout(id) {
    timers.delete(id);
  }
  function fakeSetInterval(fn, ms) {
    const id = nextTimerId++;
    intervals.set(id, { fn, ms: Number(ms || 0), nextAt: now + Number(ms || 0) });
    return id;
  }
  function fakeClearInterval(id) {
    intervals.delete(id);
  }
  function advanceTime(ms) {
    const target = now + ms;
    while (true) {
      let nextTime = target + 1;
      let nextKind = null;
      let nextId = null;
      for (const [id, t] of timers.entries()) {
        if (t.runAt <= target && t.runAt < nextTime) {
          nextTime = t.runAt;
          nextKind = 'timeout';
          nextId = id;
        }
      }
      for (const [id, iv] of intervals.entries()) {
        if (iv.nextAt <= target && iv.nextAt < nextTime) {
          nextTime = iv.nextAt;
          nextKind = 'interval';
          nextId = id;
        }
      }
      if (!nextKind) break;
      now = nextTime;
      if (nextKind === 'timeout') {
        const t = timers.get(nextId);
        timers.delete(nextId);
        t.fn();
      } else {
        const iv = intervals.get(nextId);
        if (iv) {
          iv.nextAt = now + iv.ms;
          iv.fn();
        }
      }
    }
    now = target;
  }

  const channels = [];
  const removedChannels = [];
  const mockSupabaseClient = {
    channel(name) {
      const ch = {
        name,
        handlers: [],
        subscribeCb: null,
        unsubscribed: false,
        on(type, filter, cb) {
          ch.handlers.push({ type, filter, cb });
          return ch;
        },
        subscribe(cb) {
          ch.subscribeCb = cb;
          return ch;
        },
        unsubscribe() {
          ch.unsubscribed = true;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      removedChannels.push(ch);
      ch.unsubscribed = true;
    },
  };

  const apiCalls = [];
  let chatHostEl = {
    id: 'od-chat',
    style: { display: '' },
    innerHTML: '',
    scrollIntoView() {},
  };
  let pageActive = true;
  const docListeners = new Map();
  const winListeners = new Map();

  const document = {
    hidden,
    getElementById(id) {
      if (id === 'od-chat') return chatHostEl;
      return null;
    },
    querySelector(sel) {
      if (sel === '#page-order-detail.active') return pageActive ? { id: 'page-order-detail' } : null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatch(type) {
      for (const fn of docListeners.get(type) || []) fn({});
    },
  };

  const window = {
    MIO_REALTIME_CHAT: realtimeEnabled,
    location: { hash: '', pathname: '/FOODSAVE_USER.html', search: '' },
    FoodSaveAuth: {
      getClient: () => mockSupabaseClient,
    },
    FS: {
      sync: {
        request(reqPath, options) {
          apiCalls.push({ path: reqPath, options });
          return Promise.resolve({ messages: [], can_send: true });
        },
      },
    },
    navTo() {},
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatch(type) {
      for (const fn of winListeners.get(type) || []) fn({});
    },
  };

  vm.runInNewContext(source, {
    window,
    document,
    console,
    Date,
    Promise,
    encodeURIComponent,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
  });

  return {
    window,
    document,
    flow: window.FoodSaveOrderFlow,
    channels,
    removedChannels,
    apiCalls,
    advanceTime,
    setPageActive(val) { pageActive = val; },
  };
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test('realtime chat is disabled by default and keeps 12s REST polling', async () => {
  const h = createOrderFlowHarness({ realtimeEnabled: false });
  h.flow.openChat({ backendId: 'ord-1', paymentStatus: 'paid', status: 'confirmed' });
  await flushMicrotasks();

  assert.equal(h.channels.length, 0);
  const state = h.flow._test.getState();
  assert.equal(state.hasChannel, false);
  assert.equal(state.realtimeSubscribed, false);
  assert.equal(state.pollIntervalMs, 12000);
  assert.equal(h.apiCalls.length, 1);

  h.flow.closeChat();
});

test('realtime chat subscribes when MIO_REALTIME_CHAT=true, refreshes on INSERT, relaxes poll to 60s, and falls back on error', async () => {
  const h = createOrderFlowHarness({ realtimeEnabled: true });
  h.flow.openChat({ backendId: 'ord-42', paymentStatus: 'paid', status: 'confirmed' });
  await flushMicrotasks();

  assert.equal(h.channels.length, 1);
  const ch = h.channels[0];
  assert.equal(ch.handlers.length, 1);
  assert.equal(ch.handlers[0].type, 'postgres_changes');
  assert.deepEqual({ ...ch.handlers[0].filter }, {
    event: 'INSERT',
    schema: 'public',
    table: 'order_messages',
    filter: 'order_id=eq.ord-42',
  });
  assert.equal(h.flow._test.getState().pollIntervalMs, 12000);

  // Transition to SUBSCRIBED -> relax REST fallback poll to 60s
  ch.subscribeCb('SUBSCRIBED');
  assert.equal(h.flow._test.getState().realtimeSubscribed, true);
  assert.equal(h.flow._test.getState().pollIntervalMs, 60000);

  // Receiving an INSERT event triggers immediate loadChat refresh
  const callsBeforeInsert = h.apiCalls.length;
  ch.handlers[0].cb({ new: { id: 'm1', order_id: 'ord-42', body: 'Xin chào' } });
  await flushMicrotasks();
  assert.equal(h.apiCalls.length, callsBeforeInsert + 1);
  assert.equal(h.apiCalls[h.apiCalls.length - 1].path, '/orders/ord-42/messages');

  // Channel error gracefully falls back to 12s REST poll
  ch.subscribeCb('CHANNEL_ERROR');
  assert.equal(h.flow._test.getState().realtimeSubscribed, false);
  assert.equal(h.flow._test.getState().pollIntervalMs, 12000);

  // Closing chat immediately removes channel
  h.flow.closeChat();
  assert.equal(h.removedChannels.length, 1);
  assert.equal(h.removedChannels[0], ch);
  assert.equal(h.flow._test.getState().hasChannel, false);
});

test('realtime chat releases channel on order switch, pagehide, and after document.hidden > 60s, and re-subscribes on visible', async () => {
  const h = createOrderFlowHarness({ realtimeEnabled: true });

  // Open order A then switch to order B -> channel A is immediately removed
  h.flow.openChat({ backendId: 'ord-a', paymentStatus: 'paid', status: 'confirmed' });
  await flushMicrotasks();
  const chA = h.channels[0];
  chA.subscribeCb('SUBSCRIBED');

  h.flow.openChat({ backendId: 'ord-b', paymentStatus: 'paid', status: 'confirmed' });
  await flushMicrotasks();
  assert.equal(h.removedChannels.length, 1);
  assert.equal(h.removedChannels[0], chA);
  assert.equal(h.channels.length, 2);
  const chB = h.channels[1];
  chB.subscribeCb('SUBSCRIBED');

  // Tab hidden: still connected at 59s, removed after 60s
  h.document.hidden = true;
  h.document.dispatch('visibilitychange');
  h.advanceTime(59000);
  assert.equal(h.removedChannels.length, 1);
  assert.equal(h.flow._test.getState().hasChannel, true);

  h.advanceTime(2000);
  assert.equal(h.removedChannels.length, 2);
  assert.equal(h.removedChannels[1], chB);
  assert.equal(h.flow._test.getState().hasChannel, false);

  // Tab becomes visible again while chat is still open -> re-subscribes and refreshes
  const callsBeforeVisible = h.apiCalls.length;
  h.document.hidden = false;
  h.document.dispatch('visibilitychange');
  await flushMicrotasks();
  assert.equal(h.channels.length, 3);
  assert.equal(h.flow._test.getState().hasChannel, true);
  assert.ok(h.apiCalls.length > callsBeforeVisible, 'chat should refresh on tab becoming visible');

  // pagehide tears down active channel immediately
  h.window.dispatch('pagehide');
  assert.equal(h.removedChannels.length, 3);
  assert.equal(h.removedChannels[2], h.channels[2]);
  assert.equal(h.flow._test.getState().hasChannel, false);
});
