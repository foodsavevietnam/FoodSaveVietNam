// Màn "Người mua" — khung tạm, worker sẽ thay nội dung.
import { html } from '../core/ui.js';

export default {
  id: 'customers',
  title: 'Người mua',
  group: 'HỒ SƠ',
  async render(container) {
    container.innerHTML = html`<div class="P"><div class="P-h"><div class="P-t">Người mua</div></div><div class="W" style="padding:14px">Đang dựng màn này.</div></div>`;
  },
};
