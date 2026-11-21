import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/frontend/foodsave-config.js', import.meta.url), 'utf8');

function resolveApi({ protocol = 'http:', origin = 'http://127.0.0.1:5500', override, meta } = {}) {
  const window = { location: { protocol, origin }, FOODSAVE_API_BASE: override };
  const document = { querySelector: () => meta === undefined ? null : { getAttribute: () => meta } };
  vm.runInNewContext(source, { window, document });
  return window.FOODSAVE_API_BASE;
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
