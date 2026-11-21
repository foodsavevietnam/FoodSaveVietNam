import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { createServer, request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const PAGE_ALIASES = Object.freeze({
  '/nguoi-mua': 'FOODSAVE_USER.html',
  '/doi-tac': 'FOODSAVE_PARTNER.html',
  '/tu-thien': 'FOODSAVE_CHARITY.html',
  '/tinh-nguyen': 'FOODSAVE_VOLUNTEER.html',
  '/quan-tri': 'ADMIN_FOODSAVE.html',
  '/ung-dung': 'FOODSAVE_APP.html',
  '/foodsave_user': 'FOODSAVE_USER.html',
  '/foodsave_partner': 'FOODSAVE_PARTNER.html',
  '/foodsave_charity': 'FOODSAVE_CHARITY.html',
  '/foodsave_volunteer': 'FOODSAVE_VOLUNTEER.html',
  '/admin_foodsave': 'ADMIN_FOODSAVE.html',
  '/foodsave_app': 'FOODSAVE_APP.html',
});

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
]);

const BLOCKED_DIRECTORIES = new Set([
  'node_modules', 'build', 'dist', 'out', 'coverage', '__pycache__',
]);
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function send(request, response, status, message, headers = {}) {
  const body = Buffer.from(message);
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

function sendApiError(request, response, status, code, message) {
  send(request, response, status, JSON.stringify({
    success: false,
    error: { code, message },
  }), { 'Content-Type': 'application/json; charset=utf-8' });
}

function parseRequestPath(rawUrl) {
  const queryIndex = rawUrl.indexOf('?');
  const rawPath = queryIndex < 0 ? rawUrl : rawUrl.slice(0, queryIndex);
  const pathname = decodeURIComponent(rawPath);
  if (!pathname.startsWith('/') || pathname.includes('\\')) return null;
  const segments = pathname.split('/').filter(Boolean);
  for (const segment of segments) {
    if (
      segment === '.' || segment === '..' ||
      /[<>:"|?*\u0000-\u001f\u007f]/u.test(segment)
    ) return null;
  }
  return { pathname, segments, query: queryIndex < 0 ? '' : rawUrl.slice(queryIndex) };
}

function areStaticSegmentsAllowed(segments) {
  return segments.every((segment) => !(
    segment.startsWith('.') || /[. ]$/u.test(segment) ||
    BLOCKED_DIRECTORIES.has(segment.toLowerCase()) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment) ||
    /^id_rsa/iu.test(segment) || /\.(pem|key)$/iu.test(segment) ||
    /(?:^|[-_.])(secret|credential|password|token)(?:[-_.]|$)/iu.test(segment)
  ));
}

function normalizeApiOrigin(apiOrigin) {
  if (!apiOrigin) return null;
  let parsed;
  try {
    parsed = new URL(apiOrigin);
  } catch {
    throw new Error('API origin phải là URL HTTP hoặc HTTPS hợp lệ.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) || parsed.username ||
    parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash
  ) throw new Error('API origin chỉ gồm giao thức, máy chủ và cổng.');
  return parsed;
}

function filteredHeaders(headers) {
  const connectionNames = String(headers.connection ?? '')
    .split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  return Object.fromEntries(Object.entries(headers).filter(([name]) =>
    name !== 'host' && !HOP_BY_HOP_HEADERS.has(name) && !connectionNames.includes(name),
  ));
}

function proxyApi(request, response, apiOrigin) {
  if (!apiOrigin) {
    sendApiError(request, response, 503, 'LOCAL_API_NOT_CONFIGURED',
      'Đang xem giao diện. Để dùng API, chạy backend và thêm --api-origin http://127.0.0.1:8080.');
    return;
  }
  const makeRequest = apiOrigin.protocol === 'https:' ? requestHttps : requestHttp;
  const upstream = makeRequest({
    protocol: apiOrigin.protocol,
    hostname: apiOrigin.hostname.replace(/^\[|\]$/gu, ''),
    port: apiOrigin.port || undefined,
    method: request.method,
    path: request.url,
    headers: { ...filteredHeaders(request.headers), host: apiOrigin.host },
    timeout: 10_000,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, {
      ...filteredHeaders(upstreamResponse.headers),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    upstreamResponse.on('error', () => response.destroy());
    upstreamResponse.pipe(response);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('API timeout')));
  upstream.on('error', () => {
    if (response.destroyed) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendApiError(request, response, 502, 'LOCAL_API_UNAVAILABLE',
      'Không kết nối được API. Kiểm tra backend và địa chỉ --api-origin.');
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => {
    if (!response.writableEnded) upstream.destroy();
  });
  request.pipe(upstream);
}

async function findStaticFile(publicDirectory, segments) {
  // Check every component before descending so a link never opens another tree.
  let current = publicDirectory;
  const rootInfo = await lstat(current);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return null;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) return null;
    if (index < segments.length - 1 && !info.isDirectory()) return null;
    if (index === segments.length - 1) return info.isFile() ? { path: current, info } : null;
  }
  return null;
}

/** Create a loopback preview server; this function does not read environment files. */
export function createPreviewServer({ publicDirectory, apiOrigin } = {}) {
  if (!publicDirectory) throw new Error('Cần cung cấp publicDirectory.');
  const root = resolve(publicDirectory);
  const api = normalizeApiOrigin(apiOrigin);

  return createServer(async (request, response) => {
    let route;
    try {
      route = parseRequestPath(request.url ?? '/');
    } catch {
      send(request, response, 400, 'Đường dẫn không hợp lệ.');
      return;
    }
    if (!route) {
      send(request, response, 403, 'Đường dẫn không được phép.');
      return;
    }
    if (route.pathname === '/api/v1' || route.pathname.startsWith('/api/v1/')) {
      proxyApi(request, response, api);
      return;
    }
    if (!areStaticSegmentsAllowed(route.segments)) {
      send(request, response, 403, 'Đường dẫn không được phép.');
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      send(request, response, 405, 'Chỉ hỗ trợ GET và HEAD cho tài nguyên tĩnh.', { Allow: 'GET, HEAD' });
      return;
    }
    const aliasPath = route.pathname.replace(/\/$/u, '');
    const alias = Object.hasOwn(PAGE_ALIASES, aliasPath) ? PAGE_ALIASES[aliasPath] : undefined;
    if (alias) {
      // Portal scripts determine the active role from the original HTML URL.
      send(request, response, 302, '', { Location: `/${alias}${route.query}` });
      return;
    }
    const fileName = route.pathname === '/' ? 'index.html' : undefined;
    const segments = fileName ? [fileName] : route.segments;
    const candidate = resolve(root, ...segments);
    const relativePath = relative(root, candidate);
    if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      send(request, response, 403, 'Đường dẫn không được phép.');
      return;
    }
    const contentType = CONTENT_TYPES.get(extname(candidate).toLowerCase());
    if (!contentType) {
      send(request, response, 404, 'Không tìm thấy tài nguyên.');
      return;
    }
    try {
      const file = await findStaticFile(root, segments);
      if (!file) {
        send(request, response, 404, 'Không tìm thấy tài nguyên.');
        return;
      }
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': file.info.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        ...(relativePath === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(file.path);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        send(request, response, 404, 'Không tìm thấy tài nguyên.');
        return;
      }
      send(request, response, 500, 'Không thể đọc tài nguyên giao diện.');
    }
  });
}
