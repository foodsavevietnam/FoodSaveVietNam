import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { configureEnvironment, findNearestEnvLocal, loadEnvironment } = require('../dist/config/loadEnvironment.js');
const dotenv = require('dotenv');

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function extractEnvSchemaKeys(envTsSource) {
  const schemaMatch = envTsSource.match(/const\s+envSchema\s*=\s*z\.object\(\s*\{([\s\S]*?)\n\}\s*\);/);
  assert.ok(schemaMatch, 'Không tìm thấy khai báo envSchema trong src/config/env.ts');
  const body = schemaMatch[1];
  const keys = [];
  for (const line of body.split(/\r?\n/)) {
    const keyMatch = line.match(/^\s{2}([A-Z][A-Z0-9_]+)\s*:/);
    if (keyMatch) keys.push(keyMatch[1]);
  }
  assert.ok(keys.length >= 50, `Số lượng khóa đọc từ envSchema bất thường (${keys.length})`);
  return keys;
}

function extractExampleKeys(fileContent) {
  const keys = new Set(Object.keys(dotenv.parse(fileContent)));
  for (const line of fileContent.split(/\r?\n/)) {
    const commented = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=/);
    if (commented) keys.add(commented[1]);
  }
  return keys;
}

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

test('loadEnvironment finds .env.local up to 3 parent levels for worktrees/releases, honors MIO_ENV_DIR, and skips files on serverless', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mio-env-loader-'));
  try {
    // Mô phỏng cấu trúc: <tmpRoot>/.env.local và <tmpRoot>/.worktrees/feat-x/FoodSaveVietNam (cách 3 cấp)
    const worktreeBackend = path.join(tmpRoot, '.worktrees', 'feat-x', 'FoodSaveVietNam');
    fs.mkdirSync(worktreeBackend, { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, '.env.local'),
      'DATABASE_URL=postgresql://neon@ep-worktree.neon.tech/neondb\nNEON_REALTIME_URL=https://rt.worktree.example\n'
    );
    fs.writeFileSync(path.join(worktreeBackend, '.env'), 'PORT=8181\n');

    const foundPath = findNearestEnvLocal(worktreeBackend, {}, 3);
    assert.equal(foundPath, path.join(tmpRoot, '.env.local'));

    const worktreeEnv = { PORT: '9999' };
    loadEnvironment({ backendRoot: worktreeBackend, environment: worktreeEnv });
    assert.equal(worktreeEnv.PORT, '9999', 'process.env phải luôn thắng .env');
    assert.equal(worktreeEnv.NEON_DATABASE_URL, 'postgresql://neon@ep-worktree.neon.tech/neondb');
    assert.equal(worktreeEnv.NEON_REALTIME_URL, 'https://rt.worktree.example');

    // Quá 3 cấp (4 cấp cha) không được tìm ngược nữa
    const tooDeepBackend = path.join(tmpRoot, 'a', 'b', 'c', 'FoodSaveVietNam');
    fs.mkdirSync(tooDeepBackend, { recursive: true });
    assert.equal(findNearestEnvLocal(tooDeepBackend, {}, 3), null);

    // MIO_ENV_DIR chỉ định tường minh thắng tìm ngược thư mục cha
    const customEnvDir = path.join(tmpRoot, 'custom-env');
    fs.mkdirSync(customEnvDir, { recursive: true });
    fs.writeFileSync(
      path.join(customEnvDir, '.env.local'),
      'DATABASE_URL=postgresql://neon@ep-custom.neon.tech/neondb\n'
    );
    const customEnv = { MIO_ENV_DIR: customEnvDir };
    loadEnvironment({ backendRoot: tooDeepBackend, environment: customEnv });
    assert.equal(customEnv.NEON_DATABASE_URL, 'postgresql://neon@ep-custom.neon.tech/neondb');

    // Trên AWS Lambda / Netlify tuyệt đối bỏ qua đọc file cục bộ
    for (const marker of [{ AWS_LAMBDA_FUNCTION_NAME: 'api-fn' }, { NETLIFY: 'true' }]) {
      const serverlessEnv = { ...marker, MIO_ENV_DIR: customEnvDir };
      loadEnvironment({ backendRoot: worktreeBackend, environment: serverlessEnv });
      assert.equal(serverlessEnv.NEON_DATABASE_URL, undefined);
      assert.equal(serverlessEnv.PORT, undefined);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('100% of envSchema keys exist in both .env.example and .env.production.example, and production SSL verification stays enabled', () => {
  const envTsSource = fs.readFileSync(path.join(repoRoot, 'src/config/env.ts'), 'utf8');
  const devExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  const prodExample = fs.readFileSync(path.join(repoRoot, '.env.production.example'), 'utf8');

  const schemaKeys = extractEnvSchemaKeys(envTsSource);
  const devKeys = extractExampleKeys(devExample);
  const prodKeys = extractExampleKeys(prodExample);

  const missingInDev = schemaKeys.filter((k) => !devKeys.has(k));
  const missingInProd = schemaKeys.filter((k) => !prodKeys.has(k));

  assert.deepEqual(missingInDev, [], `.env.example thiếu các biến: ${missingInDev.join(', ')}`);
  assert.deepEqual(missingInProd, [], `.env.production.example thiếu các biến: ${missingInProd.join(', ')}`);

  // Đảm bảo các biến Wave 3B mới chắc chắn có mặt trong schema
  for (const requiredNewKey of ['PAYOUT_ENCRYPTION_KEYS', 'SENTRY_DSN', 'LOG_FORMAT']) {
    assert.ok(schemaKeys.includes(requiredNewKey), `envSchema thiếu biến mới ${requiredNewKey}`);
  }

  // .env.production.example KHÔNG được tắt xác thực chứng chỉ SSL
  const prodParsed = dotenv.parse(prodExample);
  assert.notEqual(
    String(prodParsed.DATABASE_SSL_REJECT_UNAUTHORIZED).toLowerCase(),
    'false',
    '.env.production.example không được đặt DATABASE_SSL_REJECT_UNAUTHORIZED=false'
  );
  assert.equal(prodParsed.DATABASE_SSL_REJECT_UNAUTHORIZED, 'true');
  assert.doesNotMatch(prodExample, /DATABASE_SSL_REJECT_UNAUTHORIZED\s*=\s*false/i);
});
