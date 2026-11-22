// Màn "Khuyến mãi": bảng voucher, form tạo voucher toàn sàn trong drawer, bật/tắt có xác nhận.
// Kiểm tra phía client khớp voucherBodySchema + adminOpsService.createVoucher (server vẫn quyết định cuối).
// Không poll: dữ liệu ít đổi.
import { dt, vnd } from '../core/format.js';
import { badge } from '../core/vi.js';

const CODE_RE = /^[A-Za-z0-9_-]{3,30}$/;
const LOCAL_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/;
const INT_RE = /^\d+$/;
const MAX_MONEY = 100_000_000;

// Trạng thái hiển thị: ưu tiên `state` do server tính; thiếu thì tự tính theo đúng thứ tự của server
// (off, expired, scheduled, used_up, live).
export function voucherState(v, now = Date.now()) {
  if (v.state) return v.state;
  if (!v.is_active) return 'off';
  if (new Date(v.expires_at).getTime() < now) return 'expired';
  if (new Date(v.starts_at).getTime() > now) return 'scheduled';
  if (v.max_redemptions != null && v.redemption_count >= v.max_redemptions) return 'used_up';
  return 'live';
}

// `<input type="datetime-local">` là giờ Việt Nam → ISO có offset +07:00 (null nếu sai định dạng).
export function localToIso(value) {
  const m = LOCAL_RE.exec(String(value || '').trim());
  if (!m) return null;
  const iso = `${m[1]}${m[2] || ':00'}+07:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

const intIn = (text, min, max) => {
  const t = String(text ?? '').trim();
  const n = INT_RE.test(t) ? Number(t) : NaN;
  return n >= min && n <= max ? n : null;
};

// form: toàn chuỗi như người dùng nhập. Trả { errors, body }; body chỉ chứa trường có giá trị (server dùng .strict()).
export function voucherForm(form) {
  const errors = [];
  const body = {};
  const code = String(form.code ?? '').trim();
  const name = String(form.name ?? '').trim();
  const desc = String(form.description ?? '').trim();
  if (!CODE_RE.test(code)) errors.push('Mã chỉ gồm chữ, số, - và _ (3-30 ký tự)');
  else body.code = code;
  if (name.length < 2 || name.length > 120) errors.push('Tên phải từ 2 đến 120 ký tự');
  else body.name = name;
  if (desc.length > 300) errors.push('Mô tả tối đa 300 ký tự');
  else if (desc) body.description = desc;

  if (form.type === 'fixed') {
    const n = intIn(form.value, 1000, MAX_MONEY);
    if (n === null) errors.push(`Số tiền giảm phải là số nguyên từ 1.000đ đến ${vnd(MAX_MONEY)}`);
    else body.fixed_discount_cents = n;
  } else {
    const n = intIn(form.value, 1, 100);
    if (n === null) errors.push('Phần trăm giảm phải là số nguyên từ 1 đến 100');
    else body.percent_off = n;
  }

  if (String(form.min ?? '').trim() !== '') {
    const n = intIn(form.min, 0, MAX_MONEY);
    if (n === null) errors.push(`Đơn tối thiểu phải là số nguyên từ 0đ đến ${vnd(MAX_MONEY)}`);
    else body.min_order_cents = n;
  }
  if (String(form.max ?? '').trim() !== '') {
    const n = intIn(form.max, 1, 1_000_000);
    if (n === null) errors.push('Số lượt tối đa phải là số nguyên từ 1 đến 1.000.000');
    else body.max_redemptions = n;
  }

  const from = localToIso(form.from);
  const to = localToIso(form.to);
  if (!from) errors.push('Chọn thời gian bắt đầu');
  else body.starts_at = from;
  if (!to) errors.push('Chọn thời gian kết thúc');
  else body.expires_at = to;
  if (from && to && Date.parse(to) <= Date.parse(from)) errors.push('Ngày hết hạn phải sau ngày bắt đầu');
  return { errors, body };
}

const list = (v) => (Array.isArray(v) ? v : v?.items || []);

export default {
  id: 'vouchers',
  title: 'Khuyến mãi',
  group: 'TĂNG TRƯỞNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="vouchers"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    let rows = null;
    let seq = 0;
    const toggling = new Set(); // id đang bật/tắt (chặn bấm 2 lần)

    function draw() {
      const now = Date.now();
      const trs = rows.map((v) => {
        const value = v.percent_off ? `${v.percent_off}%` : vnd(v.fixed_discount_cents);
        const minNote = Number(v.min_order_cents) > 0 ? html`<br><small style="color:var(--t3)">đơn từ ${vnd(v.min_order_cents)}</small>` : '';
        const used = v.max_redemptions ? `${v.redemption_count} / ${v.max_redemptions}` : `${v.redemption_count} (không giới hạn)`;
        const off = toggling.has(v.id) ? raw(' disabled') : '';
        return html`<tr data-id="${v.id}"><td class="mn"><b>${v.code}</b></td><td>${v.name}</td>
          <td>${value}${raw(minNote)}</td>
          <td>${dt(v.starts_at)}<br><small style="color:var(--t3)">đến ${dt(v.expires_at)}</small></td>
          <td>${used}</td><td>${raw(badge('voucher', voucherState(v, now)))}</td>
          <td>${v.store_id ? v.store_name || '—' : 'Toàn sàn'}</td>
          <td><button type="button" class="bt bt-s" data-act="toggle" data-id="${v.id}"${off}>${v.is_active ? 'Tắt' : 'Bật'}</button></td></tr>`;
      }).join('');
      body.innerHTML = html`<div class="v2note">Voucher <b>toàn sàn</b> dùng được ở mọi cửa hàng; voucher do cửa hàng tạo chỉ dùng ở cửa hàng đó. Khách nhập mã khi thanh toán.</div>
        <section class="P"><div class="P-h"><span class="P-t">Danh sách voucher</span>
          <span><button type="button" class="bt bt-s" data-act="reload">Tải lại</button> <button type="button" class="bt bt-s bt-p" data-act="new">Tạo voucher</button></span></div>
          <div class="W"><table class="tbl"><thead><tr>${raw(['Mã', 'Tên', 'Mức giảm', 'Hiệu lực', 'Lượt dùng', 'Trạng thái', 'Phạm vi', ''].map((h) => html`<th>${h}</th>`).join(''))}</tr></thead>
          <tbody>${raw(trs || html`<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:18px">Chưa có voucher nào.</td></tr>`)}</tbody></table></div></section>`;
    }

    async function load({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !rows) loading(body);
      try {
        const d = await api.get('/admin/vouchers', { signal });
        if (!alive() || mine !== seq) return;
        rows = list(d);
        draw();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && rows) { ctx.ui.toast(err?.message || 'Không tải lại được danh sách', 'err'); return; }
        error(body, err, () => load());
      }
    }

    async function toggle(id) {
      if (toggling.has(id)) return;
      const v = rows?.find((r) => r.id === id);
      if (!v) return;
      const next = !v.is_active;
      const res = await ctx.ui.confirm({
        title: `${next ? 'Bật' : 'Tắt'} voucher ${v.code}?`,
        body: next ? 'Khách có thể dùng lại mã này (nếu còn hiệu lực).' : 'Khách sẽ không dùng được mã này nữa. Có thể bật lại sau.',
        danger: !next, confirmText: next ? 'Bật voucher' : 'Tắt voucher',
      });
      if (!res.ok || !alive()) return;
      toggling.add(id);
      draw();
      try {
        await api.patch(`/admin/vouchers/${encodeURIComponent(id)}`, { is_active: next }, { signal });
        if (!alive()) return;
        ctx.ui.toast(next ? 'Đã bật voucher' : 'Đã tắt voucher');
      } catch (err) {
        if (err?.name === 'AbortError' || !alive()) return;
        ctx.ui.toast(err?.message || 'Không đổi được trạng thái voucher', 'err');
      } finally {
        toggling.delete(id);
      }
      if (!alive()) return;
      await load({ quiet: true }); // tải lại để không giữ tham chiếu dòng cũ
      ctx.refreshWork();
    }

    function openForm() {
      const input = (id, label, attrs = '', extra = '') => html`<label style="display:block;margin-top:10px;font-size:.78rem">${label}<br><input id="${id}" ${raw(attrs)} style="width:100%;padding:6px">${raw(extra)}</label>`;
      ctx.ui.drawer.open(html`<div data-role="vc-drawer" style="padding:14px 18px">
        <div class="v2note">Voucher tạo ở đây là <b>toàn sàn</b>. Giờ nhập theo giờ Việt Nam.</div>
        ${raw(input('vc_code', 'Mã (3-30 ký tự: chữ, số, - và _)', 'type="text" maxlength="30" autocomplete="off" placeholder="GIOVANG10"'))}
        ${raw(input('vc_name', 'Tên', 'type="text" maxlength="120" autocomplete="off"'))}
        ${raw(input('vc_desc', 'Mô tả (không bắt buộc)', 'type="text" maxlength="300" autocomplete="off"'))}
        <fieldset style="border:0;padding:0;margin:12px 0 0;font-size:.78rem"><legend style="padding:0">Loại giảm</legend>
          <label><input type="radio" name="vc_type" id="vc_type_percent" value="percent" checked> Giảm theo %</label>
          <label style="margin-left:14px"><input type="radio" name="vc_type" id="vc_type_fixed" value="fixed"> Giảm số tiền (đ)</label></fieldset>
        ${raw(input('vc_val', 'Giá trị giảm', 'type="number" inputmode="numeric" min="1" step="1"', html`<small data-role="val-hint" style="color:var(--t3)">Từ 1 đến 100 (%)</small>`))}
        ${raw(input('vc_min', 'Đơn tối thiểu (đ, không bắt buộc)', 'type="number" inputmode="numeric" min="0" step="1"'))}
        ${raw(input('vc_from', 'Bắt đầu', 'type="datetime-local"'))}
        ${raw(input('vc_to', 'Kết thúc', 'type="datetime-local"'))}
        ${raw(input('vc_max', 'Số lượt dùng tối đa (không bắt buộc, bỏ trống = không giới hạn)', 'type="number" inputmode="numeric" min="1" step="1"'))}
        <div data-role="errors" class="v2note" role="alert" style="border-color:#f1b0ab;background:#fdf1f0;margin-top:12px" hidden></div>
        <div style="padding:12px 0"><button type="button" class="bt bt-p" data-act="create" disabled>Tạo voucher</button></div></div>`, { title: 'Tạo voucher toàn sàn' });

      const panel = document.querySelector('#drawer [data-role="vc-drawer"]');
      if (!panel) return;
      const q = (sel) => panel.querySelector(sel);
      const submit = q('[data-act="create"]');
      const errBox = q('[data-role="errors"]');
      let busy = false;
      let touched = false;
      let serverError = '';

      const read = () => ({
        code: q('#vc_code').value, name: q('#vc_name').value, description: q('#vc_desc').value,
        type: q('input[name="vc_type"]:checked').value, value: q('#vc_val').value,
        min: q('#vc_min').value, from: q('#vc_from').value, to: q('#vc_to').value, max: q('#vc_max').value,
      });
      function sync() {
        const form = read();
        q('[data-role="val-hint"]').textContent = form.type === 'fixed' ? 'Từ 1.000đ trở lên' : 'Từ 1 đến 100 (%)';
        const { errors } = voucherForm(form);
        const shown = touched ? [...errors] : [];
        if (serverError) shown.push(serverError);
        errBox.hidden = shown.length === 0;
        errBox.innerHTML = shown.length ? html`<ul style="margin:0;padding-left:18px">${raw(shown.map((m) => html`<li>${m}</li>`).join(''))}</ul>` : '';
        submit.disabled = busy || errors.length > 0;
      }
      const onEdit = () => { touched = true; serverError = ''; sync(); };
      panel.addEventListener('input', onEdit);
      panel.addEventListener('change', onEdit);
      sync();

      submit.addEventListener('click', async () => {
        if (busy) return;
        const { errors, body: payload } = voucherForm(read());
        if (errors.length) { touched = true; sync(); return; }
        busy = true; serverError = ''; sync();
        try {
          await api.post('/admin/vouchers', payload, { signal });
          if (!alive()) return;
          ctx.ui.toast('Đã tạo voucher toàn sàn');
          ctx.ui.drawer.close();
          busy = false;
          await load({ quiet: true });
          ctx.refreshWork();
        } catch (err) {
          if (err?.name === 'AbortError' || !alive()) return;
          serverError = err?.message || 'Không tạo được voucher'; // giữ nguyên dữ liệu đã nhập
        } finally {
          busy = false;
          if (submit.isConnected) sync();
        }
      });
    }

    delegate(root, 'click', '[data-act="new"]', () => openForm());
    delegate(root, 'click', '[data-act="reload"]', () => load());
    delegate(root, 'click', '[data-act="toggle"]', (_e, el) => toggle(el.dataset.id));

    await load();
  },

  destroy() {
    const el = typeof document === 'undefined' ? null : document.getElementById('drawer');
    if (el && el.querySelector('[data-role="vc-drawer"]')) { el.classList.remove('open'); el.innerHTML = ''; }
  },
};
