import { lstat, readdir, readFile } from 'node:fs/promises';
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
  'admin/index.html',
]);

// Module ES của cổng quản trị mới (bổ sung dần theo từng task).
export const ADMIN_MODULE_FILES = Object.freeze([
  'admin/core/config.js',
  'admin/core/app.js',
  'admin/core/api.js',
  'admin/core/router.js',
  'admin/core/ui.js',
  'admin/core/format.js',
  'admin/core/vi.js',
  'admin/core/table.js',
  'admin/core/poll.js',
  'admin/core/auth.js',
  'admin/core/state.js',
  'admin/core/shell.js',
  'admin/screens/manifest.js',
  'admin/screens/_pending.js',
  'admin/screens/today.js',
  'admin/screens/audit.js',
  'admin/screens/complaints.js',
  'admin/screens/verify.js',
  'admin/screens/payouts.js',
  'admin/screens/alerts.js',
  'admin/screens/rules.js',
  'admin/screens/vouchers.js',
  'admin/screens/esg.js',
  'admin/demo/index.js',
  'admin/demo/fixtures/work.js',
  'admin/demo/fixtures/complaints.js',
  'admin/demo/fixtures/verify.js',
  'admin/demo/fixtures/payouts.js',
  'admin/demo/fixtures/alerts.js',
  'admin/demo/fixtures/audit.js',
  'admin/demo/fixtures/finance.js',
  'admin/demo/fixtures/labels.js',
  'admin/demo/fixtures/esg.js',
  'admin/demo/fixtures/automation.js',
  'admin/demo/fixtures/policy.js',
  'admin/demo/fixtures/vouchers.js',
  'admin/screens/customers.js',
  'admin/demo/fixtures/customers.js',
  'admin/screens/stores.js',
  'admin/demo/fixtures/stores.js',
  'admin/screens/charities.js',
  'admin/demo/fixtures/charities.js',
  'admin/screens/orders.js',
  'admin/demo/fixtures/orders.js',
  'admin/screens/donations.js',
  'admin/demo/fixtures/donations.js',
  'admin/screens/tracking.js',
  'admin/demo/fixtures/tracking.js',
  'admin/screens/inventory.js',
  'admin/demo/fixtures/inventory.js',
  'admin/screens/ledger.js',
  'admin/demo/fixtures/ledger.js',
  'admin/screens/marketing.js',
  'admin/demo/fixtures/marketing.js',
  'admin/screens/settings.js',
  'admin/demo/fixtures/settings.js',
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
  'frontend/foodsave-location.js',
  'frontend/foodsave-location.css',
  'frontend/foodsave-live-data.js',
  'frontend/foodsave-legal-content.js',
  'frontend/foodsave-install.js',
  'frontend/foodsave-cookie-consent.js',
  'frontend/foodsave-cookie-consent.css',
  'frontend/foodsave-auth-client.js',
  'frontend/mio-chatbot.js',
  'frontend/mio-chatbot.css',
  'admin/styles/admin.css',
]);

export const MANIFEST_FILES = Object.freeze([
  'manifest-app.webmanifest',
  'manifest-user.webmanifest',
  'manifest-volunteer.webmanifest',
]);

const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const DEFAULT_PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE_ORIGIN = 'https://foodsave.local';
const BLOCKED_DIRECTORIES = new Set([
  'node_modules', 'build', 'dist', 'out', 'coverage', '__pycache__',
]);
const IGNORED_PROJECT_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.netlify', '.neon', 'playwright-report', 'test-results', '.superpowers',
]);
const BLOCKED_FILE = /(?:\.(?:pem|key)$|^id_rsa|secret|credential|token|password)/i;
const BACKUP_FILE = /\.bak(?:$|[-_.])/i;

