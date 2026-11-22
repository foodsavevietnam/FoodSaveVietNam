// Màn "Cài đặt" — khung tạm, worker sẽ thay nội dung.
import { html } from '../core/ui.js';

export default {
  id: 'settings',
  title: 'Cài đặt',
  group: 'HỆ THỐNG',
  async render(container) {
    container.innerHTML = html`<div class="P"><div class="P-h"><div class="P-t">Cài đặt</div></div><div class="W" style="padding:14px">Đang dựng màn này.</div></div>`;
  },
};
