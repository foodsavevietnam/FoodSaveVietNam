// Dữ liệu xem thử (?demo=1) cho màn "Tổ chức & tình nguyện viên" (Đợt 2: /admin/charities & /admin/volunteers).
const CH1 = 'f1000001-0000-4000-8000-000000000001';
const CH2 = 'f1000002-0000-4000-8000-000000000002';
const CH3 = 'f1000003-0000-4000-8000-000000000003';

const DEMO_CHARITIES = [
  { id: CH1, owner_id: 'fc000001-0000-4000-8000-000000000001', name: 'Quỹ Bếp Ấm Mẫu', slug: 'quy-bep-am-mau', phone: '0901112223', email: 'bepam@example.test', address: '15 Lý Tự Trọng, Quận 1', district: 'Quận 1', city: 'TP.HCM', beneficiaries_count: 180, rating: 4.9, status: 'active', suspended_at: null, suspended_reason: null, created_at: '2026-09-10T03:00:00.000Z' },
  { id: CH2, owner_id: 'fc000002-0000-4000-8000-000000000002', name: 'Mái Ấm Hy Vọng Mẫu', slug: 'mai-am-hy-vong-mau', phone: '0903334445', email: 'hyvong@example.test', address: '88 Cách Mạng Tháng 8, Quận 3', district: 'Quận 3', city: 'TP.HCM', beneficiaries_count: 65, rating: 5.0, status: 'pending', suspended_at: null, suspended_reason: null, created_at: '2026-11-18T03:00:00.000Z' },
  { id: CH3, owner_id: 'fc000003-0000-4000-8000-000000000003', name: 'Nhóm Thiện Nguyện Tạm Ngưng', slug: 'nhom-tam-ngung', phone: '0905556667', email: 'tamngung@example.test', address: '42 Phan Xích Long, Phú Nhuận', district: 'Phú Nhuận', city: 'TP.HCM', beneficiaries_count: 40, rating: 4.2, status: 'suspended', suspended_at: '2026-11-20T03:00:00.000Z', suspended_reason: 'Chưa hoàn thiện báo cáo phát hàng', created_at: '2026-08-05T03:00:00.000Z' },
];

const DEMO_VOLUNTEERS = [
  { id: 'vl-1', charity_id: CH1, charity_name: 'Quỹ Bếp Ấm Mẫu', full_name: 'Tình nguyện viên Mẫu', phone: '0987654321', email: 'tnv1@example.test', role: 'Tình nguyện viên', duty_role: 'pickup', status: 'active', runs: 7, kg_collected: '42.5', created_at: '2026-10-01T03:00:00.000Z' },
  { id: 'vl-2', charity_id: CH1, charity_name: 'Quỹ Bếp Ấm Mẫu', full_name: 'Tình nguyện viên Mẫu Hai', phone: '0911222333', email: 'tnv2@example.test', role: 'Tình nguyện viên', duty_role: 'both', status: 'inactive', runs: 2, kg_collected: '11.0', created_at: '2026-10-12T03:00:00.000Z' },
];

export const charities = DEMO_CHARITIES;
export const volunteers = DEMO_VOLUNTEERS;
export const routes = {};

function paramsOf(rawPath) {
  const qs = String(rawPath || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

export function resolve(method, path, body, rawPath) {
  if (method === 'GET' && /^\/charity\/profiles\/[^/]+\/volunteers$/.test(path)) return structuredClone(DEMO_VOLUNTEERS);

  if (method === 'GET' && path === '/admin/charities') {
    const sp = paramsOf(rawPath);
    const status = sp.get('status');
    const q = (sp.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
    const filtered = DEMO_CHARITIES.filter((c) => {
      if (status && c.status !== status) return false;
      if (q && ![c.name, c.address, c.phone, c.email].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
      counts: {
        active: DEMO_CHARITIES.filter((c) => c.status === 'active').length,
        pending: DEMO_CHARITIES.filter((c) => c.status === 'pending').length,
        suspended: DEMO_CHARITIES.filter((c) => c.status === 'suspended').length,
        rejected: DEMO_CHARITIES.filter((c) => c.status === 'rejected').length,
        total: DEMO_CHARITIES.length,
      },
    };
  }

  const chDetail = method === 'GET' ? path.match(/^\/admin\/charities\/([^/]+)$/) : null;
  if (chDetail) {
    const c = DEMO_CHARITIES.find((x) => x.id === chDetail[1]);
    if (!c) return undefined;
    return {
      charity: c,
      owner: { id: c.owner_id, full_name: 'Đại diện tổ chức mẫu', email: c.email, phone: '090••••223', status: 'active' },
      volunteers: DEMO_VOLUNTEERS.filter((v) => v.charity_id === c.id),
      recent_donations: [
        { id: 'dn-demo-1', donation_code: 'DN-2026-01', items: '20 ổ bánh mì & rau củ', weight_kg: 12.5, status: 'completed', created_at: '2026-11-22T03:00:00.000Z' },
      ],
      recent_audit: [],
    };
  }

  const chStatus = method === 'POST' ? path.match(/^\/admin\/charities\/([^/]+)\/status$/) : null;
  if (chStatus) {
    const c = DEMO_CHARITIES.find((x) => x.id === chStatus[1]);
    if (c && (body?.status === 'active' || body?.status === 'suspended')) {
      c.status = body.status;
      c.suspended_at = body.status === 'suspended' ? new Date().toISOString() : null;
      c.suspended_reason = body.status === 'suspended' ? (body.reason || null) : null;
      return { id: c.id, status: c.status, suspended_at: c.suspended_at, suspended_reason: c.suspended_reason };
    }
    return { id: chStatus[1], status: body?.status || 'active' };
  }

  if (method === 'GET' && path === '/admin/volunteers') {
    const sp = paramsOf(rawPath);
    const status = sp.get('status');
    const charityId = sp.get('charity_id');
    const q = (sp.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
    const filtered = DEMO_VOLUNTEERS.filter((v) => {
      if (status && v.status !== status) return false;
      if (charityId && v.charity_id !== charityId) return false;
      if (q && ![v.full_name, v.phone, v.email].some((val) => String(val || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const start = (page - 1) * limit;
    return { items: filtered.slice(start, start + limit), total: filtered.length, page, limit };
  }

  const volDetail = method === 'GET' ? path.match(/^\/admin\/volunteers\/([^/]+)$/) : null;
  if (volDetail) {
    const v = DEMO_VOLUNTEERS.find((x) => x.id === volDetail[1]);
    if (!v) return undefined;
    return {
      volunteer: v,
      charity: DEMO_CHARITIES.find((c) => c.id === v.charity_id) || null,
      location_consents: [],
      recent_donations: [],
    };
  }

  const volStatus = method === 'POST' ? path.match(/^\/admin\/volunteers\/([^/]+)\/status$/) : null;
  if (volStatus) {
    const v = DEMO_VOLUNTEERS.find((x) => x.id === volStatus[1]);
    if (v && (body?.status === 'active' || body?.status === 'inactive')) {
      v.status = body.status;
      return { id: v.id, status: v.status };
    }
    return { id: volStatus[1], status: body?.status || 'active' };
  }

  return undefined;
}