function isAllowedPath(relativePath) {
  return relativePath.split('/').every((segment, index) => (
    segment && segment !== '..'
    && (!segment.startsWith('.') || (index === 0 && segment === '.well-known'))
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

async function scanPublicDirectory(publicRoot, addIssue) {
  const discoveredCodeFiles = [];
  const reportedSqlInPublic = new Set();
  let rootStat;
  try {
    rootStat = await lstat(publicRoot);
  } catch {
    addIssue('.', 1, 'Public root is missing or unreadable');
    return { discoveredCodeFiles, reportedSqlInPublic };
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    addIssue('.', 1, 'Public root must be a real directory');
    return { discoveredCodeFiles, reportedSqlInPublic };
  }

  async function walk(currentDir, relativeDir) {
    let names;
    try {
      names = (await readdir(currentDir)).sort();
    } catch {
      addIssue(relativeDir || '.', 1, 'Cannot list public directory');
      return;
    }
    for (const name of names) {
      const relPath = relativeDir ? `${relativeDir}/${name}` : name;
      let entry;
      try {
        entry = await lstat(path.join(currentDir, name));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        addIssue(relPath, 1, 'Cannot stat public entry');
        continue;
      }
      if (entry.isSymbolicLink()) {
        addIssue(relPath, 1, 'Symbolic links are not allowed in public assets');
        continue;
      }
      if (name.startsWith('.') && !(relPath === '.well-known' && entry.isDirectory())) {
        addIssue(relPath, 1, 'Hidden or sensitive file is not allowed in public assets');
        continue;
      }
      if (entry.isDirectory() && BLOCKED_DIRECTORIES.has(name.toLowerCase())) {
        addIssue(relPath, 1, 'Disallowed directory in public assets');
        continue;
      }
      if (BACKUP_FILE.test(name)) {
        addIssue(relPath, 1, 'Backup file is not allowed in public assets');
        if (entry.isDirectory()) continue;
      }
      if (BLOCKED_FILE.test(name)) {
        addIssue(relPath, 1, 'Blocked or sensitive file is not allowed in public assets');
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) {
        await walk(path.join(currentDir, name), relPath);
      } else if (entry.isFile()) {
        if (name.toLowerCase().endsWith('.sql')) {
          reportedSqlInPublic.add(relPath);
          addIssue(relPath, 1, 'SQL files are only allowed inside database/');
        } else if (
          (relPath.startsWith('frontend/') || relPath.startsWith('admin/'))
          && /\.(?:js|mjs|css)$/i.test(name)
          && isAllowedPath(relPath)
        ) {
          discoveredCodeFiles.push(relPath);
        }
      }
    }
  }

  await walk(publicRoot, '');
  return { discoveredCodeFiles, reportedSqlInPublic };
}

async function scanStraySqlFiles(projectRoot, addIssue, reportedSqlInPublic = new Set()) {
  if (!projectRoot) return;
  let rootStat;
  try {
    rootStat = await lstat(projectRoot);
  } catch {
    return;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;

  async function walk(currentDir, relativeDir) {
    let names;
    try {
      names = (await readdir(currentDir)).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const relPath = relativeDir ? `${relativeDir}/${name}` : name;
      if (relPath === 'database') continue;
      let entry;
      try {
        entry = await lstat(path.join(currentDir, name));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_PROJECT_DIRS.has(name) || name.startsWith('_backup_')) continue;
        await walk(path.join(currentDir, name), relPath);
      } else if (entry.isFile() && name.toLowerCase().endsWith('.sql')) {
        if (relPath.startsWith('public/') && reportedSqlInPublic.has(relPath.slice('public/'.length))) continue;
        addIssue(relPath, 1, 'SQL files are only allowed inside database/');
      }
    }
  }

  await walk(projectRoot, '');
}

/** Validate site entrypoints, public directory hygiene, and SQL file placement. */
export async function checkProject({
  publicRoot = DEFAULT_PUBLIC_ROOT,
  projectRoot = publicRoot === DEFAULT_PUBLIC_ROOT ? DEFAULT_PROJECT_ROOT : undefined,
} = {}) {
  const issues = [];
  let checkedReferences = 0;
  let checkedScripts = 0;
  const contents = new Map();
  const addIssue = (file, line, message) => issues.push({ file, line, message });

  const { discoveredCodeFiles, reportedSqlInPublic } = await scanPublicDirectory(publicRoot, addIssue);
  await scanStraySqlFiles(projectRoot, addIssue, reportedSqlInPublic);

  const codeFiles = [...new Set([...FRONTEND_FILES, ...ADMIN_MODULE_FILES, ...discoveredCodeFiles])];
  const files = [...new Set([...HTML_FILES, ...codeFiles, ...MANIFEST_FILES, 'sw.js'])];

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

  for (const file of codeFiles) {
    const content = contents.get(file);
    if (content === undefined) continue;
    if (file.endsWith('.js') && !file.startsWith('admin/')) checkScript(file, content);
    if (file.endsWith('.mjs') || (file.startsWith('admin/') && file.endsWith('.js'))) {
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
