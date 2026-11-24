// Dữ liệu xem thử (?demo=1) cho màn "Lô tặng & ghép đơn" (hỗ trợ /admin/donations* Đợt 3 và đường dẫn cũ /donations*).
// Tuyệt đối không có pickup_code.
const AT = (hm, day = '23') => `2026-11-${day}T${hm}:00.000Z`;
const A = 'b0000001-0000-4000-8000-000000000001';
const B = 'b0000002-0000-4000-8000-000000000002';
const C = 'b0000003-0000-4000-8000-000000000003';
const D = 'b0000004-0000-4000-8000-000000000004';
const E = 'b0000005-0000-4000-8000-000000000005';
const HOA = { id: 'st-1', name: 'Tiệm bánh Hoa Sữa (mẫu)', address: '12 Lê Lợi, Quận 1' };
const XANH = { id: 'st-2', name: 'Siêu thị Xanh (mẫu)', address: '45 Nguyễn Huệ, Quận 1' };
const MAI = { id: 'ch-1', name: 'Mái ấm Hy Vọng (mẫu)' };
const TNV1 = { id: 'v-1', full_name: 'Phạm Tình Nguyện (mẫu)', phone: '0988123456' };

const base = { weight_kg: 5, note: null, offer_expires_at: null, volunteers: null, donation_assignments: [] };
const LOTS = [
  {
    ...base, id: A, donation_code: 'DN-3001', status: 'in_route', urgency: 'red', items: 'Bánh mì ngọt các loại',
    amount_text: '30 phần', quantity: 30, weight_kg: 6.5, expires_at: AT('16:00'), pickup_start: '14:00', pickup_end: '16:00',
    note: 'Lấy ở cửa sau', created_at: AT('03:00'), stores: HOA, charity_profiles: MAI, volunteers: TNV1,
    donation_assignments: [
      { volunteer_id: 'v-1', stage: 'pickup', share: 30, done_at: AT('07:00'), volunteers: { ...TNV1, vehicle: 'Xe máy' } },
      { volunteer_id: 'v-2', stage: 'distribute', share: 30, done_at: null, volunteers: { id: 'v-2', full_name: 'Hồ Phát Hàng (mẫu)', phone: '0977000111', vehicle: 'Xe đạp' } },
    ],
  },
  { ...base, id: B, donation_code: 'DN-3002', status: 'open', urgency: 'green', items: 'Cơm hộp', amount_text: '12 hộp', quantity: null, weight_kg: 4, expires_at: AT('18:00'), pickup_start: '15:00', pickup_end: '17:00', created_at: AT('06:00'), stores: XANH, charity_profiles: null },
  { ...base, id: C, donation_code: 'DN-3003', status: 'accepted', urgency: 'yellow', items: 'Rau củ quả', amount_text: '8 kg', quantity: 8, weight_kg: 8, expires_at: AT('20:00'), pickup_start: '16:00', pickup_end: '18:00', created_at: AT('05:00'), stores: XANH, charity_profiles: MAI },
  { ...base, id: D, donation_code: 'DN-3004', status: 'completed', urgency: 'green', items: 'Bánh su kem', amount_text: '20 phần', quantity: 20, weight_kg: 3, expires_at: AT('10:00', '22'), pickup_start: '08:00', pickup_end: '09:30', created_at: AT('01:00', '22'), stores: HOA, charity_profiles: MAI, volunteers: TNV1 },
  { ...base, id: E, donation_code: 'DN-3005', status: 'rejected', urgency: 'yellow', items: 'Sữa chua', amount_text: '15 hộp', quantity: 15, weight_kg: 2, expires_at: AT('12:00', '21'), pickup_start: '09:00', pickup_end: '10:00', created_at: AT('00:30', '21'), stores: XANH, charity_profiles: MAI },
];

const PHOTOS = [
  { id: 'ph-1', volunteer_id: 'v-1', stage: 'pickup', photo_url: 'https://example.com/anh-mau-nhan-hang.jpg', status: 'approved', taken_at: AT('07:00'), gps_flag: false, gps_distance_m: 12, is_demo: true, review_note: null, volunteers: { full_name: TNV1.full_name } },
  { id: 'ph-2', volunteer_id: 'v-2', stage: 'distribute', photo_url: 'https://example.com/anh-mau-phat-hang.jpg', status: 'pending', taken_at: AT('09:00'), gps_flag: true, gps_distance_m: 850, is_demo: true, review_note: null, volunteers: { full_name: 'Hồ Phát Hàng (mẫu)' } },
];

