import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { configureEnvironment } = require('../dist/config/loadEnvironment.js');

test('separates legacy Supabase and Neon URLs instead of redirecting PostgreSQL', () => {
  const env = {};
  configureEnvironment(env, {
    SUPABASE_URL: 'https://supabase.example',
    DATABASE_URL: 'postgresql://legacy@supabase.example/db',
  }, {
    DATABASE_URL: 'postgresql://neon@ep-demo.neon.tech/db',
    NEON_REALTIME_URL: 'https://realtime.example',
    NEON_REALTIME_SECRET: 'realtime-test-only',
  });
  assert.equal(env.SUPABASE_URL, 'https://supabase.example');
  assert.equal(env.SUPABASE_DATABASE_URL, 'postgresql://legacy@supabase.example/db');
  assert.equal(env.NEON_DATABASE_URL, 'postgresql://neon@ep-demo.neon.tech/db');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.NEON_REALTIME_URL, 'https://realtime.example');
  assert.equal(env.NEON_REALTIME_SECRET, 'realtime-test-only');
});

test('existing process settings win and injected Neon URLs are recognized', () => {
  const env = {
    DATABASE_URL: 'postgresql://neon@ep-existing.neon.tech/db',
    NEON_DATABASE_URL: 'postgresql://neon@ep-explicit.neon.tech/db',
    SUPABASE_DATABASE_URL: 'postgresql://supabase@db.supabase.example/db',
    NEON_REALTIME_SECRET: 'explicit-test-only',
    PORT: '9001',
  };
  configureEnvironment(env, {
    DATABASE_URL: 'postgresql://legacy@db.supabase.example/db',
    PORT: '8080',
  }, {
    DATABASE_URL: 'postgresql://neon@ep-file.neon.tech/db',
    NEON_REALTIME_SECRET: 'file-test-only',
  });
  assert.equal(env.NEON_DATABASE_URL, 'postgresql://neon@ep-explicit.neon.tech/db');
  assert.equal(env.SUPABASE_DATABASE_URL, 'postgresql://supabase@db.supabase.example/db');
  assert.equal(env.DATABASE_URL, 'postgresql://neon@ep-existing.neon.tech/db');
  assert.equal(env.PORT, '9001');
  assert.equal(env.NEON_REALTIME_SECRET, 'explicit-test-only');
});

test('a process-injected Neon URL does not overwrite a legacy Supabase URL', () => {
  const env = { DATABASE_URL: 'postgresql://neon@ep-process.neon.tech/db' };
  configureEnvironment(env, {
    DATABASE_URL: 'postgresql://legacy@db.supabase.example/db',
  }, {});
  assert.equal(env.NEON_DATABASE_URL, 'postgresql://neon@ep-process.neon.tech/db');
  assert.equal(env.SUPABASE_DATABASE_URL, 'postgresql://legacy@db.supabase.example/db');
});

test('a Neon URL pulled into the app environment is never used as Supabase SQL', () => {
  const environment = {};
  configureEnvironment(environment, { DATABASE_URL: 'postgresql://neon@ep-app.neon.tech/db' }, {});
  assert.equal(environment.NEON_DATABASE_URL, 'postgresql://neon@ep-app.neon.tech/db');
  assert.equal(environment.SUPABASE_DATABASE_URL, undefined);
});
