// Màn "Đăng bài tự động" — khung tạm, worker sẽ thay nội dung.
import { html } from '../core/ui.js';

export default {
  id: 'marketing',
  title: 'Đăng bài tự động',
  group: 'TĂNG TRƯỞNG',
  async render(container) {
    container.innerHTML = html`<div class="P"><div class="P-h"><div class="P-t">Đăng bài tự động</div></div><div class="W" style="padding:14px">Đang dựng màn này.</div></div>`;
  },
};
