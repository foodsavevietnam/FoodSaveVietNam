// Màn "Lô tặng & ghép đơn" — khung tạm, worker sẽ thay nội dung.
import { html } from '../core/ui.js';

export default {
  id: 'donations',
  title: 'Lô tặng & ghép đơn',
  group: 'HOẠT ĐỘNG',
  async render(container) {
    container.innerHTML = html`<div class="P"><div class="P-h"><div class="P-t">Lô tặng & ghép đơn</div></div><div class="W" style="padding:14px">Đang dựng màn này.</div></div>`;
  },
};
