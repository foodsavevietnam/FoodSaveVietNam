// Màn "Đơn hàng" — khung tạm, worker sẽ thay nội dung.
import { html } from '../core/ui.js';

export default {
  id: 'orders',
  title: 'Đơn hàng',
  group: 'HOẠT ĐỘNG',
  async render(container) {
    container.innerHTML = html`<div class="P"><div class="P-h"><div class="P-t">Đơn hàng</div></div><div class="W" style="padding:14px">Đang dựng màn này.</div></div>`;
  },
};
