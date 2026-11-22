// Khung giao diện: thanh bên 6 nhóm từ manifest, thanh trên (tiêu đề, tìm màn, chuông, người dùng), thanh tạm dừng poll.
// Không chạm document ở cấp module để Node import được (matchScreens có test offline).
import { html, raw, delegate } from './ui.js';

const BELL_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const MAX_SUGGESTIONS = 8;

// Bỏ dấu tiếng Việt, chữ thường, gộp khoảng trắng
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();

export function matchScreens(query, screens) {
  const q = fold(query);
  if (!q) return [];
  return screens.filter((s) => fold(s.title).includes(q) || s.id.includes(q));
}

const isTyping = (el) => Boolean(el && (el.isContentEditable || el.closest?.('input, textarea, select')));

export function mountShell({ root, screens, groups, state, navigate, onLogout, onBell, onResume }) {
  const doc = root.ownerDocument || root;
  const sidebar = root.querySelector('#sidebar');
  const topbar = root.querySelector('#topbar');
  const screenEl = root.querySelector('#screen');

  // Thanh bên
  sidebar.querySelector('.S-n')?.remove();
  const nav = doc.createElement('nav');
  nav.className = 'S-n';
  nav.setAttribute('aria-label', 'Danh mục quản trị');
  nav.innerHTML = groups.map((group) => {
    const items = screens.filter((s) => s.group === group);
    if (!items.length) return '';
    const links = items.map((s) => html`<a class="S-i" href="#/${s.id}" data-p="${s.id}" title="${s.title}"><span>${s.title}</span><em data-badge="${s.id}" hidden></em></a>`).join('');
    return html`<div class="S-s">${group}</div>${raw(links)}`;
  }).join('');
  sidebar.appendChild(nav);
  delegate(nav, 'click', '.S-i[data-p]', (e, el) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(el.dataset.p);
  });

  // Thanh trên
  topbar.innerHTML = html`<h2 id="pt"></h2>
    <div class="T-r">
      <div class="T-s" data-role="search">
        <input id="globalSearch" type="search" autocomplete="off" placeholder="Tìm màn… (phím /)" aria-label="Tìm màn"
          aria-controls="globalSearchList" aria-expanded="false">
        <div id="globalSearchList" class="T-sug" role="listbox" hidden></div>
      </div>
      <button type="button" id="bell" class="bt" aria-label="Hoạt động gần đây" title="Hoạt động gần đây">${raw(BELL_SVG)}</button>
      <div class="T-u"><b data-role="admin-name">Quản trị viên</b><small data-role="admin-email"></small></div>
      <button type="button" class="bt" data-act="logout">Đăng xuất</button>
    </div>`;
  const title = topbar.querySelector('#pt');
  const search = topbar.querySelector('#globalSearch');
  const list = topbar.querySelector('#globalSearchList');
  const searchBox = topbar.querySelector('[data-role="search"]');

  const hideSuggestions = () => { list.hidden = true; list.innerHTML = ''; search.setAttribute('aria-expanded', 'false'); };
  const go = (id) => { search.value = ''; hideSuggestions(); search.blur(); navigate(id); };
  const showSuggestions = () => {
    const q = search.value;
    if (!q.trim()) { hideSuggestions(); return; }
    const found = matchScreens(q, screens).slice(0, MAX_SUGGESTIONS);
    list.innerHTML = found.length
      ? found.map((s) => html`<button type="button" role="option" data-p="${s.id}">${s.title}</button>`).join('')
      : html`<p>Không có màn phù hợp.</p>`;
    list.hidden = false;
    search.setAttribute('aria-expanded', 'true');
  };
  search.addEventListener('input', showSuggestions);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const [first] = matchScreens(search.value, screens);
      if (first) go(first.id);
    } else if (e.key === 'Escape') {
      search.value = '';
      hideSuggestions();
      search.blur();
    }
  });
  // Giữ focus ở ô tìm khi bấm gợi ý để sự kiện click vẫn tới
  list.addEventListener('mousedown', (e) => e.preventDefault());
  delegate(list, 'click', '[data-p]', (_e, el) => go(el.dataset.p));
  searchBox.addEventListener('focusout', (e) => { if (!searchBox.contains(e.relatedTarget)) hideSuggestions(); });
  doc.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (doc.body.classList.contains('admin-locked')) return;
    e.preventDefault();
    search.focus();
    search.select();
  });

  topbar.querySelector('#bell').addEventListener('click', () => onBell?.());
  topbar.querySelector('[data-act="logout"]').addEventListener('click', () => onLogout?.());

  // Thanh "đã tạm dừng cập nhật"
  let bar = root.querySelector('.poll-paused');
  if (!bar) {
    bar = doc.createElement('div');
    bar.className = 'poll-paused';
    bar.setAttribute('role', 'button');
    bar.tabIndex = 0;
    bar.hidden = true;
    bar.textContent = 'Đã tạm dừng cập nhật — bấm để tiếp tục';
    screenEl.before(bar);
  }
  bar.addEventListener('click', () => onResume?.());
  bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onResume?.(); } });

  function setActive(id) {
    nav.querySelectorAll('.S-i').forEach((el) => {
      const on = el.dataset.p === id;
      el.classList.toggle('on', on);
      if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    const screen = screens.find((s) => s.id === id);
    title.textContent = screen ? screen.title : '';
  }

  // Chỉ hiện số khi > 0 (spec mục 3)
  function setBadges(work) {
    screens.forEach((s) => {
      const em = nav.querySelector(`[data-badge="${s.id}"]`);
      if (!em) return;
      let value = 0;
      try { value = s.badge ? s.badge(work || {}) : 0; } catch (error) { console.warn('[MIO] Lỗi tính huy hiệu:', error); }
      em.textContent = value > 0 ? String(value) : '';
      em.hidden = !(value > 0);
    });
  }

  function setAdmin(admin) {
    topbar.querySelector('[data-role="admin-name"]').textContent = admin?.full_name || 'Quản trị viên';
    topbar.querySelector('[data-role="admin-email"]').textContent = admin?.email || '';
  }

  function setPaused(paused) { bar.hidden = !paused; }

  if (state?.admin) setAdmin(state.admin);
  if (state?.work) setBadges(state.work);
  return { setActive, setBadges, setAdmin, setPaused };
}
