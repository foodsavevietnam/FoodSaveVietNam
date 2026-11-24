// Màn chờ cho mục chưa chuyển sang cổng mới: chỉ dẫn về mục tương ứng ở trang quản trị cũ, không có dữ liệu mẫu.
import { html } from '../core/ui.js';

// Tên mục ở trang cũ (/quan-tri) cho từng màn chưa di trú; màn không có trong bảng dùng tiêu đề màn.
const OLD_SECTIONS = {
  customers: 'Người dùng', stores: 'Cửa hàng', charities: 'Tổ chức từ thiện', orders: 'Đơn hàng',
  donations: 'Lô tặng từ thiện', tracking: 'Bản đồ theo dõi', inventory: 'Lô hàng tồn kho',
  ledger: 'Tài chính · Sổ cái', marketing: 'AI Agent đăng bài', settings: 'Cấu hình',
};

export default {
  id: '_pending',
  title: 'Chưa nối API',
  render(container, ctx = {}) {
    const screen = ctx.screen || {};
    const section = Object.prototype.hasOwnProperty.call(OLD_SECTIONS, screen.id) ? OLD_SECTIONS[screen.id] : screen.title;
    container.innerHTML = html`<div class="P">
      <div class="P-h"><span class="P-t">Chưa nối API</span></div>
      <div style="padding:16px">
        <p class="v2note" style="margin:0">Màn này chưa có trên cổng mới. <a href="/quan-tri">${section ? `Mở trang cũ → mục ${section}` : 'Mở trang cũ'}</a></p>
      </div>
    </div>`;
  },
};
