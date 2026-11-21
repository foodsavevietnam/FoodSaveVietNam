import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

export const HTML_FILES = Object.freeze([
  'index.html',
  'FOODSAVE_USER.html',
  'FOODSAVE_APP.html',
  'FOODSAVE_PARTNER.html',
  'FOODSAVE_CHARITY.html',
  'FOODSAVE_VOLUNTEER.html',
  'ADMIN_FOODSAVE.html',
  'chinh-sach.html',
  'dieu-khoan.html',
  'offline.html',
  'FOODSAVE_APP_demo.html',
  'FOODSAVE_PARTNER_v2.html',
  'ADMIN_FOODSAVE_v2.html',
]);

export const FRONTEND_FILES = Object.freeze([
  'frontend/admin-v2.css',
  'frontend/admin-v2.js',
  'frontend/partner-v2.css',
  'frontend/partner-v2.js',
  'frontend/mio-demo-mode.js',
  'frontend/foodsave-config.js',
  'frontend/mio-brand.css',
  'frontend/neon-activity.js',
  'frontend/neon-realtime-client.mjs',
  'frontend/foodsave-responsive.css',
  'frontend/foodsave-pwa.js',
  'frontend/foodsave-order-flow.js',
  'frontend/foodsave-minimal.css',
  'frontend/foodsave-matching.js',
  'frontend/foodsave-map.js',
  'frontend/foodsave-map.css',
  'frontend/foodsave-live-data.js',
  'frontend/foodsave-legal-content.js',
  'frontend/foodsave-install.js',
  'frontend/foodsave-cookie-consent.js',
  'frontend/foodsave-cookie-consent.css',
  'frontend/foodsave-auth-client.js',
]);

export const MANIFEST_FILES = Object.freeze([
  'manifest-app.webmanifest',
  'manifest-user.webmanifest',
  'manifest-volunteer.webmanifest',
]);

const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const SITE_ORIGIN = 'https://foodsave.local';
const BLOCKED_DIRECTORIES = new Set([
  'node_modules', 'build', 'dist', 'out', 'coverage', '__pycache__',
]);
const BLOCKED_FILE = /(?:\.(?:pem|key)$|^id_rsa|secret|credential|token|password)/i;

function isAllowedPath(relativePath) {
  return relativePath.split('/').every((segment) => (
    segment && segment !== '..' && !segment.startsWith('.')
    && !BLOCKED_DIRECTORIES.has(segment.toLowerCase())
    && !BLOCKED_FILE.test(segment)
  ));
}

