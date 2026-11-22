// Màn "Khiếu nại": gộp Trung tâm khiếu nại + Tranh chấp. 3 cột (Chờ cửa hàng / Chờ Admin / Đã xử lý),
// hồ sơ + quyết định nằm trong ngăn kéo. Poll 60 giây, không timer riêng cho từng thẻ.
import { vnd, stamp, left } from '../core/format.js';
import { VI, badge } from '../core/vi.js';

const REFRESH_MS = 60000;
const DONE_LIMIT = 15;
const COLUMNS = [
  { key: 'open', title: 'Chờ cửa hàng phản hồi', color: 'var(--warn)', match: (c) => c.status === 'open' },
  { key: 'in_review', title: 'Chờ Admin quyết định', color: 'var(--err)', match: (c) => c.status === 'in_review' },
  { key: 'done', title: 'Đã giải quyết', color: 'var(--ok)', match: (c) => c.status === 'resolved' || c.status === 'rejected', limit: DONE_LIMIT },
];
const DECISION_HELP = {
  refund_full: 'Hoàn đủ sẽ trừ vào ví cửa hàng và cửa hàng bị trừ 15 điểm uy tín.',
  refund_partial: 'Hoàn một phần sẽ trừ vào ví cửa hàng và cửa hàng bị trừ 15 điểm uy tín.',
  reject: 'Bác bỏ: không đụng ví cửa hàng.',
};
const SENDER = { customer: 'Khách', partner: 'Cửa hàng' };

const num = (v) => Number(v) || 0;
const code = (c) => `KN-${String(c.id).slice(0, 6).toUpperCase()}`;
const reasonText = (c) => (Object.prototype.hasOwnProperty.call(VI.complaintReason, c.reason_code) ? VI.complaintReason[c.reason_code] : 'Khiếu nại cũ');
const decisionText = (d) => (Object.prototype.hasOwnProperty.call(VI.complaintDecision, d) ? VI.complaintDecision[d] : '—');
const levelClass = (level) => (level === 'err' ? 'e' : level === 'warn' ? 'w' : level);

