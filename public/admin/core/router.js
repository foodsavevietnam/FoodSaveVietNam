// Hash router: '#/orders?page=2' ↔ { screen, params }. Chỉ chạm window khi start()/navigate().
const DEFAULT_SCREEN = 'today';

export function parseHash(hash) {
  const raw = String(hash ?? '').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const screen = path === '' ? DEFAULT_SCREEN : /^[a-z0-9_-]+$/.test(path) ? path : DEFAULT_SCREEN;
  const params = {};
  if (screen === path) {
    for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  }
  return { screen, params };
}

export function buildHash(screen, params = {}) {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `#/${screen}${query ? `?${query}` : ''}`;
}

export function createRouter({ onChange }) {
  const current = () => parseHash(window.location.hash);
  const handle = () => onChange(current());
  return {
    start() {
      window.addEventListener('hashchange', handle);
      handle();
    },
    navigate(screen, params = {}) {
      const next = buildHash(screen, params);
      if (window.location.hash === next) handle();
      else window.location.hash = next;
    },
    current,
  };
}
