// Màn "Hàng đang bán" — khung tạm, worker sẽ thay nội dung.
import { html } from '../core/ui.js';

export default {
  id: 'inventory',
  title: 'Hàng đang bán',
  group: 'HOẠT ĐỘNG',
  async render(container) {
    container.innerHTML = html`<div class="P"><div class="P-h"><div class="P-t">Hàng đang bán</div></div><div class="W" style="padding:14px">Đang dựng màn này.</div></div>`;
  },
};
