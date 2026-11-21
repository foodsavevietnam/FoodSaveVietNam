import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { isAbsolute, join, relative, sep } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../scripts/lib/dev-server.mjs';

const testDirectory = fileURLToPath(new URL('./', import.meta.url));
let fixtureDirectory;
let publicDirectory;
let server;
let address;

async function listen(httpServer) {
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  return httpServer.address();
}

async function close(httpServer) {
  await new Promise((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
    httpServer.closeIdleConnections();
  });
}

function get(path, options = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: '127.0.0.1', port: address.port, path, ...options,
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => resolve({
        status: incoming.statusCode,
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString(),
      }));
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(options.body);
  });
}

before(async () => {
  fixtureDirectory = await mkdtemp(join(testDirectory, 'preview-fixture-'));
  publicDirectory = join(fixtureDirectory, 'public');
  await mkdir(join(publicDirectory, 'frontend'), { recursive: true });
  await mkdir(join(publicDirectory, 'reference'));
  await Promise.all([
    writeFile(join(publicDirectory, 'index.html'), '<!doctype html><title>MIO</title>'),
    writeFile(join(publicDirectory, 'FOODSAVE_USER.html'), '<title>Người mua</title>'),
    writeFile(join(publicDirectory, 'frontend', 'style.css'), 'body { color: green; }'),
    writeFile(join(publicDirectory, 'sw.js'), '// Service worker fixture'),
    writeFile(join(publicDirectory, 'manifest-app.webmanifest'), '{}'),
    writeFile(join(publicDirectory, 'reference', 'sample.html'), '<title>Reference</title>'),
    writeFile(join(fixtureDirectory, 'outside.html'), '<title>Outside public</title>'),
  ]);
  server = createPreviewServer({ publicDirectory });
  address = await listen(server);
});

after(async () => {
  if (server) await close(server);
  if (fixtureDirectory) {
    const checkedPath = relative(testDirectory, fixtureDirectory);
    assert(checkedPath && !isAbsolute(checkedPath) && checkedPath !== '..' && !checkedPath.startsWith(`..${sep}`));
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test('serves homepage and CSS with queries and correct MIME types', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /^text\/html/u);
  assert.match(home.body, /MIO/u);
  const css = await get('/frontend/style.css?v=2');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /^text\/css/u);
  assert.equal(css.body, 'body { color: green; }');
});

test('HEAD returns metadata without a response body', async () => {
  const response = await get('/index.html', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert(Number(response.headers['content-length']) > 0);
  assert.equal(response.body, '');
});

test('keeps service worker uncached and sends manifest MIME type', async () => {
  const worker = await get('/sw.js');
  assert.equal(worker.status, 200);
  assert.equal(worker.headers['cache-control'], 'no-cache');
  assert.equal(worker.headers['service-worker-allowed'], '/');
  const manifest = await get('/manifest-app.webmanifest');
  assert.match(manifest.headers['content-type'], /^application\/manifest\+json/u);
});

test('redirects portal aliases to the original URLs for role detection', async () => {
  const portal = await get('/nguoi-mua');
  assert.equal(portal.status, 302);
  assert.equal(portal.headers.location, '/FOODSAVE_USER.html');
  const original = await get(portal.headers.location);
  assert.equal(original.status, 200);
  assert.match(original.body, /Người mua/u);
  const redirected = await get('/nguoi-mua/?demo=1');
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.location, '/FOODSAVE_USER.html?demo=1');
  for (const [alias, original] of Object.entries({
    foodsave_user: 'FOODSAVE_USER.html',
    foodsave_partner: 'FOODSAVE_PARTNER.html',
    foodsave_charity: 'FOODSAVE_CHARITY.html',
    foodsave_volunteer: 'FOODSAVE_VOLUNTEER.html',
    admin_foodsave: 'ADMIN_FOODSAVE.html',
    foodsave_app: 'FOODSAVE_APP.html',
  })) {
    const response = await get(`/${alias}?demo=1`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `/${original}?demo=1`);
  }
});

test('rejects traversal, encoded traversal, backslashes and Windows alternate streams', async () => {
  for (const path of [
    '/../outside.html', '/%2e%2e/outside.html', '/frontend/%2e%2e/%2e%2e/outside.html',
    '/%5c..%5coutside.html', '/index.html%3Aextra',
  ]) assert.equal((await get(path)).status, 403, path);
});

test('rejects dotfiles and disallowed directories before looking for files', async () => {
  for (const path of [
    '/.hidden', '/frontend/.hidden', '/node_modules/example.js', '/dist/example.js',
    '/node_modules./example.js', '/node_modules%20/example.js', '/con.html',
  ]) {
    assert.equal((await get(path)).status, 403, path);
  }
});

test('malformed encoding is 400; missing files and directories are 404', async () => {
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('/missing.html')).status, 404);
  assert.equal((await get('/frontend/')).status, 404);
  assert.equal((await get('/constructor')).status, 404);
  assert.equal((await get('/toString')).status, 404);
});

test('disallows static writes', async () => {
  const response = await get('/index.html', { method: 'POST', body: 'example' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
});

test('does not follow directory links even to files inside the fixture', async (context) => {
  try {
    await symlink(join(publicDirectory, 'reference'), join(publicDirectory, 'shortcut'),
      process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      context.skip('Creating directory links is unavailable on this host.');
      return;
    }
    throw error;
  }
  assert.equal((await get('/shortcut/sample.html')).status, 404);
});

test('returns a clear 503 when API is not configured', async () => {
  const response = await get('/api/v1/health');
  assert.equal(response.status, 503);
  assert.match(response.headers['content-type'], /^application\/json/u);
  assert.equal(JSON.parse(response.body).error.code, 'LOCAL_API_NOT_CONFIGURED');
});

test('proxies the API path, query, method and request body', async () => {
  const upstream = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        method: request.method, path: request.url, body: Buffer.concat(chunks).toString(),
      }));
    });
  });
  const upstreamAddress = await listen(upstream);
  const proxied = createPreviewServer({
    publicDirectory,
    apiOrigin: `http://127.0.0.1:${upstreamAddress.port}`,
  });
  const proxiedAddress = await listen(proxied);
  try {
    const response = await get('/api/v1/auth/password-reset?view=compact', {
      port: proxiedAddress.port, method: 'POST', body: 'hello',
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(response.status, 201);
    assert.deepEqual(JSON.parse(response.body), {
      method: 'POST', path: '/api/v1/auth/password-reset?view=compact', body: 'hello',
    });
  } finally {
    await close(proxied);
    await close(upstream);
  }
});

test('unavailable API gives a 502 without internal error details', async () => {
  const unavailable = createServer();
  const unavailableAddress = await listen(unavailable);
  await close(unavailable);
  const proxied = createPreviewServer({
    publicDirectory,
    apiOrigin: `http://127.0.0.1:${unavailableAddress.port}`,
  });
  const proxiedAddress = await listen(proxied);
  try {
    const response = await get('/api/v1/health', { port: proxiedAddress.port });
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(response.body).error.code, 'LOCAL_API_UNAVAILABLE');
    assert.doesNotMatch(response.body, /ECONNREFUSED|stack|errno/u);
  } finally {
    await close(proxied);
  }
});

test('rejects invalid API origin configuration', () => {
  assert.throws(() => createPreviewServer({ publicDirectory, apiOrigin: 'file:///example' }), /API origin/u);
  assert.throws(() => createPreviewServer({ publicDirectory, apiOrigin: 'http://127.0.0.1:8080/path' }), /API origin/u);
});
