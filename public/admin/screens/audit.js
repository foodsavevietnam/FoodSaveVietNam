// Màn "Nhật ký": ai làm gì. Chỉ tải khi vào màn và khi bấm Lọc (không poll).
import { stamp, vnd } from '../core/format.js';
import { ACTIONS, actionLabel } from '../core/vi.js';
import { dataTable } from '../core/table.js';

const LIMIT = 100;
const DETAIL_MAX = 300;

// Nhóm hành động (tiền tố) và loại đối tượng hiển thị bằng tiếng Việt.
const ACTION_GROUPS = {
  'verification.': 'Duyệt hồ sơ', 'customer.': 'Người mua', 'complaint.': 'Khiếu nại', 'withdrawal.': 'Rút tiền',
  'payout_account.': 'Tài khoản nhận tiền', 'automation.': 'Tác vụ tự động', 'voucher.': 'Khuyến mãi',
  'fraud.': 'Cảnh báo gian lận', 'policy.': 'Quy tắc đơn hàng', 'settings.': 'Cài đặt',
};
const TARGETS = {
  store: 'Cửa hàng', charity: 'Tổ chức', customer: 'Người mua', complaint: 'Khiếu nại', voucher: 'Khuyến mãi',
  fraud_alert: 'Cảnh báo gian lận', order_policy: 'Quy tắc đơn hàng', automation: 'Tác vụ tự động',
  withdrawal: 'Lệnh rút', payout_account: 'Tài khoản nhận tiền', app_setting: 'Cài đặt',
};
// Chỉ nhóm có thật trong bảng ACTIONS
const GROUP_OPTIONS = Object.entries(ACTION_GROUPS).filter(([prefix]) => Object.keys(ACTIONS).some((k) => k.startsWith(prefix)));

const rows = (data) => (Array.isArray(data) ? data : data?.items || []);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const yesNo = (v) => (v ? 'Có' : 'Không');

// Khóa chi tiết đã biết → nhãn tiếng Việt và cách hiện giá trị; khóa lạ hiện nguyên ở phần "Khác".
const DETAIL_KEYS = {
  refund_cents: ['Số tiền hoàn', (v) => vnd(v)],
  is_false_claim: ['Khiếu nại sai', yesNo],
  bank_txn_ref: ['Mã giao dịch'],
  note: ['Ghi chú'],
  reason: ['Lý do'],
  name: ['Tên'],
  code: ['Mã khuyến mãi'],
  key: ['Khóa'],
  before: ['Trước'],
  after: ['Sau'],
};

function valueText(v) {
  if (typeof v === 'boolean') return yesNo(v);
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  let text;
  try { text = JSON.stringify(v); } catch { text = String(v); }
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text;
}

// Chi tiết một dòng nhật ký: { known: [[nhãn, giá trị]], other: [[khóa thô, giá trị]] }, bỏ giá trị rỗng.
export function detailRows(detail) {
  const known = [];
  const other = [];
  if (detail == null || typeof detail !== 'object' || Array.isArray(detail)) {
    if (detail != null && detail !== '') other.push(['', valueText(detail)]);
    return { known, other };
  }
  for (const [key, value] of Object.entries(detail)) {
    if (value == null || value === '') continue;
    if (own(DETAIL_KEYS, key)) {
      const [label, show] = DETAIL_KEYS[key];
      known.push([label, show ? show(value) : valueText(value)]);
    } else {
      other.push([key, valueText(value)]);
    }
  }
  return { known, other };
}

