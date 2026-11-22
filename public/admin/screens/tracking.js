// Màn "Bản đồ theo dõi" — khung tạm, worker sẽ thay nội dung.
import { html } from '../core/ui.js';

export default {
  id: 'tracking',
  title: 'Bản đồ theo dõi',
  group: 'HOẠT ĐỘNG',
  async render(container) {
    container.innerHTML = html`<div class="P"><div class="P-h"><div class="P-t">Bản đồ theo dõi</div></div><div class="W" style="padding:14px">Đang dựng màn này.</div></div>`;
  },
};
