// Dữ liệu xem thử (?demo=1) cho màn "Đăng bài tự động" (dữ liệu mẫu, không phải số thật).
// routes: khóa 'METHOD /đường-dẫn' (không query) → dữ liệu trả về.
// resolve(method, path, body): cho đường dẫn động hoặc ghi (PATCH/POST) cần phản hồi riêng; trả undefined nếu không khớp.
// Shape theo marketingService.adminOverview / adminBuildBundle / adminRun / adminSetSettings.
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const day = (back) => {
  const d = new Date(Date.now() - back * 24 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), label: d.toLocaleDateString('vi-VN', { weekday: 'short', timeZone: 'Asia/Ho_Chi_Minh' }) };
};

const ITEMS = [
  { product_id: 'b1000000-0000-4000-8000-000000000001', name: 'Bánh mì thịt nguội', emoji: '🥖', store_name: 'Tiệm bánh Mẫu', label: 'red', food_group: 'cooked', discount_percent: 80, price_vnd: 6000, original_price_vnd: 30000, deadline_text: '21:30', hours_left: 1.4, image_url: null },
  { product_id: 'b1000000-0000-4000-8000-000000000002', name: 'Cơm gà xối mỡ', emoji: '🍗', store_name: 'Quán cơm Mẫu', label: 'red', food_group: 'cooked', discount_percent: 80, price_vnd: 9000, original_price_vnd: 45000, deadline_text: '21:45', hours_left: 1.7, image_url: null },
  { product_id: 'b1000000-0000-4000-8000-000000000003', name: 'Sữa chua nếp cẩm', emoji: '🥛', store_name: 'Cửa hàng Mẫu', label: 'yellow', food_group: 'packaged', discount_percent: 50, price_vnd: 8000, original_price_vnd: 16000, deadline_text: '23:00', hours_left: 3.0, image_url: null },
  { product_id: 'b1000000-0000-4000-8000-000000000004', name: 'Salad rau củ', emoji: '🥗', store_name: 'Tiệm bánh Mẫu', label: 'yellow', food_group: 'fresh', discount_percent: 50, price_vnd: 15000, original_price_vnd: 30000, deadline_text: '22:30', hours_left: 2.4, image_url: null },
];

const message = (items) => [
  `🌿 Hôm nay trên MIO có ${ITEMS.length} món nhãn đỏ/vàng đang chờ bạn!`,
  '',
  ...items.map((i) => `${i.label === 'red' ? '🔥' : '⏰'} ${i.name} · ${i.store_name} · giảm ${i.discount_percent}% · chỉ ${i.price_vnd.toLocaleString('vi-VN')}đ · lấy trước ${i.deadline_text}`),
  '',
  'Mua sớm để không lãng phí, nhận hàng trước giờ hết hạn nhé 💚',
  '📍 Tự đến cửa hàng nhận, không giao hàng',
].join('\n');

const bundleOf = (items) => ({
  items,
  more_count: Math.max(0, ITEMS.length - items.length),
  message: message(items),
  link: 'https://example.com',
  hero_image_url: null,
  labels: { red: items.filter((i) => i.label === 'red').length, yellow: items.filter((i) => i.label === 'yellow').length },
});

const mix = (items) => ({ red: items.filter((i) => i.label === 'red').length, yellow: items.filter((i) => i.label === 'yellow').length });

const OVERVIEW = {
  central: { id: '100000000000001', name: 'Fanpage MIO (mẫu)' },
  integrations: { n8n_configured: true, n8n_central_configured: true, ai_enabled: true, direct_fallback: false },
  mode: 'ai',
  auto_enabled: true,
  limits: { per_run: 5, per_day: 12 },
  kpi: {
    today: 3, success_rate: 83, tried_7d: 12, ok_7d: 10, failed_7d: 2,
    ai_7d: 7, template_7d: 2, direct_7d: 1, fallback_7d: 3,
    platforms_7d: { facebook: 10, instagram: 0, tiktok: 0, zalo: 0, buyers: 24 },
  },
  days: [6, 5, 4, 3, 2, 1, 0].map((back, index) => ({ ...day(back), red: [2, 3, 1, 4, 2, 3, 2][index], yellow: [1, 2, 2, 1, 3, 2, 1][index] })),
  top_stores: [{ name: 'Tiệm bánh Mẫu', count: 9 }, { name: 'Quán cơm Mẫu', count: 6 }, { name: 'Cửa hàng Mẫu', count: 3 }],
  queue: ITEMS.map((i, index) => ({ ...i, recently_posted: index === 3 })),
  posts: [
    { id: 'c2000000-0000-4000-8000-000000000001', created_at: ago(25), status: 'sent', tier: 'ai', content: message(ITEMS.slice(0, 3)), error: null, external_url: 'https://example.com/bai-mau-1', items: ITEMS.slice(0, 3), labels: mix(ITEMS.slice(0, 3)) },
    { id: 'c2000000-0000-4000-8000-000000000002', created_at: ago(190), status: 'posted', tier: 'template', content: message(ITEMS.slice(1, 4)), error: null, external_url: null, items: ITEMS.slice(1, 4), labels: mix(ITEMS.slice(1, 4)) },
    { id: 'c2000000-0000-4000-8000-000000000003', created_at: ago(400), status: 'failed', tier: null, content: message(ITEMS.slice(0, 2)), error: 'Hết hạn token Fanpage (dữ liệu mẫu)', external_url: null, items: ITEMS.slice(0, 2), labels: mix(ITEMS.slice(0, 2)) },
    { id: 'c2000000-0000-4000-8000-000000000004', created_at: ago(1500), status: 'queued', tier: null, content: message(ITEMS.slice(2, 4)), error: null, external_url: null, items: ITEMS.slice(2, 4), labels: mix(ITEMS.slice(2, 4)) },
  ],
};

export const routes = {
  'GET /marketing/admin/overview': OVERVIEW,
};

export function resolve(method, path, body) {
  if (method === 'PATCH' && path === '/marketing/admin/settings') {
    return { ai_enabled: body?.ai_enabled ?? OVERVIEW.integrations.ai_enabled, auto_enabled: body?.auto_enabled ?? OVERVIEW.auto_enabled };
  }
  if (method === 'POST' && path === '/marketing/admin/preview') {
    const ids = Array.isArray(body?.product_ids) ? body.product_ids : [];
    const picked = ids.length ? ITEMS.filter((i) => ids.includes(i.product_id)) : ITEMS.slice(0, 3);
    return bundleOf(picked.length ? picked : ITEMS.slice(0, 3));
  }
  if (method === 'POST' && path === '/marketing/admin/run') return { status: 'sent', via: 'n8n', post_log_id: 'c2000000-0000-4000-8000-0000000000ff' };
  return undefined;
}
