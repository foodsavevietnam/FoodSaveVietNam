// Màn "Tổ chức & tình nguyện viên" — khung tạm, worker sẽ thay nội dung.
import { html } from '../core/ui.js';

export default {
  id: 'charities',
  title: 'Tổ chức & tình nguyện viên',
  group: 'HỒ SƠ',
  async render(container) {
    container.innerHTML = html`<div class="P"><div class="P-h"><div class="P-t">Tổ chức & tình nguyện viên</div></div><div class="W" style="padding:14px">Đang dựng màn này.</div></div>`;
  },
};
