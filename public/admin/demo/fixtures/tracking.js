// Dữ liệu xem thử (?demo=1) cho màn "Bản đồ theo dõi" (shape của GET /admin/live-locations).
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();

export const routes = {
  'GET /admin/live-locations': [
    { actor_kind: 'volunteer', actor_id: 'v-demo-0001', name: 'Tình nguyện viên mẫu A', context_kind: 'donation', context_id: 'd-demo-0001', context_code: 'DN-MAU-01', lat: 10.7769, lng: 106.7009, accuracy_m: 15, updated_at: ago(1), destination: { lat: 10.78, lng: 106.69, label: 'Cửa hàng mẫu' }, directions_url: 'https://www.google.com/maps/dir/?api=1&destination=10.78,106.69' },
    { actor_kind: 'customer', actor_id: 'c-demo-0001', name: 'Người mua mẫu B', context_kind: 'order', context_id: 'o-demo-0001', context_code: 'MIO-MAU-02', lat: 10.78, lng: 106.71, accuracy_m: 20, updated_at: ago(8), destination: { lat: 10.775, lng: 106.695, label: 'Cửa hàng mẫu' }, directions_url: null },
  ],
};

export function resolve() {
  return undefined;
}
