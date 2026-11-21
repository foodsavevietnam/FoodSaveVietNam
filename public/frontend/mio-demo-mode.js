/* MIO UI demo data. No account, API or database is required in this mode. */
(function () {
  "use strict";
  const role = document.body.classList.contains("role-partner") ? "partner" : "charity";
  const credentials = role === "partner"
    ? { email: "demo@partner.mio", password: "mio2026" }
    : { email: "demo@charity.mio", password: "mio2026" };
  const today = new Date().toLocaleDateString("vi-VN");
  window.MIO_DEMO_MODE = true;

  const badge = document.createElement("div");
  badge.className = "mio-demo-badge";
  badge.textContent = "MIO · CHẾ ĐỘ DEMO · DỮ LIỆU MẪU";
  document.body.appendChild(badge);
  const style = document.createElement("style");
  style.textContent = ".mio-demo-badge{position:fixed;right:12px;bottom:12px;z-index:5000;padding:9px 13px;border-radius:999px;background:#064e32;color:#fff;font:800 11px/1.2 Inter,system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 4px 18px #0002}.mio-demo-help{padding:13px 15px;margin:0 0 16px;background:#fff7ed;border:1px solid #fdba74;border-radius:12px;color:#7c2d12;font:600 12px/1.6 Inter,system-ui,sans-serif}.mio-demo-help strong{color:#14532d}.mio-demo-help button{margin-top:8px;padding:7px 11px;border:0;border-radius:8px;background:#15803d;color:#fff;font-weight:800;cursor:pointer}";
  document.head.appendChild(style);

  const charity = {
    id: "mio-charity-demo", owner_id: "mio-demo-owner", name: "Mái ấm Bình An",
    email: credentials.email, address: "25 Nguyễn Hữu Thọ, Quận 7, TP. Hồ Chí Minh",
    metadata: { organization_info: { representative_name: "Nguyễn Thu Hà", representative_position: "Giám đốc", representative_email: credentials.email } }
  };
  const store = {
    id: "mio-store-demo", name: "Tiệm Bánh Mộc Miên", address: "18 Lê Văn Việt, TP. Thủ Đức, TP. Hồ Chí Minh",
    business_type: "bakery", opening_hours: "08:00 - 22:00", finance: { bank_name: "Techcombank", bank_account_number: "190012345678", bank_account_holder: "TIEM BANH MOC MIEN" },
    metadata: {}
  };

  if (role === "charity") {
    window.charityProfile = charity;
    if (typeof charityProfile !== "undefined") charityProfile = charity;
    if (typeof DONATIONS !== "undefined") DONATIONS.push(
      { id: "demo-donation-01", code: "MIO-DN-2401", store: "Tiệm Bánh Mộc Miên", storeAv: "MM", d: "1.2 km", img: "🥖", items: "Bánh mì nguyên cám", amount: "24 phần", quantity: 24, portions: 24, weight: "6.5kg", exp: today, left: 180, urgency: "red", status: "new", note: "Nhận trước 19:00 tại quầy chính", vol: null, distance: "1.2 km", offerExpiresAt: new Date(Date.now() + 40 * 60000).toISOString(), createdAt: new Date().toISOString(), photos: [], team: { pickup: [], distribute: [] } },
      { id: "demo-donation-02", code: "MIO-DN-2394", store: "Bếp Xanh Thủ Đức", storeAv: "BX", d: "2.8 km", img: "🥗", items: "Rau củ theo mùa", amount: "18 kg", quantity: 18, portions: 36, weight: "18kg", exp: today, left: 420, urgency: "yellow", status: "in-route", note: "Đã phân công tình nguyện viên", vol: "Trần Minh Khoa", distance: "2.8 km", pickupStart: "16:00", pickupEnd: "18:00", createdAt: new Date().toISOString(), storeConfirmedAt: "demo", volunteerId: "demo-vol-01", packedAt: "demo", photos: [], team: { pickup: [], distribute: [] } },
      { id: "demo-donation-03", code: "MIO-DN-2378", store: "Siêu thị An Lành", storeAv: "AL", d: "3.4 km", img: "🍚", items: "Gạo và thực phẩm khô", amount: "32 kg", quantity: 32, portions: 64, weight: "32kg", exp: today, left: 0, urgency: "green", status: "completed", note: "Đã bàn giao thành công", vol: "Lê Ngọc Mai", distance: "3.4 km", createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), photos: [], team: { pickup: [], distribute: [] } }
    );
    if (typeof VOLUNTEERS !== "undefined") VOLUNTEERS.push(
      { id: "demo-vol-01", name: "Trần Minh Khoa", phone: "090 123 4567", email: "khoa.demo@mio.local", role: "Tình nguyện viên", status: "active", isNew: false, activeToday: true, dutyRole: "both", vehicle: "Xe máy + thùng giữ nhiệt", zones: ["Quận 7", "TP. Thủ Đức"], schedule: "Linh hoạt", runs: 18, kg: 42.5, rating: 4.9, av: "MK", joined: "12/03/2026" },
      { id: "demo-vol-02", name: "Lê Ngọc Mai", phone: "090 765 4321", email: "mai.demo@mio.local", role: "Tình nguyện viên", status: "active", isNew: false, activeToday: true, dutyRole: "distribute", vehicle: "Xe máy", zones: ["Quận 7"], schedule: "Cuối tuần", runs: 12, kg: 28, rating: 5, av: "NM", joined: "05/04/2026" }
    );
    if (typeof BENEFICIARIES !== "undefined") BENEFICIARIES.push(
      { id: "demo-group-01", group: "Trẻ em", count: 42, meals: "Bữa tối đủ dinh dưỡng", lastFed: "Hôm nay", dietary: "Ưu tiên thực phẩm mềm, ít gia vị" },
      { id: "demo-group-02", group: "Người cao tuổi", count: 18, meals: "Bữa ăn hằng ngày", lastFed: "Hôm qua", dietary: "Món mềm, giảm muối" }
    );
    if (typeof BEN_LOADED !== "undefined") BEN_LOADED = true;
    if (typeof REPORTS !== "undefined") REPORTS.push(
      { month: "10/2026", meals: 1752, kg: "495.3 kg", co2: "191 kg", partners: 12, donors: 3, beneficiaries: 60, status: "published" },
      { month: "09/2026", meals: 1480, kg: "420 kg", co2: "162 kg", partners: 10, donors: 3, beneficiaries: 58, status: "published" }
    );
    if (typeof GALLERY !== "undefined") GALLERY.push(
      { id: "demo-photo-01", title: "Bữa ăn cộng đồng cuối tuần", date: today, org: charity.name, emoji: "🍲", image: "" },
      { id: "demo-photo-02", title: "Phân loại thực phẩm tươi", date: today, org: charity.name, emoji: "🥬", image: "" }
    );
    window.ECO_IMPACT = { charity: { totals: { meals_equivalent: 1752, food_saved_kg: 495.3, co2_avoided_kg: 191, completed_donations: 38 } } };
  } else {
    window.partnerStoreProfile = store;
    if (typeof partnerStoreProfile !== "undefined") partnerStoreProfile = store;
    if (typeof PRD !== "undefined") PRD.push(
      { id: "demo-product-01", n: "Bánh mì bơ tỏi", sku: "MM-BM-024", cat: "Bánh mì", mfg: today, exp: "Hôm nay · 20:00", left: "2 giờ", leftMin: 120, po: 32000, p: 16000, q: 12, l: "red", sync: "ok", blocked: false, donated: false, img: "🥖" },
      { id: "demo-product-02", n: "Bánh croissant bơ", sku: "MM-CR-018", cat: "Bánh ngọt", mfg: today, exp: "Ngày mai · 09:00", left: "15 giờ", leftMin: 900, po: 42000, p: 21000, q: 8, l: "yellow", sync: "ok", blocked: false, donated: false, img: "🥐" },
      { id: "demo-product-03", n: "Bánh chuối yến mạch", sku: "MM-BC-011", cat: "Bánh ngọt", mfg: today, exp: "20/11/2026", left: "3 ngày", leftMin: 4320, po: 28000, p: 22400, q: 6, l: "green", sync: "ok", blocked: false, donated: false, img: "🍞" }
    );
    if (typeof ORD !== "undefined") ORD.push(
      { id: "MIO-2408", uuid: "demo-order-01", st: "new", l: "yellow", items: "Bánh mì bơ tỏi × 2", c: "Nguyễn Minh Anh", ph: "090 111 2233", email: "anh.demo@mio.local", slot: "17:00 - 18:00", pay: "Đã thanh toán", payLabel: "Ví điện tử", time: "16:25", mt: "MoMo", code: "481205", p: 32000, subtotal: 32000, fee: 0, discount: 0, donation: 0, lines: [{ name: "Bánh mì bơ tỏi", emoji: "🥖", price: 16000, qty: 2 }], note: "Gọi trước khi giao", rating: 5 },
      { id: "MIO-2407", uuid: "demo-order-02", st: "ready", l: "red", items: "Bánh croissant bơ × 1", c: "Phạm Gia Hân", ph: "090 222 3344", email: "han.demo@mio.local", slot: "17:30 - 18:30", pay: "Đã thanh toán", payLabel: "Tiền mặt", time: "15:50", mt: "Tiền mặt", code: "731804", p: 21000, subtotal: 21000, fee: 0, discount: 0, donation: 0, lines: [{ name: "Bánh croissant bơ", emoji: "🥐", price: 21000, qty: 1 }], rating: 5 },
      { id: "MIO-2398", uuid: "demo-order-03", st: "done", l: "green", items: "Bánh chuối yến mạch × 2", c: "Đỗ Thanh Tùng", ph: "090 333 4455", time: "Hôm qua", mt: "MoMo", code: "205714", p: 44800, subtotal: 56000, fee: 0, discount: 11200, donation: 0, lines: [{ name: "Bánh chuối yến mạch", emoji: "🍞", price: 22400, qty: 2 }], rating: 5 }
    );
    if (typeof CHS !== "undefined") CHS.push(
      { id: "demo-org-01", n: "Mái ấm Bình An", av: "BA", d: "1.2 km", desc: "Mái ấm đang chăm sóc trẻ em và cần bổ sung thực phẩm mỗi ngày.", rep: "Nguyễn Thu Hà", phone: "090 987 6543", addr: "Quận 7, TP. Hồ Chí Minh", members: 42, need: "Bánh mì, sữa và thực phẩm tươi" },
      { id: "demo-org-02", n: "Bếp ăn sẻ chia", av: "BA", d: "2.8 km", desc: "Bếp ăn cộng đồng phục vụ người lao động và người có hoàn cảnh khó khăn.", rep: "Lê Minh Tâm", phone: "090 876 5432", addr: "TP. Thủ Đức, TP. Hồ Chí Minh", members: 85, need: "Rau củ và thực phẩm khô" }
    );
    if (typeof DONATIONS !== "undefined") DONATIONS.push(
      { id: "demo-partner-donation-01", code: "MIO-DN-2401", status: "new", items: "Bánh mì bơ tỏi", amount: "12 phần", weight: "3.2kg", img: "🥖", charityName: "", isAuto: true, createdAt: new Date().toISOString(), offerExpiresAt: new Date(Date.now() + 40 * 60000).toISOString(), quantity: 12, urgency: "red", pickupStart: "17:00", pickupEnd: "19:00", distance: "1.2 km", note: "Nhận tại quầy chính" },
      { id: "demo-partner-donation-02", code: "MIO-DN-2388", status: "completed", items: "Bánh ngọt hỗn hợp", amount: "8 phần", weight: "2.4kg", img: "🥐", charityName: "Bếp ăn sẻ chia", createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), quantity: 8, storeConfirmedAt: "demo", volunteerId: "demo-vol", packedAt: "demo" }
    );
    if (typeof VIOLATIONS !== "undefined") VIOLATIONS.push({ id: "VP-024", user: "Trần Văn B", type: "đến muộn", desc: "Khách đến nhận muộn 25 phút", count: 1, penalty: "Nhắc nhở", st: "warning" });
    if (typeof LEADERBOARD !== "undefined") LEADERBOARD.push(
      { rank: 1, name: "Tiệm Bánh Mộc Miên", score: 96, saved: "328 kg", donated: "24 lô", rating: 4.9, commission: 12, badge: "🌿" },
      { rank: 2, name: "Bếp Xanh Thủ Đức", score: 91, saved: "286 kg", donated: "18 lô", rating: 4.8, commission: 12, badge: "♻️" },
      { rank: 3, name: "Siêu thị An Lành", score: 88, saved: "241 kg", donated: "16 lô", rating: 4.8, commission: 15, badge: "🤝" }
    );
    if (typeof COMPLAINTS !== "undefined") COMPLAINTS.push({ id: "KN-018", code: "KN-018", uuid: "demo-complaint-01", user: "Nguyễn Minh Anh", order: "MIO-2408", time: "16:40", product: "Bánh mì bơ tỏi", issue: "Khách cần đổi khung giờ nhận hàng.", priority: "medium", st: "open", img: "💬", resolution: "" });
    if (typeof MKT !== "undefined") {
      MKT.settings = { marketing_auto: true, channels: { buyers: { enabled: true, connected: true }, facebook: { enabled: false, connected: false }, zalo: { enabled: false, connected: false } } };
      MKT.posts = [{ id: "demo-post-01", channel: "buyers", status: "published", title: "Bánh ngon cuối ngày", content: "Ưu đãi bánh tươi tại Tiệm Bánh Mộc Miên hôm nay.", created_at: new Date().toISOString() }];
    }
    window.ECO_IMPACT = { partner: { totals: { co2_avoided_kg: 142, food_saved_kg: 328, completed_donations: 24 } } };
  }

  const sessionKey = `foodsave.mio.demo.session.${role}`;
  let demoSession = null;
  try { demoSession = JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch (error) {}
  if (window.FoodSaveAuth) {
    window.FoodSaveAuth.readSession = () => demoSession;
    window.FoodSaveAuth.clearSession = () => { demoSession = null; localStorage.removeItem(sessionKey); window.FoodSaveCurrentAuth = null; };
    window.FoodSaveAuth.loginPortal = async function (requestedRole) {
      const email = (document.getElementById("auth-login-identifier") || {}).value || "";
      const password = (document.getElementById("auth-login-password") || {}).value || "";
      if (requestedRole !== role || email.trim().toLowerCase() !== credentials.email || password !== credentials.password) {
        if (typeof tst === "function") tst("Thông tin demo chưa đúng", `Dùng ${credentials.email} và mật khẩu ${credentials.password}.`, "info");
        return false;
      }
      const profile = { id: role === "partner" ? "mio-demo-owner" : charity.owner_id, full_name: role === "partner" ? "Mộc Miên Demo" : "Nguyễn Thu Hà", email: credentials.email, status: "active", role };
      const context = role === "partner" ? { store } : { charity };
      demoSession = { role, accessToken: "mio-demo-session", profile, context, savedAt: new Date().toISOString(), demo: true };
      try { localStorage.setItem(sessionKey, JSON.stringify(demoSession)); } catch (error) {}
      window.FoodSaveCurrentAuth = demoSession;
      if (role === "partner") { window.partnerStoreProfile = store; if (typeof partnerStoreProfile !== "undefined") partnerStoreProfile = store; }
      else { window.charityProfile = charity; if (typeof charityProfile !== "undefined") charityProfile = charity; }
      if (typeof goView === "function") goView("portal");
      if (typeof R === "function") R();
      if (typeof tst === "function") tst("Đăng nhập demo thành công", "Dữ liệu mẫu chỉ lưu trong phiên trình duyệt này.", "info");
      return true;
    };
  }

  if (role === "partner") {
    window.partnerApiRequest = async () => ({ demo: true });
    window.getCurrentStoreId = async () => store.id;
    window.fetchProductsFromSupabase = async () => PRD;
  }
  if (window.FS && window.FS.sync) {
    const methods = window.FS.sync;
    window.FS.sync = new Proxy(methods, { get(target, key) {
      if (key === "source") return "demo";
      if (key in target && typeof target[key] !== "function") return target[key];
      if (key === "getMarketingSettings") return async () => MKT.settings || { channels: {} };
      if (key === "getMarketingPosts") return async () => ({ items: MKT.posts || [] });
      if (key === "getDonationReport") return async () => ({ donation: {}, store: {}, charity: {}, timeline: [], team: {}, photos: [] });
      if (String(key).startsWith("get")) return async () => [];
      return async () => ({ demo: true, items: [], results: [] });
    } });
  }

  const oldRenderAuth = window.rAuth;
  if (typeof oldRenderAuth === "function") {
    window.rAuth = function () {
      oldRenderAuth();
      if (typeof aS !== "undefined" && aS === "login") setTimeout(() => {
        const panel = document.getElementById("auth-c");
        if (!panel || panel.querySelector(".mio-demo-help")) return;
        panel.insertAdjacentHTML("afterbegin", `<div class="mio-demo-help"><strong>Đăng nhập demo, không cần máy chủ</strong><br>Email: <b>${credentials.email}</b><br>Mật khẩu: <b>${credentials.password}</b><br><button type="button" onclick="document.getElementById('auth-login-identifier').value='${credentials.email}';document.getElementById('auth-login-password').value='${credentials.password}'">Điền tài khoản mẫu</button></div>`);
      }, 0);
    };
  }
  window.logout = function () {
    if (window.FoodSaveAuth) window.FoodSaveAuth.clearSession();
    if (typeof goView === "function") goView("landing");
  };
})();
