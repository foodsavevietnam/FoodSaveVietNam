import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/frontend/foodsave-config.js', import.meta.url), 'utf8');

function resolveConfig({
  protocol = 'http:',
  origin = 'http://127.0.0.1:5500',
  override,
  supabaseUrl,
  supabaseAnonKey,
  meta,
  metas = {},
} = {}) {
  const window = {
    location: { protocol, origin },
    FOODSAVE_API_BASE: override,
    FOODSAVE_SUPABASE_URL: supabaseUrl,
    FOODSAVE_SUPABASE_ANON_KEY: supabaseAnonKey,
  };
  const metaMap = { ...metas };
  if (meta !== undefined) metaMap['foodsave-api-base'] = meta;
  const document = {
    querySelector: (selector) => {
      const m = /^meta\[name="([^"]+)"\]$/.exec(String(selector));
      if (!m || !(m[1] in metaMap) || metaMap[m[1]] === undefined) return null;
      return { getAttribute: () => metaMap[m[1]] };
    },
  };
  vm.runInNewContext(source, { window, document });
  return {
    apiBase: window.FOODSAVE_API_BASE,
    supabaseUrl: window.FOODSAVE_SUPABASE_URL,
    supabaseAnonKey: window.FOODSAVE_SUPABASE_ANON_KEY,
  };
}

function resolveApi(opts = {}) {
  return resolveConfig(opts).apiBase;
}

test('preview and deployed pages use their own origin', () => {
  assert.equal(resolveApi(), 'http://127.0.0.1:5500/api/v1');
  assert.equal(resolveApi({ protocol: 'https:', origin: 'https://foodsave.example' }), 'https://foodsave.example/api/v1');
});

test('explicit API override is preserved before metadata', () => {
  assert.equal(resolveApi({ override: 'https://api.example/api/v1', meta: 'https://other.example/api/v1' }), 'https://api.example/api/v1');
});

test('metadata can configure an API on another origin', () => {
  assert.equal(resolveApi({ override: ' ', meta: ' https://api.example/api/v1 ' }), 'https://api.example/api/v1');
});

test('file previews fall back to the local API', () => {
  assert.equal(resolveApi({ protocol: 'file:', origin: 'null' }), 'http://localhost:8080/api/v1');
});

test('Supabase config falls back to production defaults when unset', () => {
  const cfg = resolveConfig();
  assert.equal(cfg.supabaseUrl, 'https://idhpydhlgnxjjtyrgfkj.supabase.co');
  assert.equal(cfg.supabaseAnonKey, 'sb_publishable_kBjao9fkPwim7sJKZfWf_Q_JGRZuUOf');
});

test('Supabase config resolves from meta tags and trims whitespace', () => {
  const cfg = resolveConfig({
    override: 'https://api.example/api/v1',
    supabaseUrl: '   ',
    supabaseAnonKey: '',
    metas: {
      'foodsave-supabase-url': ' https://staging.supabase.co ',
      'foodsave-supabase-anon-key': ' sb_publishable_staging_key ',
    },
  });
  assert.equal(cfg.apiBase, 'https://api.example/api/v1');
  assert.equal(cfg.supabaseUrl, 'https://staging.supabase.co');
  assert.equal(cfg.supabaseAnonKey, 'sb_publishable_staging_key');
});

test('pre-set window Supabase overrides take precedence over meta tags and defaults', () => {
  const cfg = resolveConfig({
    supabaseUrl: 'https://override.supabase.co',
    supabaseAnonKey: 'sb_publishable_override_key',
    metas: {
      'foodsave-supabase-url': 'https://meta.supabase.co',
      'foodsave-supabase-anon-key': 'sb_publishable_meta_key',
    },
  });
  assert.equal(cfg.supabaseUrl, 'https://override.supabase.co');
  assert.equal(cfg.supabaseAnonKey, 'sb_publishable_override_key');
});
