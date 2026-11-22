// Bộ UI dùng chung: dựng HTML an toàn, toast, hộp xác nhận, ngăn kéo, trạng thái tải/rỗng/lỗi.
// Không chạm `document` ở cấp module để Node import được.
class Raw { constructor(s) { this.s = String(s); } toString() { return this.s; } }

export const raw = (str) => new Raw(str);

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return out;
}

const hasDom = () => typeof document !== 'undefined';

export function toast(message, kind = 'ok') {
  if (!hasDom()) return;
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'v2toast v2toast-' + kind;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Hộp xác nhận đang chờ: hàm đóng nó với một kết quả (chỉ có tối đa một hộp tại một thời điểm)
let pendingFinish = null;

// Đóng hộp xác nhận đang mở (rời màn, khóa cổng, mở hộp mới): Promise đang chờ nhận { ok: false }
export function closeModal() {
  if (!hasDom()) return;
  if (pendingFinish) { pendingFinish({ ok: false }); return; }
  const modal = document.getElementById('modal');
  if (modal) { modal.classList.remove('open'); modal.innerHTML = ''; }
}

export function confirm({ title, body, danger = false, reasonRequired = false, reasonOptional = false, reasonMax = 300, reasonLabel = 'Lý do', confirmText = 'Xác nhận' } = {}) {
  if (!hasDom()) return Promise.resolve({ ok: false });
  const modal = document.getElementById('modal');
  if (!modal) return Promise.resolve({ ok: false });
  closeModal(); // hộp cũ còn mở → trả { ok: false } trước khi vẽ hộp mới
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const hasReason = reasonRequired || reasonOptional;
    const reasonBox = hasReason
      ? html`<label style="display:block;margin-top:12px;font-size:.75rem;font-weight:700">${reasonLabel}
        <textarea data-role="reason" rows="3" maxlength="${reasonMax}" style="width:100%;margin-top:4px" placeholder="${reasonRequired ? 'Nhập ít nhất 3 ký tự' : 'Không bắt buộc'}"></textarea></label>`
      : '';
    modal.innerHTML = html`<div role="dialog" aria-modal="true" aria-label="${title}">
      <h3 style="margin:0 0 8px">${title}</h3>
      <div style="font-size:.85rem;color:var(--t2)">${body}</div>
      ${raw(reasonBox)}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button type="button" class="bt" data-role="cancel">Hủy</button>
        <button type="button" class="bt ${danger ? 'b-e' : 'bt-p'}" data-role="ok">${confirmText}</button>
      </div></div>`;
    modal.classList.add('open');
    const ok = modal.querySelector('[data-role="ok"]');
    const reasonEl = modal.querySelector('[data-role="reason"]');
    const valid = () => !reasonRequired || reasonEl.value.trim().length >= 3;
    const finish = (result) => {
      if (pendingFinish !== finish) return; // đã đóng rồi
      pendingFinish = null;
      modal.classList.remove('open');
      modal.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(result);
    };
    pendingFinish = finish;
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish({ ok: false }); } }
    document.addEventListener('keydown', onKey, true);
    modal.querySelector('[data-role="cancel"]').addEventListener('click', () => finish({ ok: false }));
    ok.addEventListener('click', () => {
      if (valid()) finish(hasReason ? { ok: true, reason: reasonEl.value.trim().slice(0, reasonMax) } : { ok: true });
    });
    if (reasonEl) reasonEl.addEventListener('input', () => { ok.disabled = !valid(); });
    ok.disabled = !valid();
    (reasonEl || ok).focus();
  });
}

export const drawer = {
  open(htmlString, { title = '' } = {}) {
    if (!hasDom()) return;
    const el = document.getElementById('drawer');
    if (!el) return;
    el.innerHTML = html`<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--bd)">
      <b>${title}</b><button type="button" class="bt" data-role="drawer-close" aria-label="Đóng">Đóng</button></div>`
      + htmlString;
    el.querySelector('[data-role="drawer-close"]').addEventListener('click', () => drawer.close());
    el.classList.add('open');
  },
  close() {
    if (!hasDom()) return;
    const el = document.getElementById('drawer');
    if (el) { el.classList.remove('open'); el.innerHTML = ''; }
  },
};

export function delegate(root, event, selector, handler) {
  const fn = (e) => {
    const target = e.target && e.target.closest ? e.target.closest(selector) : null;
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(event, fn);
  return () => root.removeEventListener(event, fn);
}

export function loading(container, text = 'Đang tải…') {
  container.innerHTML = html`<div aria-busy="true" aria-label="${text}" style="display:grid;gap:8px;padding:12px">
    <div class="skeleton" style="height:14px"></div><div class="skeleton" style="height:14px;width:80%"></div><div class="skeleton" style="height:14px;width:60%"></div></div>`;
}

export function empty(container, text, hint) {
  const hintHtml = hint ? html`<div style="font-size:.78rem;margin-top:4px">${hint}</div>` : '';
  container.innerHTML = html`<div style="padding:32px 16px;text-align:center;color:var(--t3)">
    <div style="font-weight:700">${text}</div>${raw(hintHtml)}</div>`;
}

export function error(container, err, retry) {
  const codeHtml = err && err.code ? html`<small style="color:var(--t3)">${err.code}</small>` : '';
  container.innerHTML = html`<div role="alert" style="padding:24px 16px;text-align:center">
    <div style="font-weight:700;color:var(--err)">${(err && err.message) || 'Có lỗi xảy ra.'}</div>
    ${raw(codeHtml)}
    <div style="margin-top:10px"><button type="button" class="bt" data-role="retry">Thử lại</button></div></div>`;
  const btn = container.querySelector('[data-role="retry"]');
  if (btn && retry) btn.addEventListener('click', () => retry());
}
