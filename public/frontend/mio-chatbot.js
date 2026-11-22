/* Trợ lý MIO: chatbot trả lời sẵn các câu hỏi thường gặp, dùng chung cho mọi trang.
 * Câu có trong MIO_FAQ thì trả lời đúng câu đó; câu khác hướng dẫn liên hệ.
 * - Trang có sẵn widget (#aiBody, #aiQuick, #aiForm, như index.html): chỉ gắn dữ liệu và xử lý.
 * - Trang khác: tự chèn nút chat nổi góc phải dưới + khung chat.
 * Gắn vào trang: <script src="/frontend/mio-chatbot.js" defer></script>
 */
(function () {
  "use strict";
  if (window.MioChatbot) return;

  var CONTACT = { phone: "", tel: "", email: "foodsavevietnam@gmail.com" };

  var FAQ = [
    { q: "MIO là gì?", a: "MIO là nền tảng kết nối thực phẩm còn an toàn nhưng cần luân chuyển nhanh với người mua, cửa hàng đối tác và tổ chức từ thiện. Mục tiêu: giảm lãng phí thực phẩm và giúp bạn tiết kiệm chi phí." },
    { q: "MIO có bán thực phẩm hết hạn không?", a: "Không. MIO chỉ đăng thực phẩm còn hạn dùng. Mỗi sản phẩm ghi rõ hạn dùng và mô tả; bạn được kiểm tra hàng khi nhận và có quyền từ chối nếu thấy không đạt." },
    { q: "Làm sao để đặt và nhận hàng?", a: "Chọn món trong Chợ cứu thực phẩm, thanh toán, rồi mở mục Đơn hàng để lấy mã QR. Đến cửa hàng đúng khung giờ nhận, đưa mã QR cho nhân viên quét và kiểm tra hàng trước khi nhận." },
    { q: "Có những phương thức thanh toán nào?", a: "Các phương thức thanh toán đang hỗ trợ được hiển thị ở bước thanh toán trong khu vực người dùng MIO. Xem thêm tại trang Chính sách (chinh-sach.html)." },
    { q: "Tôi có thể hủy đơn không?", a: "Có thể hủy khi cửa hàng chưa bắt đầu chuẩn bị đơn. Điều kiện hủy được hiển thị trong mục Đơn hàng của khu vực người dùng và tại trang Chính sách (chinh-sach.html)." },
    { q: "Khi nào tôi được hoàn tiền?", a: "Bạn được hoàn tiền khi cửa hàng không giao đúng khung giờ, sản phẩm sai mô tả, hoặc có bằng chứng không an toàn. Gửi yêu cầu kèm mã đơn và ảnh chụp; MIO xử lý theo chính sách hoàn tiền tại trang Chính sách (chinh-sach.html)." },
    { q: "MIO đang hoạt động ở đâu?", a: "Khu vực có cửa hàng gần bạn hiển thị trong Chợ cứu thực phẩm sau khi đăng nhập." },
    { q: "Tôi có cần tải ứng dụng không?", a: "Không bắt buộc. Website MIO dùng tốt trên điện thoại. Nếu muốn mở nhanh hơn và nhận thông báo, bạn có thể bấm \"Thêm vào màn hình chính\" để cài như một ứng dụng." },
    { q: "Cửa hàng muốn hợp tác với MIO thì làm thế nào?", a: "Cửa hàng đăng ký tài khoản Đối tác trên website, MIO duyệt hồ sơ và hướng dẫn sử dụng. Mức phí dịch vụ được trao đổi cụ thể khi duyệt hồ sơ." },
    { q: "Tổ chức từ thiện nhận thực phẩm thế nào?", a: "Tổ chức đăng ký tài khoản Tổ chức từ thiện. Sau khi được duyệt, bạn xem các lô thực phẩm quyên tặng, xác nhận nhận theo khung giờ và phân công tình nguyện viên đi nhận. Tổ chức không phải trả tiền." }
  ];

  var FALLBACK = "Xin lỗi, câu hỏi này mình chưa có câu trả lời sẵn. Vui lòng liên hệ " +
    (CONTACT.phone ? "hotline " + CONTACT.phone + " hoặc " : "") +
    "email " + CONTACT.email + " để được nhân viên MIO hỗ trợ trực tiếp nhé.";

  function norm(s) {
    return String(s).toLowerCase().replace(/đ/g, "d").normalize("NFD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function answer(q) {
    var key = norm(q);
    for (var i = 0; i < FAQ.length; i++) if (norm(FAQ[i].q) === key) return FAQ[i].a;
    return FALLBACK;
  }

  var ui = null; // { body, quick, form, input, msgClass }
  var busy = false;

  function push(role, text) {
    if (!ui) return null;
    var div = document.createElement("div");
    div.className = ui.msgClass + " " + role;
    if (role.indexOf("typing") >= 0) div.innerHTML = "<i></i><i></i><i></i>";
    else div.textContent = text;
    ui.body.appendChild(div);
    ui.body.scrollTop = ui.body.scrollHeight;
    return div;
  }

  function ask(q) {
    q = String(q || "").trim();
    if (!q || busy || !ui) return false;
    busy = true;
    push("user", q);
    var typing = push("bot typing", "");
    setTimeout(function () {
      if (typing) typing.remove();
      push("bot", answer(q));
      busy = false;
    }, 650);
    return true;
  }

  function renderQuick() {
    ui.quick.innerHTML = "";
    FAQ.forEach(function (f, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-ai-faq", String(i));
      b.textContent = f.q;
      ui.quick.appendChild(b);
    });
    ui.quick.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ai-faq]");
      if (b) ask(FAQ[+b.getAttribute("data-ai-faq")].q);
    });
    ui.form.addEventListener("submit", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (ask(ui.input.value)) ui.input.value = "";
    });
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function mountFloating() {
    if (!document.querySelector('link[href*="mio-chatbot.css"]')) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/frontend/mio-chatbot.css";
      document.head.appendChild(link);
    }
    var root = document.createElement("div");
    root.className = "mcb";
    root.innerHTML =
      '<div class="mcb-panel" id="mcbPanel" role="dialog" aria-label="Trợ lý MIO" hidden>' +
        '<div class="mcb-head">' +
          '<img class="mcb-logo" src="/icons/mio-logo-square.png" alt="" width="40" height="40">' +
          '<div class="mcb-title"><strong>Trợ lý MIO</strong><span><i class="mcb-dot"></i>Trả lời tự động các câu hỏi thường gặp</span></div>' +
          '<button type="button" class="mcb-close" aria-label="Đóng trợ lý">' + ICON_CLOSE + '</button>' +
        '</div>' +
        '<div class="mcb-body" aria-live="polite">' +
          '<div class="mcb-msg bot">Xin chào! Mình là trợ lý MIO. Bạn chọn một câu hỏi bên dưới để xem câu trả lời nhé.</div>' +
        '</div>' +
        '<div class="mcb-quick-label">Câu hỏi thường gặp</div>' +
        '<div class="mcb-quick"></div>' +
        '<form class="mcb-form">' +
          '<input type="text" placeholder="Nhập câu hỏi..." autocomplete="off" aria-label="Nhập câu hỏi">' +
          '<button type="submit" aria-label="Gửi">' + ICON_SEND + '</button>' +
        '</form>' +
      '</div>' +
      '<button type="button" class="mcb-toggle" aria-controls="mcbPanel" aria-expanded="false" aria-label="Mở trợ lý MIO">' + ICON_CHAT + '</button>';
    document.body.appendChild(root);

    var panel = root.querySelector(".mcb-panel");
    var toggle = root.querySelector(".mcb-toggle");
    ui = {
      body: root.querySelector(".mcb-body"),
      quick: root.querySelector(".mcb-quick"),
      form: root.querySelector(".mcb-form"),
      input: root.querySelector(".mcb-form input"),
      msgClass: "mcb-msg"
    };
    function setOpen(open) {
      panel.hidden = !open;
      root.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Đóng trợ lý MIO" : "Mở trợ lý MIO");
      toggle.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
    }
    toggle.addEventListener("click", function () { setOpen(panel.hidden); });
    root.querySelector(".mcb-close").addEventListener("click", function () { setOpen(false); toggle.focus(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) setOpen(false); });
    renderQuick();
  }

  function mount() {
    var body = document.getElementById("aiBody");
    var quick = document.getElementById("aiQuick");
    var form = document.getElementById("aiForm");
    var input = document.getElementById("aiInput");
    if (body && quick && form && input) {
      ui = { body: body, quick: quick, form: form, input: input, msgClass: "ai-msg" };
      renderQuick();
    } else {
      mountFloating();
    }
  }

  window.MioChatbot = { ask: ask, answer: answer, faq: FAQ, contact: CONTACT };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