// Mã đối tượng rút gọn: UUID → 8 ký tự đầu; mã ngắn (khóa cài đặt, tên tác vụ) giữ nguyên, quá dài thì cắt.
export function shortId(id) {
  const s = String(id ?? '');
  if (/^[0-9a-f]{8}-[0-9a-f-]{4,}$/i.test(s)) return s.slice(0, 8);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

export default {
  id: 'audit',
  title: 'Nhật ký',
  group: 'HỆ THỐNG',

  async render(container, ctx) {
    const { html, raw, loading, empty, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div class="P" data-screen="audit">
      <div class="P-h"><span class="P-t">Nhật ký hoạt động</span></div>
      <form data-role="filter-form" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;padding:12px 16px;border-bottom:1px solid var(--bd)">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:600">Nhóm hành động
          <select name="action_group"><option value="">Tất cả</option>
            ${raw(GROUP_OPTIONS.map(([prefix, text]) => html`<option value="${prefix}">${text}</option>`).join(''))}
          </select></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:600">Hoặc tự nhập tiền tố
          <input name="action_custom" type="text" maxlength="80" placeholder="vd: voucher." autocomplete="off"></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:600">Người làm
          <select name="actor_id"><option value="">Tất cả</option></select></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:600">Loại đối tượng
          <select name="target_type"><option value="">Tất cả</option>
            ${raw(Object.entries(TARGETS).map(([value, text]) => html`<option value="${value}">${text}</option>`).join(''))}
          </select></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:600">Từ ngày
          <input name="from" type="date"></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:600">Đến ngày
          <input name="to" type="date"></label>
        <button type="submit" class="bt bt-p" data-act="filter">Lọc</button>
      </form>
      <div class="W" data-role="result"></div>
    </div>`;
    const root = container.firstElementChild;
    const form = root.querySelector('[data-role="filter-form"]');
    const result = root.querySelector('[data-role="result"]');
    const alive = () => !signal.aborted && root.isConnected;

    function buildQuery() {
      const value = (name) => String(form.elements[name].value || '').trim();
      const params = new URLSearchParams({ limit: String(LIMIT) });
      const action = value('action_custom') || value('action_group');
      if (action) params.set('action', action);
      if (value('actor_id')) params.set('actor_id', value('actor_id'));
      if (value('target_type')) params.set('target_type', value('target_type'));
      // Ngày chọn theo giờ Việt Nam (+07:00), đủ cả ngày đến
      if (value('from')) params.set('from', `${value('from')}T00:00:00+07:00`);
      if (value('to')) params.set('to', `${value('to')}T23:59:59.999+07:00`);
      return params.toString();
    }

    // Người làm: gom dần từ các dòng đã tải (backend lọc được theo actor_id), giữ lựa chọn hiện tại
    const actors = new Map();
    const actorSelect = form.elements.actor_id;
    function syncActors(list) {
      let changed = false;
      for (const r of list) {
        if (!r.actor_id || actors.has(r.actor_id)) continue;
        actors.set(r.actor_id, r.actor_name || 'Không rõ tên');
        changed = true;
      }
      if (!changed) return;
      const selected = actorSelect.value;
      actorSelect.innerHTML = html`<option value="">Tất cả</option>${raw([...actors].map(([id, name]) => html`<option value="${id}">${name}</option>`).join(''))}`;
      actorSelect.value = selected;
    }

    function targetHtml(r) {
      const type = own(TARGETS, r.target_type) ? TARGETS[r.target_type] : r.target_type || '—';
      return r.target_id ? html`<span title="${r.target_id}">${type} · ${shortId(r.target_id)}</span>` : html`${type}`;
    }

    function detailHtml(r) {
      const { known, other } = detailRows(r.detail);
      if (!known.length && !other.length) return '—';
      const line = ([label, value]) => html`<div><b>${label}</b>${label ? ': ' : ''}${value}</div>`;
      const otherHtml = other.length
        ? html`<div style="margin-top:4px;color:var(--t3)">Khác</div>${raw(other.map(line).join(''))}` : '';
      return html`<details><summary>Xem</summary><div style="white-space:normal;margin-top:4px;font-size:.72rem;max-width:360px">${raw(known.map(line).join(''))}${raw(otherHtml)}</div></details>`;
    }

    let seq = 0;
    async function load() {
      const mine = ++seq;
      loading(result);
      try {
        const data = await api.get(`/admin/audit-log?${buildQuery()}`, { signal });
        if (!alive() || mine !== seq) return;
        const list = rows(data);
        syncActors(list);
        if (!list.length) { empty(result, 'Không có nhật ký phù hợp.'); return; }
        const table = dataTable({
          pageSize: LIMIT,
          rows: list,
          columns: [
            { key: 'created_at', label: 'Thời gian', render: (r) => html`${stamp(r.created_at)}` },
            { key: 'actor_name', label: 'Người làm', render: (r) => html`${r.actor_name || 'Hệ thống'}` },
            { key: 'action', label: 'Hành động', render: (r) => html`${actionLabel(r.action)}` },
            { key: 'target_id', label: 'Đối tượng', render: targetHtml },
            { key: 'detail', label: 'Chi tiết', render: detailHtml },
          ],
          emptyText: 'Không có nhật ký phù hợp.',
        });
        result.innerHTML = table.html();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        error(result, err, load);
      }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
    await load();
  },
};