function reportFor(lot) {
  const timeline = [{ at: lot.created_at, label: 'Cửa hàng đăng lô tặng' }];
  if (lot.charity_profiles) timeline.push({ at: AT('04:00', lot.created_at.slice(8, 10)), label: `${lot.charity_profiles.name} chọn lô` });
  const isA = lot.id === A;
  return {
    donation: { id: lot.id, code: lot.donation_code, status: lot.status, items: lot.items, amount_text: lot.amount_text, quantity: lot.quantity, weight_kg: lot.weight_kg, portions: lot.quantity, completed_at: null, distribution_done_at: null },
    store: { name: lot.stores.name },
    charity: { name: lot.charity_profiles?.name ?? '' },
    team: {
      pickup: isA ? [{ volunteer_id: 'v-1', name: TNV1.full_name, phone: TNV1.phone, vehicle: 'Xe máy', share: 30, done_at: AT('07:00'), photo_count: 1 }] : [],
      distribute: isA ? [{ volunteer_id: 'v-2', name: 'Hồ Phát Hàng (mẫu)', phone: '0977000111', vehicle: 'Xe đạp', share: 30, done_at: null, photo_count: 1 }] : [],
    },
    photos: isA ? PHOTOS : [],
    timeline,
  };
}

const NEEDS = [
  { id: 'c0000001-0000-4000-8000-000000000001', charity_id: 'ch-1000-0000-4000-8000-000000000001', title: 'Bữa tối cho 50 người (mẫu)', category_codes: ['meal', 'bakery'], quantity: 50, needed_by: AT('11:00'), status: 'open', note: null, matched_donation_ids: [], created_at: AT('02:00') },
  { id: 'c0000002-0000-4000-8000-000000000002', charity_id: 'ch-1000-0000-4000-8000-000000000001', title: 'Bánh sáng mai (mẫu)', category_codes: ['bakery'], quantity: 30, needed_by: AT('00:30'), status: 'matched', note: null, matched_donation_ids: [A, D], created_at: AT('20:00', '22') },
  { id: 'c0000003-0000-4000-8000-000000000003', charity_id: 'ch-2000-0000-4000-8000-000000000002', title: 'Đồ ăn nhẹ (mẫu)', category_codes: ['meal'], quantity: 10, needed_by: AT('09:00', '22'), status: 'cancelled', note: null, matched_donation_ids: [], created_at: AT('01:00', '22') },
];

export const routes = {
  'GET /donations': { items: LOTS, pagination: { page: 1, limit: 20, total: LOTS.length, has_next_page: false } },
  'GET /matching/needs': NEEDS,
};

function paramsOf(rawPath) {
  const qs = String(rawPath || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

export function resolve(method, path, body, rawPath) {
  if (method === 'GET' && path === '/admin/donations') {
    const sp = paramsOf(rawPath);
    const status = sp.get('status');
    const q = (sp.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
    const filtered = LOTS.filter((l) => {
      if (status && l.status !== status) return false;
      if (q && ![l.donation_code, l.items, l.stores?.name, l.charity_profiles?.name].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const start = (page - 1) * limit;
    const slice = filtered.slice(start, start + limit);
    return {
      items: slice,
      total: filtered.length,
      page,
      limit,
      pagination: { page, limit, total: filtered.length, has_next_page: start + limit < filtered.length },
    };
  }

  const adminDetail = method === 'GET' ? /^\/admin\/donations\/([^/]+)$/.exec(path) : null;
  if (adminDetail) {
    const lot = LOTS.find((l) => l.id === adminDetail[1]);
    if (!lot) return undefined;
    const rep = reportFor(lot);
    return {
      ...lot,
      photos: lot.id === A ? PHOTOS : [],
      report: rep,
      timeline: rep.timeline,
    };
  }

  const adminCancel = method === 'POST' ? /^\/admin\/donations\/([^/]+)\/cancel$/.exec(path) : null;
  if (adminCancel) {
    const lot = LOTS.find((l) => l.id === adminCancel[1]);
    if (!lot) return undefined;
    lot.status = 'cancelled';
    lot.cancel_reason = body?.reason || '';
    return { id: lot.id, status: 'cancelled' };
  }

  if (method === 'GET') {
    const m = /^\/donations\/([^/]+)\/(photos|report)$/.exec(path);
    if (!m) return undefined;
    const lot = LOTS.find((l) => l.id === m[1]);
    if (!lot) return undefined;
    if (m[2] === 'photos') return { items: lot.id === A ? PHOTOS : [] };
    return reportFor(lot);
  }
  return undefined;
}
