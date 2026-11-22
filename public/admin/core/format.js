// Định dạng hiển thị. Giờ luôn theo Asia/Ho_Chi_Minh để không phụ thuộc múi giờ máy.
const TZ = 'Asia/Ho_Chi_Minh';
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const o = {};
  for (const p of fmt.formatToParts(d)) o[p.type] = p.value;
  return o;
}

export function vnd(n) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${v < 0 ? '-' : ''}${s}đ`;
}

export function dt(iso) {
  const p = parts(iso);
  return p ? `${p.hour}:${p.minute} ${p.day}/${p.month}` : '—';
}

export function stamp(iso) {
  const p = parts(iso);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : '—';
}

export function maskPhone(phone) {
  const s = String(phone ?? '').replace(/\s+/g, '');
  return s.length < 7 ? s : `${s.slice(0, 3)}***${s.slice(-3)}`;
}

// Ngưỡng: ≤ 15 phút lỗi, ≤ 30 phút cảnh báo.
export function left(deadlineIso, now = Date.now()) {
  const t = deadlineIso ? new Date(deadlineIso).getTime() : NaN;
  if (!Number.isFinite(t)) return { text: '—', level: 'm' };
  const m = Math.round((t - now) / 60000);
  if (m <= 0) return { text: 'Đã hết hạn', level: 'err' };
  const text = m >= 60 ? `còn ${Math.floor(m / 60)}h ${m % 60}p` : `còn ${m} phút`;
  return { text, level: m <= 15 ? 'err' : m <= 30 ? 'warn' : 'ok' };
}

// Tháng hiện tại theo giờ Việt Nam, dạng YYYY-MM (tham số `month` của /admin/esg).
export function monthVn(now = Date.now()) {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date(now))) o[p.type] = p.value;
  return `${o.year}-${o.month}`;
}