export default {
  id: 'complaints',
  title: 'Khiếu nại',
  group: 'CẦN QUYẾT ĐỊNH',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error, empty } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="complaints">
      <div data-role="body"></div>
    </div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    let rows = null;
    let tab = 'in_review'; // tab lọc trên màn hẹp
    const byId = (id) => (rows || []).find((c) => c.id === id);

    // ---------- Vẽ danh sách ----------
    // Chỉ nhận ảnh https://; mọi giá trị đi qua tag html nên tự escape.
    const imageLinks = (urls) => (urls || []).map((u) => (typeof u === 'string' && u.startsWith('https://')
      ? html`<a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" alt="Ảnh bằng chứng" loading="lazy" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--bd);margin:2px"></a>`
      : html`<span class="b b-m" style="margin:2px">Ảnh không hợp lệ</span>`)).join('');

    function card(c) {
      let tag;
      if (c.status === 'open') {
        if (c.response_due_at) {
          const l = left(c.response_due_at);
          tag = html`<span class="b b-${raw(levelClass(l.level))}">${l.text}</span>`;
        } else tag = html`<span class="b b-m">Khiếu nại cũ</span>`;
      } else if (c.status === 'in_review') tag = c.priority ? badge('severity', c.priority) : '';
      else tag = badge('complaint', c.status);
      return html`<button type="button" class="cmp-card" data-act="open" data-id="${c.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><strong>${code(c)}</strong>${raw(tag)}</div>
        <div style="font-size:.78rem;margin-top:4px">${c.store_name || '—'} · #${c.order_number || '—'}</div>
        <div style="font-size:.72rem;color:var(--t3);margin-top:2px">${reasonText(c)} · ${String(c.issue ?? '').slice(0, 70)}</div>
        <div style="display:flex;justify-content:space-between;font-size:.72rem;margin-top:6px"><span>${c.customer_name || '—'}</span><span>${vnd(c.order_total)}</span></div>
      </button>`;
    }

    function overview(list) {
      const cnt = { open: 0, in_review: 0, resolved: 0, rejected: 0 };
      list.forEach((c) => { if (c.status in cnt) cnt[c.status] += 1; });
      const high = list.filter((c) => c.priority === 'high' && (c.status === 'open' || c.status === 'in_review')).length;
      const chip = (key, label, value, color) => html`<div class="K" data-chip="${key}"><div class="K-l">${label}</div><div class="K-v" style="color:${raw(color)}">${value}</div></div>`;
      const byStore = {};
      list.forEach((c) => { const k = c.store_name || '—'; byStore[k] = (byStore[k] || 0) + 1; });
      const top = Object.keys(byStore).sort((a, b) => byStore[b] - byStore[a]).slice(0, 3);
      const topHtml = top.length
        ? top.map((k, i) => html`<div class="DR"><div class="DR-v">${i + 1}. ${k}</div><div class="DR-l" style="width:auto;text-align:right">${byStore[k]} khiếu nại</div></div>`).join('')
        : html`<div style="padding:12px 16px;color:var(--t3)">Chưa có dữ liệu.</div>`;
      return html`<div data-role="chips" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
        ${raw(chip('all', 'Tổng hồ sơ', list.length, 'var(--text)'))}
        ${raw(chip('open', 'Chờ cửa hàng', cnt.open, 'var(--warn)'))}
        ${raw(chip('in_review', 'Chờ Admin quyết định', cnt.in_review, 'var(--err)'))}
        ${raw(chip('high', 'Ưu tiên cao chưa xử lý', high, 'var(--err)'))}
        ${raw(chip('done', 'Đã xử lý', cnt.resolved + cnt.rejected, 'var(--ok)'))}
      </div>
      <section class="P" aria-label="Cửa hàng bị khiếu nại nhiều nhất"><div class="P-h"><span class="P-t">3 cửa hàng bị khiếu nại nhiều nhất</span></div>
        <div data-role="top-stores">${raw(topHtml)}</div></section>`;
    }

    function drawBoard() {
      const list = rows || [];
      const cols = COLUMNS.map((col) => {
        let items = list.filter(col.match);
        if (col.limit) items = items.slice(0, col.limit);
        return html`<div class="cmp-col${raw(tab === col.key ? ' on' : '')}" data-col="${col.key}">
          <div style="display:flex;justify-content:space-between;padding:6px 4px;border-bottom:3px solid ${raw(col.color)};font-size:.78rem;font-weight:700"><span>${col.title}</span><span>${items.length}</span></div>
          ${raw(items.map(card).join('') || html`<div style="color:var(--t3);font-size:.75rem;padding:10px">Không có khiếu nại.</div>`)}</div>`;
      }).join('');
      const tabs = COLUMNS.map((col) => html`<button type="button" class="bt${raw(tab === col.key ? ' bt-p' : '')}" data-act="tab" data-tab="${col.key}">${col.title}</button>`).join('');
      body.innerHTML = html`${raw(overview(list))}
        <p class="v2note">Quy trình: người mua gửi (có ảnh), cửa hàng có 12 giờ để đồng ý hoàn tiền hoặc không đồng ý. Không đồng ý hoặc quá hạn thì Admin quyết định hoàn đủ, một phần hoặc bác bỏ.</p>
        <div class="cmp-tabs" role="tablist">${raw(tabs)}</div>
        <div class="cmp-board">${raw(cols)}</div>`;
    }

    let seq = 0;
    async function draw({ quiet = false, notify = false } = {}) {
      const mine = ++seq;
      if (!quiet || !rows) loading(body);
      try {
        const data = await api.get('/admin/complaints', { signal });
        if (!alive() || mine !== seq) return;
        rows = Array.isArray(data) ? data : data?.items || [];
        if (!rows.length) { empty(body, 'Chưa có khiếu nại nào.'); return; }
        drawBoard();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (notify) ctx.ui.toast('Đã lưu quyết định nhưng chưa tải lại được danh sách.', 'err');
        if (quiet && rows) { console.warn('[MIO] Không làm mới được khiếu nại:', err); return; }
        error(body, err, () => draw());
      }
    }

    // ---------- Ngăn kéo hồ sơ ----------
    async function loadChat(box, c) {
      try {
        const data = await api.get(`/orders/${encodeURIComponent(c.order_id)}/messages`, { signal });
        if (!alive() || !box.isConnected) return;
        const msgs = Array.isArray(data?.messages) ? data.messages : [];
        box.innerHTML = msgs.length
          ? msgs.map((m) => html`<div style="margin:3px 0"><strong>${SENDER[m.sender_role] || 'Hệ thống'}</strong> <small style="color:var(--t3)">${stamp(m.created_at)}</small><br>${m.body}</div>`).join('')
          : html`Không có tin nhắn.`;
      } catch (err) {
        if (!alive() || !box.isConnected || err?.name === 'AbortError') return;
        box.innerHTML = html`${err?.code === 'CHAT_FORBIDDEN' ? 'Chỉ xem được chat khi đơn có khiếu nại' : err?.message || 'Không tải được chat.'}`;
      }
    }

    function decisionForm(c) {
      const total = num(c.order_total);
      const radios = Object.keys(VI.complaintDecision).map((k) => html`<label style="display:block;margin:4px 0"><input type="radio" name="decision" value="${k}"${raw(k === 'refund_full' ? ' checked' : '')}> ${VI.complaintDecision[k]}${raw(k === 'refund_full' ? html` (${vnd(total)})` : '')}</label>`).join('');
      return html`<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)"><strong>Quyết định của Admin</strong>
        <div style="margin:8px 0">${raw(radios)}</div>
        <div data-role="partial-box" hidden style="margin-bottom:8px">Số tiền hoàn (đ), từ 1 đến ${vnd(Math.max(total - 1, 0))}:
          <input name="refund" inputmode="numeric" autocomplete="off" style="padding:6px;width:140px"> <span data-role="refund-preview" style="color:var(--t3)"></span></div>
        <label data-role="false-claim" hidden style="display:block;margin-bottom:8px"><input type="checkbox" name="is_false_claim"> Đánh dấu khiếu nại sai sự thật (người mua bị trừ 10 điểm)</label>
        <textarea name="note" rows="3" maxlength="1000" style="width:100%;padding:8px" placeholder="Ghi chú quyết định (bắt buộc, gửi cho người mua)"></textarea>
        <button type="button" class="bt bt-p" data-act="submit" style="margin-top:8px" disabled>Gửi quyết định</button>
        <div data-role="help" style="font-size:.7rem;color:var(--t3);margin-top:6px"></div></div>`;
    }

    function openDrawer(c) {
      const imgs = c.image_urls?.length
        ? html`<p><strong>Ảnh người mua gửi (${c.image_urls.length}):</strong><br>${raw(imageLinks(c.image_urls))}</p>`
        : html`<p style="color:var(--t3)">Không có ảnh (khiếu nại cũ).</p>`;
      let store = '';
      if (c.store_responded_at) {
        store = html`<div class="v2note"><strong>Cửa hàng ${c.store_response_action === 'accept' ? 'đồng ý hoàn tiền' : 'không đồng ý'}</strong>${c.store_response ? `: ${c.store_response}` : ''}${raw(c.store_response_images?.length ? html`<br>${raw(imageLinks(c.store_response_images))}` : '')}</div>`;
      } else if (c.status === 'open') {
        store = html`<div class="v2note">Cửa hàng ${c.response_due_at ? `${left(c.response_due_at).text} ` : ''}để phản hồi. Khi hết hạn khiếu nại tự chuyển cho Admin.</div>`;
      }
      let tail = '';
      if (!c.reason_code) tail = html`<p class="v2note" style="margin-top:12px">Khiếu nại cũ chưa xử lý được ở cổng mới. <a href="/quan-tri">Mở trang cũ → mục Tranh chấp</a></p>`;
      else if (c.status === 'in_review') tail = decisionForm(c);
      else if (c.status === 'resolved' || c.status === 'rejected') {
        tail = html`<div class="v2note" style="margin-top:12px"><strong>Kết quả:</strong> ${decisionText(c.decision)}${num(c.refund_cents) > 0 ? ` · đã hoàn ${vnd(c.refund_cents)}` : ''}${c.is_false_claim ? ' · đã đánh dấu khiếu nại sai' : ''}<br>${c.admin_note || c.resolution || ''}</div>`;
      }
      ctx.ui.drawer.open(html`<div data-role="cmp-drawer" style="padding:14px 18px">
        <p><strong>${code(c)}</strong> · đơn <strong>#${c.order_number || '—'}</strong> · giá trị ${vnd(c.order_total)}<br>
          Người mua: ${c.customer_name || '—'} · Cửa hàng: ${c.store_name || '—'}<br>${raw(badge('complaint', c.status))}${raw(c.priority ? html` · Ưu tiên ${raw(badge('severity', c.priority))}` : '')}</p>
        <p>Lý do: ${reasonText(c)}<br><span style="white-space:pre-wrap">${c.issue ?? ''}</span></p>
        ${raw(imgs)}${raw(store)}
        <p><strong>Lịch sử chat của đơn (bằng chứng, chỉ đọc):</strong></p>
        <div data-role="chat" style="max-height:200px;overflow:auto;background:var(--bg2);border-radius:10px;padding:8px;font-size:.75rem">Đang tải chat…</div>
        ${raw(tail)}</div>`, { title: `Hồ sơ khiếu nại ${code(c)}` });

      const panel = document.querySelector('#drawer [data-role="cmp-drawer"]');
      if (!panel) return;
      if (c.order_id) loadChat(panel.querySelector('[data-role="chat"]'), c);
      if (panel.querySelector('[name="note"]')) wireForm(panel, c);
    }

    function wireForm(panel, c) {
      const total = num(c.order_total);
      const q = (sel) => panel.querySelector(sel);
      const submit = q('[data-act="submit"]');
      const decision = () => panel.querySelector('input[name="decision"]:checked').value;
      // Chỉ nhận số nguyên VND: 5000 hoặc 5.000 (dấu chấm ngăn nghìn). Chuỗi khác → NaN.
      const amount = () => {
        const text = q('[name="refund"]').value.trim();
        if (/^\d+$/.test(text)) return Number(text);
        if (/^\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ''));
        return text === '' ? 0 : NaN;
      };
      let busy = false;

      function sync() {
        const d = decision();
        q('[data-role="partial-box"]').hidden = d !== 'refund_partial';
        q('[data-role="false-claim"]').hidden = d !== 'reject';
        q('[data-role="help"]').textContent = DECISION_HELP[d];
        const amt = amount();
        q('[data-role="refund-preview"]').textContent = d !== 'refund_partial' ? '' : Number.isNaN(amt) ? 'Chỉ nhập số nguyên (VND)' : amt > 0 ? `= ${vnd(amt)}` : '';
        let valid = q('[name="note"]').value.trim().length >= 3;
        if (d === 'refund_partial') valid = valid && amt >= 1 && amt <= total - 1;
        submit.disabled = busy || !valid;
      }
      panel.addEventListener('input', sync);
      panel.addEventListener('change', sync);
      sync();

      submit.addEventListener('click', async () => {
        sync();
        if (submit.disabled) return;
        const d = decision();
        const payload = { decision: d, note: q('[name="note"]').value.trim() };
        if (d === 'refund_partial') payload.refund_cents = amount();
        if (d === 'reject' && q('[name="is_false_claim"]').checked) payload.is_false_claim = true;
        const label = decisionText(d) + (payload.refund_cents ? ` ${vnd(payload.refund_cents)}` : '') + (payload.is_false_claim ? ' và đánh dấu khiếu nại sai' : '');
        const consequence = d === 'reject' ? 'Khiếu nại bị bác bỏ, ví cửa hàng không đổi.' : 'Tiền hoàn sẽ bị trừ vào ví cửa hàng và cửa hàng bị trừ điểm uy tín.';
        const res = await ctx.ui.confirm({ title: `Chốt quyết định: ${label}?`, body: `${consequence} Không thể đổi sau khi chốt.`, danger: d !== 'reject', confirmText: 'Chốt quyết định' });
        if (!res.ok || !alive()) return;
        busy = true;
        sync();
        try {
          await api.post(`/admin/complaints/${encodeURIComponent(c.id)}/decision`, payload, { signal });
          if (!alive()) return;
          ctx.ui.toast('Đã chốt quyết định');
          ctx.ui.drawer.close();
          draw({ quiet: true, notify: true });
          ctx.refreshWork();
        } catch (err) {
          if (err?.name === 'AbortError') return;
          ctx.ui.toast(err?.message || 'Không chốt được quyết định', 'err');
        } finally {
          busy = false;
          if (submit.isConnected) sync();
        }
      });
    }

    delegate(root, 'click', '[data-act="open"]', (_e, el) => { const c = byId(el.dataset.id); if (c) openDrawer(c); });
    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { tab = el.dataset.tab; if (rows?.length) drawBoard(); });

    ctx.poll.add('screen:complaints', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() {},
};
