// Dữ liệu xem thử (?demo=1) cho màn "Tổ chức & tình nguyện viên".
// routes: khóa 'METHOD /đường-dẫn' (không query) → dữ liệu trả về.
// resolve(method, path, body): cho đường dẫn động (ví dụ /orders/:id); trả undefined nếu không khớp.
// Tổ chức chờ duyệt lấy từ GET /admin/verification (fixture verify.js, đã có sẵn).
// Các đường dẫn GET /admin/verification, /donations, /admin/live-locations thuộc fixture khác (chung, donations, tracking).
export const routes = {};

const VOLUNTEERS = [
  { id: 'vl-1', full_name: 'Tình nguyện viên Mẫu', phone: '0987654321', role: 'Tinh nguyen vien', duty_role: 'pickup', status: 'active', runs: 7, kg_collected: '42.5' },
  { id: 'vl-2', full_name: 'Tình nguyện viên Mẫu Hai', phone: '0911222333', role: 'Tinh nguyen vien', duty_role: 'both', status: 'inactive', runs: 0, kg_collected: '0' },
];

export function resolve(method, path) {
  if (method === 'GET' && /^\/charity\/profiles\/[^/]+\/volunteers$/.test(path)) return structuredClone(VOLUNTEERS);
  return undefined;
}