function decodeHtmlEntities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[0-9a-f]+|\d+);/gi, (entity) => {
    const names = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (entity[1] !== '#') return names[entity.toLowerCase()] ?? entity;
    const hex = entity[2].toLowerCase() === 'x';
    const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** Resolve a static reference without opening or probing its target. */
export function resolveLocalReference(value, sourceFile = 'index.html') {
  const reference = decodeHtmlEntities(value).trim();
  if (!reference || reference.startsWith('#') || reference.startsWith('//')
    || /^[a-z][a-z\d+.-]*:/i.test(reference)
    || reference.includes('${') || reference.includes('{{') || reference.includes('<%')) {
    return null;
  }
  if (reference.includes('\\') || /[\u0000-\u001f\u007f]/.test(reference)) {
    throw new Error('Invalid local resource path');
  }
  const url = new URL(reference, `${SITE_ORIGIN}/${sourceFile}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new Error('Invalid URL encoding in local resource path');
  }
  if (pathname.includes('\\') || /[\u0000-\u001f\u007f]/.test(pathname)) {
    throw new Error('Invalid local resource path');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const relativePath = pathname.replace(/^\/+/, '');
  if (!isAllowedPath(relativePath)) throw new Error('Local reference points outside allowed public assets');
  return relativePath;
}

function attributesFromTag(tag) {
  const attributes = new Map();
  const matcher = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tag.matchAll(matcher)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** Extract actual HTML references, excluding markup embedded in script/style text. */
export function inspectHtml(text) {
  const references = [];
  const scripts = [];
  const matcher = /<!--[\s\S]*?-->|<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(link|img|a)\b([^>]*)>/gi;
  for (const match of text.matchAll(matcher)) {
    if (match[0].startsWith('<!--')) continue;
    const tagName = (match[1] ?? match[4]).toLowerCase();
    const attributes = attributesFromTag(match[2] ?? match[5]);
    const line = text.slice(0, match.index).split('\n').length;
    const attribute = tagName === 'script' || tagName === 'img' ? 'src' : 'href';
    if (attributes.has(attribute)) {
      references.push({ value: attributes.get(attribute), line });
    }
    const type = (attributes.get('type') ?? '').trim().toLowerCase();
    if (tagName === 'script' && !attributes.has('src')
      && ['', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) {
      scripts.push({ code: match[3], line });
    }
  }
  return { references, scripts };
}

async function assertPublicFile(publicRoot, relativeFile) {
  if (!isAllowedPath(relativeFile)) throw new Error('Path is outside allowed public assets');
  const root = await lstat(publicRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Public root must be a real directory');
  const segments = relativeFile.split('/');
  let candidate = publicRoot;
  for (let index = 0; index < segments.length; index += 1) {
    candidate = path.join(candidate, segments[index]);
    const entry = await lstat(candidate);
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in public assets');
    if (index === segments.length - 1 ? !entry.isFile() : !entry.isDirectory()) {
      throw new Error('Expected a public asset file');
    }
  }
  return candidate;
}

/** Validate only the explicit site entrypoints; never recurse into project directories. */
export async function checkProject({ publicRoot = DEFAULT_PUBLIC_ROOT } = {}) {
  const issues = [];
  let checkedReferences = 0;
  let checkedScripts = 0;
  const contents = new Map();
  const files = [...HTML_FILES, ...FRONTEND_FILES, ...MANIFEST_FILES, 'sw.js'];

  const addIssue = (file, line, message) => issues.push({ file, line, message });
  for (const file of files) {
    try {
      const absolutePath = await assertPublicFile(publicRoot, file);
      contents.set(file, await readFile(absolutePath, 'utf8'));
    } catch (error) {
      addIssue(file, 1, error.code === 'ENOENT' ? 'Required public file is missing' : 'Cannot safely read public file');
    }
  }

  async function checkReference(file, { value, line = 1 }) {
    let relativeFile;
    try {
      relativeFile = resolveLocalReference(value, file);
      if (relativeFile === null) return;
      checkedReferences += 1;
      await assertPublicFile(publicRoot, relativeFile);
    } catch (error) {
      const message = error.code === 'ENOENT'
        ? `Missing local resource: ${relativeFile}`
        : 'Invalid or disallowed local resource';
      addIssue(file, line, message);
    }
  }

  function checkScript(file, code, line = 1) {
    checkedScripts += 1;
    try {
      new vm.Script(code, { filename: file, lineOffset: line - 1 });
    } catch {
      addIssue(file, line, 'JavaScript syntax error');
    }
  }

  for (const file of HTML_FILES) {
    const content = contents.get(file);
    if (content === undefined) continue;
    const { references, scripts } = inspectHtml(content);
    for (const reference of references) await checkReference(file, reference);
    for (const script of scripts) checkScript(file, script.code, script.line);
  }

  for (const file of FRONTEND_FILES) {
    const content = contents.get(file);
    if (content === undefined) continue;
    if (file.endsWith('.js')) checkScript(file, content);
    if (file.endsWith('.mjs')) {
      checkedScripts += 1;
      const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
        input: content,
        encoding: 'utf8',
        windowsHide: true,
      });
      if (result.error || result.status !== 0) addIssue(file, 1, 'JavaScript module syntax error');
    }
    if (file.endsWith('.css')) {
      for (const match of content.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
        await checkReference(file, { value: match[1] ?? match[2] ?? match[3] });
      }
    }
  }

  for (const file of MANIFEST_FILES) {
    const content = contents.get(file);
    if (content === undefined) continue;
    try {
      const manifest = JSON.parse(content);
      for (const value of [manifest.start_url, manifest.id, manifest.scope,
        ...(manifest.icons ?? []).map((icon) => icon.src),
        ...(manifest.shortcuts ?? []).flatMap((shortcut) => [shortcut.url, ...(shortcut.icons ?? []).map((icon) => icon.src)])]) {
        if (typeof value === 'string') await checkReference(file, { value });
      }
    } catch {
      addIssue(file, 1, 'Invalid PWA manifest');
    }
  }

  const serviceWorker = contents.get('sw.js');
  if (serviceWorker !== undefined) {
    checkScript('sw.js', serviceWorker);
    // Only cache-shell declarations contain static shell assets. Other URL strings
    // can be API routes or request matching patterns and should not be probed.
    const shell = serviceWorker.match(/\b(?:SHELL|SHELL_URLS|PRECACHE_URLS)\s*=\s*\[([\s\S]*?)\]/);
    if (shell) {
      for (const match of shell[1].matchAll(/["']([^"']+)["']/g)) {
        await checkReference('sw.js', { value: match[1] });
      }
    }
  }

  return { issues, checkedFiles: contents.size, checkedReferences, checkedScripts };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await checkProject();
  if (result.issues.length) {
    for (const issue of result.issues) console.error(`${issue.file}:${issue.line}: ${issue.message}`);
    console.error(`Project check failed: ${result.issues.length} issue(s).`);
    process.exitCode = 1;
  } else {
    console.log(`Project check passed: ${result.checkedFiles} files, ${result.checkedReferences} local references, ${result.checkedScripts} JavaScript blocks.`);
  }
}
