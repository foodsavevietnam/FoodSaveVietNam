(function () {
  "use strict";

  const LOCAL_API_BASE_URL = "http://localhost:8080/api/v1";
  const API_PATH = "/api/v1";
  // Mỗi trang lưu phiên đăng nhập riêng (tránh trang này dùng nhầm tài khoản của trang khác)
  const PAGE_ROLE = (function () {
    const file = window.location.pathname.toLowerCase();
    if (file.includes("foodsave_partner")) return "partner";
    if (file.includes("foodsave_charity")) return "charity";
    return "customer";
  })();
  const LEGACY_AUTH_STORAGE_KEY = "foodsave.auth.session";
  const AUTH_STORAGE_KEY = `${LEGACY_AUTH_STORAGE_KEY}.${PAGE_ROLE}`;
  const NEARBY_LOCATION_STORAGE_KEY = "foodsave.nearby.location";
  const NEARBY_NOTIFICATION_STORAGE_KEY = "foodsave.nearby.notified";
  const DEFAULT_NEARBY_RADIUS_KM = 5;

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function explicitApiBase() {
    const script = document.currentScript;
    const scriptBase = script && script.getAttribute ? script.getAttribute("data-api-base") : "";
    const meta = document.querySelector('meta[name="foodsave-api-base"]');
    const metaBase = meta && meta.getAttribute ? meta.getAttribute("content") : "";
    return window.FOODSAVE_API_BASE || scriptBase || metaBase || "";
  }

  function resolveApiBaseUrl() {
    const location = window.location;
    const isHttp = location.protocol === "http:" || location.protocol === "https:";
    const isLocalHost = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "::1";
    // Chạy thử ở máy (Live Server): luôn gọi backend ở máy, bỏ qua địa chỉ Netlify ghi sẵn trong HTML
    if (!isHttp || (isLocalHost && location.port !== "8080")) return LOCAL_API_BASE_URL;

    const explicit = trimTrailingSlash(explicitApiBase());
    if (explicit) return explicit;

    if (isHttp && !isLocalHost) {
      return `${location.origin}${API_PATH}`;
    }

    if (isHttp && isLocalHost && location.port === "8080") {
      return `${location.origin}${API_PATH}`;
    }

    return LOCAL_API_BASE_URL;
  }

  const API_BASE_URL = resolveApiBaseUrl();

  function normalizeDistanceKm(value) {
    const distance = Number(value);
    if (!Number.isFinite(distance) || distance < 0) return 0;
    return Math.round(distance * 100) / 100;
  }

  function distanceLabel(value) {
    const distance = normalizeDistanceKm(value);
    if (!distance) return "";
    if (distance < 1) return `${Math.round(distance * 1000)}m`;
    return `${distance}km`;
  }

  function normalizeRadiusKm(value) {
    const radius = Number(value);
    if (!Number.isFinite(radius) || radius <= 0) return DEFAULT_NEARBY_RADIUS_KM;
    return Math.min(radius, 50);
  }

  function readNearbyLocation() {
    try {
      const raw = localStorage.getItem(NEARBY_LOCATION_STORAGE_KEY);
      const value = raw ? JSON.parse(raw) : null;
      // Chưa bật vị trí thì trả về null (trước đây Number(null) = 0 thành tọa độ 0,0 giữa biển)
      if (!value || value.latitude == null || value.longitude == null) return null;
      const latitude = Number(value.latitude);
      const longitude = Number(value.longitude);
      if (latitude === 0 && longitude === 0) return null;
      const radiusKm = normalizeRadiusKm(value && value.radiusKm);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude, radiusKm };
    } catch (error) {
      return null;
    }
  }

  function saveNearbyLocation(location) {
    localStorage.setItem(NEARBY_LOCATION_STORAGE_KEY, JSON.stringify(location));
    window.FOODSAVE_NEARBY_LOCATION = location;
  }

  function clearStoredNearbyLocation() {
    localStorage.removeItem(NEARBY_LOCATION_STORAGE_KEY);
    window.FOODSAVE_NEARBY_LOCATION = null;
  }

  function catalogPath(basePath, location, options) {
    if (!location) return `${basePath}?limit=100`;
    const params = new URLSearchParams({
      limit: "100",
      lat: String(location.latitude),
      lng: String(location.longitude),
      radius_km: String(location.radiusKm || DEFAULT_NEARBY_RADIUS_KM)
    });
    if (options && options.sortNearest) params.set("sort", "nearest");
    return `${basePath}?${params.toString()}`;
  }

  function browserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Trình duyệt chưa hỗ trợ GPS."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          radiusKm: normalizeRadiusKm(DEFAULT_NEARBY_RADIUS_KM)
        }),
        () => reject(new Error("Không lấy được vị trí. Hãy cho phép MIO truy cập GPS.")),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  function readAuthSession() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      const legacy = JSON.parse(localStorage.getItem(LEGACY_AUTH_STORAGE_KEY) || "null");
      return legacy && legacy.role === PAGE_ROLE ? legacy : null;
    } catch (error) {
      return null;
    }
  }

  function authToken() {
    const session = readAuthSession();
    return session && typeof session.accessToken === "string" ? session.accessToken : "";
  }

  function directSupabaseClient() {
    if (window.foodsaveSupabase) return window.foodsaveSupabase;
    if (window.FoodSaveAuth && typeof window.FoodSaveAuth.getSupabaseClient === "function") {
      return window.FoodSaveAuth.getSupabaseClient();
    }
    if (typeof window.getFoodSaveSupabaseClient === "function") {
      return window.getFoodSaveSupabaseClient();
    }
    return null;
  }

  // Ưu tiên token của phiên Supabase (tự làm mới), sau đó mới đến phiên lưu trong localStorage
  // Token đã bị server trả 401 thì coi như không có: không gọi lại các API cần đăng nhập
  // (tránh lặp lỗi 401 liên tục khi phiên lưu sẵn đã hết hạn). Đăng nhập lại sẽ có token mới.
  let rejectedAuthToken = "";
  // Token gần nhất lấy được từ phiên Supabase (đã tự làm mới): cho nơi cần header đồng bộ, như client vị trí.
  let lastResolvedToken = "";
  // Lần tải đơn gần nhất bị lỗi (mạng/401/500): danh sách rỗng lúc đó KHÔNG có nghĩa là hết đơn.
  let ordersLoadFailed = false;

  async function resolveAuthToken() {
    let token = "";
    try {
      const client = directSupabaseClient();
      if (client && client.auth && typeof client.auth.getSession === "function") {
        const { data } = await client.auth.getSession();
        if (data && data.session && data.session.access_token) token = data.session.access_token;
      }
    } catch (error) {
      // Chưa khởi tạo được Supabase client: dùng phiên lưu sẵn
    }
    if (!token) token = authToken();
    if (token && token === rejectedAuthToken) return "";
    lastResolvedToken = token || "";
    return token;
  }

  // Header Authorization đồng bộ ("Bearer ...") hoặc null khi chưa đăng nhập / token đã bị từ chối.
  function syncAuthHeader() {
    if (window.MIO_DEMO_MODE) return null;
    const token = lastResolvedToken || authToken();
    if (!token || token === rejectedAuthToken) return null;
    return "Bearer " + token;
  }

  // Khóa tài khoản đang đăng nhập ("customer:<id>"), để client vị trí gắn lựa chọn chia sẻ với đúng tài khoản.
  function syncActorKey() {
    if (window.MIO_DEMO_MODE) return null;
    const session = readAuthSession();
    const id = session && session.profile && session.profile.id;
    return id ? PAGE_ROLE + ":" + id : null;
  }

  async function request(path, options) {
    if (window.MIO_DEMO_MODE) throw new Error("Chế độ demo: không gửi yêu cầu tới API.");
    const token = await resolveAuthToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options && options.method ? options.method : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: options && options.body ? JSON.stringify(options.body) : undefined,
      signal: options && options.signal ? options.signal : undefined
    });

    if (response.status === 401 && token) rejectedAuthToken = token;

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.success !== true) {
      const message = payload && payload.error && payload.error.message ? payload.error.message : "MIO API không phản hồi hợp lệ";
      const detail = payload && payload.error && Array.isArray(payload.error.details) ? payload.error.details.map((d) => (d.path ? d.path + ": " : "") + (d.message || "")).join("; ") : "";
      if (detail) console.warn("[MIO] Chi tiết lỗi dữ liệu:", payload.error.details);
      const failure = new Error(detail ? message + " (" + detail + ")" : message);
      failure.code = payload && payload.error ? payload.error.code : undefined;
      failure.status = response.status;
      throw failure;
    }

    return payload.data;
  }

  function getGlobalArray(name) {
    try {
      const value = Function(`return typeof ${name} !== "undefined" ? ${name} : null`)();
      return Array.isArray(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function replaceArray(name, items) {
    const target = getGlobalArray(name);
    if (!target) return;
    target.splice(0, target.length, ...items);
  }

  // Các cột *_cents lưu thẳng số tiền VND
  function centsToVnd(value) {
    return Math.round(Number(value) || 0);
  }

  function hoursUntil(value) {
    if (!value) return 0;
    const expiryTime = new Date(value).getTime();
    if (!Number.isFinite(expiryTime)) return 0;
    return Math.max(0, Math.round((expiryTime - Date.now()) / 3600000));
  }

  function productLabelFromExpiry(expiresAt, fallback) {
    if (!expiresAt) return fallback || "green";
    const hours = hoursUntil(expiresAt);
    if (hours <= 24) return "red";
    if (hours <= 48) return "yellow";
    return "green";
  }

  function mapProduct(product) {
    const store = product.stores || product.store || {};
    return {
      id: product.id,
      emoji: product.emoji || store.emoji || "🍽️",
      name: product.name,
      store: store.name || "",
      storeId: product.store_id,
      distance: normalizeDistanceKm(product.distance_km ?? product.distance),
      distanceText: product.distance_text || distanceLabel(product.distance_km ?? product.distance),
      price: centsToVnd(product.price_cents),
      original: centsToVnd(product.original_price_cents),
      // Nhãn do backend tính theo nhóm hàng và giờ đóng cửa
      label: product.label || productLabelFromExpiry(product.expires_at),
      expiresHrs: hoursUntil(product.effective_deadline_at || product.expires_at),
      image: product.image_url || "",
      images: Array.isArray(product.image_urls) ? product.image_urls : [],
      foodGroup: product.food_group || "",
      stock: Number(product.stock_quantity) || 0,
      cat: product.category || "other",
      rating: Number(product.rating) || 0,
      sold: Number(product.sold_count) || 0,
      desc: product.description || "",
      estimatedWeightKg: Number(product.estimated_weight_kg) || null,
      servingsCount: Number(product.servings_count) || null,
      donation: Boolean(product.is_donation)
    };
  }

  function mapStore(store) {
    return {
      id: store.id,
      name: store.name,
      logo: store.emoji || "🏪",
      addr: store.address || "",
      distance: normalizeDistanceKm(store.distance_km ?? store.distance),
      distanceText: store.distance_text || distanceLabel(store.distance_km ?? store.distance),
      latitude: Number.isFinite(Number(store.latitude)) ? Number(store.latitude) : null,
      longitude: Number.isFinite(Number(store.longitude)) ? Number(store.longitude) : null,
      rating: Number(store.rating) || 0,
      products: 0,
      hours: store.opening_hours || "",
      verified: Boolean(store.is_verified),
      opening: Boolean(store.is_open)
    };
  }

  function mapVoucher(voucher) {
    return {
      code: voucher.code,
      name: voucher.name,
      desc: voucher.description || "",
      expiry: voucher.expires_at ? new Date(voucher.expires_at).toLocaleDateString("vi-VN") : "",
      tag: "green",
      percent: voucher.percent_off,
      fixed: centsToVnd(voucher.fixed_discount_cents),
      min: centsToVnd(voucher.min_order_cents)
    };
  }

  // Thông báo tự động khi sản phẩm chuyển nhãn / có hàng tặng từ thiện
  const NOTIFICATION_STYLES = {
    "label-yellow": { type: "new", icon: "ti-clock-hour-4" },
    "label-red": { type: "urgent", icon: "ti-flame" },
    "label-red-reminder": { type: "urgent", icon: "ti-alarm" },
    "charity-offer": { type: "urgent", icon: "ti-heart-handshake" },
    "order-paid": { type: "new", icon: "ti-circle-check" },
    "order-ready": { type: "new", icon: "ti-package" },
    "voucher-new": { type: "new", icon: "ti-ticket" },
    "order-reminder-mid": { type: "urgent", icon: "ti-alarm" },
    "order-reminder-final": { type: "urgent", icon: "ti-alarm" },
    "order-no-show": { type: "urgent", icon: "ti-user-off" },
    "order-payment-timeout": { type: "system", icon: "ti-hourglass-off" },
    "no-show-warning": { type: "urgent", icon: "ti-alert-triangle" },
    "red-label-banned": { type: "urgent", icon: "ti-ban" },
    "account-unlocked": { type: "new", icon: "ti-lock-open" },
    "order-chat": { type: "new", icon: "ti-messages" },
    "new-complaint": { type: "urgent", icon: "ti-message-report" },
    "complaint-update": { type: "new", icon: "ti-message-report" },
    "complaint-decision": { type: "new", icon: "ti-gavel" },
    "complaint-escalated": { type: "urgent", icon: "ti-arrow-up-circle" },
    "withdrawal-update": { type: "new", icon: "ti-cash" },
    "payout-account-decision": { type: "new", icon: "ti-building-bank" }
  };

  function mapNotification(notification) {
    const style = NOTIFICATION_STYLES[notification.type] || null;
    return {
      id: notification.id,
      type: style ? style.type : notification.type || "system",
      sourceType: notification.type || "system",
      relatedType: notification.related_type || null,
      relatedId: notification.related_id || null,
      icon: style ? style.icon : "ti-bell",
      title: notification.title,
      desc: notification.body,
      time: notification.created_at ? new Date(notification.created_at).toLocaleString("vi-VN") : "",
      unread: !notification.read_at,
      createdAt: notification.created_at || ""
    };
  }

  function paymentMethodLabel(method) {
    return {
      momo: "MoMo",
      zalopay: "ZaloPay",
      vnpay: "VNPay",
      card: "Visa/Mastercard",
      vietqr: "VietQR",
      cash: "COD"
    }[method] || method || "";
  }

  function mapUserOrder(order) {
    const items = Array.isArray(order.order_items) ? order.order_items : [];
    const created = order.created_at ? new Date(order.created_at) : null;
    return {
      id: "#" + order.order_number,
      backendId: order.id,
      momoOrderId: order.order_number,
      code: order.order_number,
      status: order.status,
      payDeadline: order.pay_deadline || null,
      paidAt: order.paid_at || null,
      pickupDeadline: order.pickup_deadline || null,
      cancelFreeUntil: order.cancel_free_until || null,
      cancelReason: order.cancel_reason || "",
      cancelledBy: order.cancelled_by || "",
      policyLabel: order.policy_label || "",
      completedAt: order.completed_at || null,
      complaintDeadlineAt: order.complaint_deadline_at || null,
      settlementStatus: order.settlement_status || "none",
      store: order.stores && order.stores.name ? order.stores.name : "",
      storeId: order.store_id,
      total: centsToVnd(order.total_cents),
      subtotal: centsToVnd(order.subtotal_cents),
      discount: centsToVnd(order.discount_cents),
      pickup: order.pickup_window,
      pickupWindow: order.pickup_window,
      payment: paymentMethodLabel(order.payment_method),
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      created: order.created_at,
      date: created && Number.isFinite(created.getTime())
        ? created.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
        : "",
      qr: order.qr_code,
      items: items.map((item) => ({
        id: item.product_id,
        name: item.product_name,
        qty: item.quantity,
        price: centsToVnd(item.unit_price_cents)
      }))
    };
  }

  // Khiếu nại từ API -> dạng trang Cửa hàng đang dùng (st: open | in-review | resolved)
  function mapComplaint(row) {
    const status = row.status === "in_review" ? "in-review" : row.status === "open" ? "open" : "resolved";
    const created = row.created_at ? new Date(row.created_at) : null;
    const orderNumber = row.order_number || (row.orders && row.orders.order_number) || "";
    const due = row.response_due_at ? new Date(row.response_due_at).getTime() : 0;
    const REASONS = { wrong_item: "Giao sai sản phẩm", spoiled_expired: "Hư hỏng / hết hạn", missing_items: "Thiếu sản phẩm", other: "Lý do khác" };
    const photos = Array.isArray(row.image_urls) ? row.image_urls : [];
    return {
      id: row.id,
      uuid: row.id,
      orderId: row.order_id,
      code: "KN-" + String(row.id || "").slice(0, 6).toUpperCase(),
      img: "📦",
      user: row.customer_name || "Khách hàng",
      order: orderNumber ? "#" + orderNumber : "",
      time: created && Number.isFinite(created.getTime()) ? created.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "",
      product: Array.isArray(row.product_names) ? row.product_names.join(", ") : "",
      issue: row.issue || "",
      priority: row.priority || "medium",
      st: status,
      apiStatus: row.status,
      resolution: row.resolution || "",
      // luồng mới (Đợt 3)
      reasonCode: row.reason_code || "",
      reason: row.reason_code ? (REASONS[row.reason_code] || row.reason_code) : "",
      respondBy: status === "open" && Number.isFinite(due) ? due : 0,
      photoUrls: photos,
      photos: photos.length,
      amount: row.order_total != null ? Number(row.order_total) : 0,
      decision: row.decision || "",
      refund: Number(row.refund_cents) || 0,
      storeResponse: row.store_response || "",
      storeAction: row.store_response_action || ""
    };
  }

  function mapDonation(donation) {
    const store = donation.stores || {};
    const volunteer = donation.volunteers || {};
    return {
      id: donation.id,
      code: donation.donation_code,
      store: store.name || "",
      storeAv: store.name ? store.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() : "FS",
      d: "",
      img: store.emoji || "🍱",
      items: donation.items,
      amount: donation.amount_text,
      weight: `${Number(donation.weight_kg) || 0}kg`,
      exp: donation.expires_at ? new Date(donation.expires_at).toLocaleString("vi-VN") : "",
      left: 0,
      urgency: donation.urgency || "green",
      pickupStart: donation.pickup_start ? new Date(donation.pickup_start).toLocaleString("vi-VN") : "",
      pickupEnd: donation.pickup_end ? new Date(donation.pickup_end).toLocaleString("vi-VN") : "",
      time: donation.created_at ? new Date(donation.created_at).toLocaleString("vi-VN") : "",
      status: donation.status === "open" ? "new" : String(donation.status || "").replace(/_/g, "-"),
      note: donation.note || "",
      vol: volunteer.full_name || null,
      distance: donation.distance_text || "",
      quantity: donation.quantity || null,
      charityName: donation.charity_profiles && donation.charity_profiles.name ? donation.charity_profiles.name : "",
      offerExpiresAt: donation.offer_expires_at || "",
      isAuto: Boolean(donation.is_auto),
      expiresAt: donation.expires_at || "",
      charityId: donation.charity_id || "",
      volunteerId: donation.assigned_volunteer_id || "",
      storeAddress: store.address || "",
      storeDistrict: store.district || "",
      distributeVolunteerId: donation.distribute_volunteer_id || "",
      distributorName: (donation.distributor && donation.distributor.full_name) || "",
      portions: donation.portions || null,
      distributionDoneAt: donation.distribution_done_at || "",
      team: {
        pickup: (donation.donation_assignments || []).filter((a) => a.stage === "pickup").map((a) => ({ vid: a.volunteer_id, name: (a.volunteers && a.volunteers.full_name) || "", share: a.share, done: Boolean(a.done_at) })),
        distribute: (donation.donation_assignments || []).filter((a) => a.stage === "distribute").map((a) => ({ vid: a.volunteer_id, name: (a.volunteers && a.volunteers.full_name) || "", share: a.share, done: Boolean(a.done_at) }))
      },
      photos: (donation.donation_photos || []).map((p) => ({
        id: p.id, vid: p.volunteer_id, name: (p.volunteers && p.volunteers.full_name) || "", stage: p.stage, url: p.photo_url, status: p.status,
        takenAt: p.taken_at || "", gpsFlag: Boolean(p.gps_flag), note: p.review_note || "", deadline: p.review_deadline_at || "", isDemo: Boolean(p.is_demo)
      })).sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt))),
      volunteerPhone: volunteer.phone || "",
      storeConfirmedAt: donation.store_confirmed_at || "",
      volunteerAssignedAt: donation.volunteer_assigned_at || "",
      packedAt: donation.packed_at || "",
      pickupCode: donation.pickup_code || "",
      proofPhotos: Array.isArray(donation.proof_photo_urls) ? donation.proof_photo_urls : [],
      proofNote: donation.proof_note || "",
      proofAt: donation.proof_submitted_at || "",
      createdAt: donation.created_at || "",
      completedAt: donation.completed_at || ""
    };
  }

  function pushNearbyDealNotification(products, location) {
    const deals = (products || [])
      .filter((product) => Number.isFinite(Number(product.distance)) && product.distance <= (location.radiusKm || DEFAULT_NEARBY_RADIUS_KM))
      .filter((product) => product.label === "red" || product.label === "yellow" || (product.original && (1 - product.price / product.original) >= 0.3))
      .slice(0, 3);

    if (!deals.length) return;

    const signature = `${new Date().toISOString().slice(0, 10)}:${deals.map((deal) => deal.id).join(",")}`;
    if (localStorage.getItem(NEARBY_NOTIFICATION_STORAGE_KEY) === signature) return;
    localStorage.setItem(NEARBY_NOTIFICATION_STORAGE_KEY, signature);

    const firstDeal = deals[0];
    const title = `${deals.length} deal MIO gần bạn`;
    const body = `${firstDeal.name} tại ${firstDeal.store} · ${firstDeal.distanceText || distanceLabel(firstDeal.distance)} · còn ${firstDeal.expiresHrs} giờ`;

    if (Array.isArray(window.USER_NOTIFS)) {
      window.USER_NOTIFS.unshift({
        id: Date.now(),
        type: "promo",
        icon: "ti-map-pin",
        iconBg: "#dcfce7",
        iconColor: "#16a34a",
        title,
        desc: body,
        time: "Vừa xong",
        unread: true
      });
      if (typeof window.updateNotifBadge === "function") window.updateNotifBadge();
      if (typeof window.renderNotifs === "function") window.renderNotifs("all");
    }

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, {
        body,
        tag: "foodsave-nearby-deal",
        icon: "/favicon.ico"
      });
    }
  }

  async function loadCatalogData(options) {
    const hasLocationOption = options && Object.prototype.hasOwnProperty.call(options, "location");
    const location = hasLocationOption ? options.location : readNearbyLocation();
    const [products, stores, vouchers] = await Promise.all([
      request(catalogPath("/catalog/products", location, { sortNearest: true })).catch(() => ({ items: [] })),
      request(catalogPath("/catalog/stores", location)).catch(() => ({ items: [] })),
      request("/catalog/vouchers").catch(() => [])
    ]);

    const mappedProducts = (products.items || []).map(mapProduct);
    const mappedStores = (stores.items || []).map(mapStore);
    replaceArray("PRODUCTS", mappedProducts);
    if (typeof window.foodsaveAfterProductsReplace === "function") window.foodsaveAfterProductsReplace();
    replaceArray("STORES", mappedStores);
    replaceArray("VOUCHERS", (Array.isArray(vouchers) ? vouchers : []).map(mapVoucher));
    window.FOODSAVE_NEARBY_LOCATION = location || null;
    window.dispatchEvent(new CustomEvent("foodsave:nearby-location", {
      detail: { location, products: mappedProducts, stores: mappedStores }
    }));
    if (location) pushNearbyDealNotification(mappedProducts, location);

    return {
      products: mappedProducts,
      stores: mappedStores,
      vouchers: Array.isArray(vouchers) ? vouchers : []
    };
  }

  // Các phần dữ liệu cần đăng nhập. Cổng cửa hàng / tổ chức chỉ tải lại phần thay đổi (giữ hạn mức Netlify).
  const AUTH_PARTS = ["orders", "donations", "notifications", "complaints", "eco"];
  const partLoadedAt = {};
  let knownNotificationIds = null;

  function fetchAuthPart(part) {
    if (part === "orders") return request("/orders?limit=100").catch(() => { ordersLoadFailed = true; return { items: [] }; });
    if (part === "donations") return request("/donations?limit=100").catch(() => ({ items: [] }));
    if (part === "notifications") return request("/notifications?limit=100").catch(() => ({ items: [] }));
    if (part === "complaints") return request("/orders/complaints/list").catch(() => []);
    return Promise.all([
      request("/eco-impact/me?period=all&months=6").catch(() => null),
      request("/eco-impact/partner?period=all&months=6").catch(() => null),
      request("/eco-impact/charity?period=all&months=6").catch(() => null),
      request("/eco-impact/platform?period=all&months=6").catch(() => null),
      request("/eco-impact/leaderboard?period=month&limit=10").catch(() => [])
    ]);
  }

  let ordersIdleCheck = false;   // true khi lượt tải đơn là kiểm tra lúc rảnh (cửa hàng)
  function applyOrders(orders) {
    if (ordersIdleCheck && IS_PORTAL && !pollCanRun()) {
      // Rảnh: không thay ORD/không vẽ lại (DOM cũ còn tham chiếu theo chỉ số); chỉ để trang đếm đơn mới và báo
      if (!ordersLoadFailed && typeof window.foodsaveOrdersIdleCheck === "function") window.foodsaveOrdersIdleCheck(orders.items || []);
      return;
    }
    const previousOrderStatus = {};
    (getGlobalArray("orders") || []).forEach((order) => {
      if (order && order.backendId) previousOrderStatus[order.backendId] = order.status;
    });
    replaceArray("orders", (orders.items || []).map(mapUserOrder));
    if (typeof window.foodsaveAfterUserOrdersReplace === "function") window.foodsaveAfterUserOrdersReplace(previousOrderStatus);
    const keepSelectedOrder = typeof window.foodsaveBeforeOrdersReplace === "function" ? window.foodsaveBeforeOrdersReplace() : null;
    replaceArray("ORD", (orders.items || []));
    if (typeof window.foodsaveAfterOrdersReplace === "function") window.foodsaveAfterOrdersReplace(keepSelectedOrder);
  }

  function applyAuthPart(part, data) {
    partLoadedAt[part] = Date.now();
    if (part === "orders") return applyOrders(data);
    if (part === "donations") {
      replaceArray("DONATIONS", (data.items || []).map(mapDonation));
      if (typeof window.foodsaveAfterDonationsReplace === "function") window.foodsaveAfterDonationsReplace();
      return;
    }
    if (part === "notifications") {
      replaceArray("NOTIFS", (data.items || []).map(mapNotification));
      if (typeof window.foodsaveAfterNotifsReplace === "function") window.foodsaveAfterNotifsReplace();
      const ids = (data.items || []).map((n) => String(n.id));
      const fresh = knownNotificationIds ? ids.some((id) => !knownNotificationIds.has(id)) : false;
      knownNotificationIds = new Set(ids);
      if (fresh && IS_PORTAL) setTimeout(afterNewNotifications, 0);
      return;
    }
    if (part === "complaints") {
      replaceArray("COMPLAINTS", Array.isArray(data) ? data.map(mapComplaint) : []);
      return;
    }
    const [impactMe, impactPartner, impactCharity, impactPlatform, leaderboard] = data;
    window.ECO_IMPACT = {
      me: impactMe,
      partner: impactPartner,
      charity: impactCharity,
      platform: impactPlatform,
      leaderboard: Array.isArray(leaderboard) ? leaderboard : []
    };
  }

  // parts: danh sách phần cần tải (mặc định: tất cả). Áp dụng theo đúng thứ tự cũ: đơn, quyên góp, thông báo, khiếu nại, tác động.
  async function loadAuthenticatedData(parts) {
    if (!(await resolveAuthToken())) return false;
    const wanted = AUTH_PARTS.filter((part) => !parts || parts.indexOf(part) !== -1);
    if (wanted.indexOf("orders") !== -1) ordersLoadFailed = false;
    const results = await Promise.all(wanted.map(fetchAuthPart));
    wanted.forEach((part) => { partLoadedAt[part] = Date.now(); });
    wanted.forEach((part, index) => applyAuthPart(part, results[index]));
    return true;
  }

  // Cổng cửa hàng / tổ chức: lần đầu tải đủ; sau đó (sau thao tác, nhịp làm mới) chỉ tải phần hay thay đổi.
  const IS_PORTAL = PAGE_ROLE === "partner" || PAGE_ROLE === "charity";
  const PORTAL_LIGHT_PARTS = PAGE_ROLE === "partner" ? ["orders", "donations", "notifications", "complaints"] : ["donations", "notifications"];
  let fullyHydrated = false;

  function renderAfterLoad() {
    if (typeof window.renderHome === "function" && document.querySelector("#page-home.active")) window.renderHome();
    if (typeof window.renderMarket === "function" && document.querySelector("#page-market.active")) window.renderMarket();
    if (typeof window.renderOrders === "function" && document.querySelector("#page-orders.active")) window.renderOrders("all");
    if (typeof window.updateNotifBadge === "function") window.updateNotifBadge();
    if (typeof window.R === "function") window.R();
  }

  async function hydratePage(options) {
    if (window.MIO_DEMO_MODE) return false;
    const full = !IS_PORTAL || !fullyHydrated || Boolean(options && options.full);
    if (!full) {
      await loadAuthenticatedData(PORTAL_LIGHT_PARTS);
      markPolled(PORTAL_LIGHT_PARTS);
      renderAfterLoad();
      return;
    }
    await loadCatalogData();
    const loaded = await loadAuthenticatedData();
    if (loaded) { fullyHydrated = true; markPolled(AUTH_PARTS); }

    renderAfterLoad();
  }

  // ───── Báo cáo từng lô (dùng chung cho Tổ chức, Cửa hàng, Admin)
  function reportEsc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function reportTime(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) + " " + d.toLocaleDateString("vi-VN");
  }
  const REPORT_PHOTO_STATUS = { pending: "Chờ duyệt", approved: "Đã duyệt", auto_approved: "Tự động gửi", retake: "Cần chụp lại" };

  function renderDonationReport(report) {
    const d = report.donation || {};
    const th = 'style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb"';
    const td = 'style="padding:7px 8px;font-size:13px;border-bottom:1px solid #f1f5f9"';
    const teamTable = (title, members, unit) => {
      if (!members || !members.length) return "";
      return '<h4 style="margin:16px 0 6px;font-size:14px">' + title + '</h4><table style="width:100%;border-collapse:collapse"><tr><th ' + th + '>TNV</th><th ' + th + '>Phương tiện</th><th ' + th + '>Phần việc</th><th ' + th + '>Ảnh</th><th ' + th + '>Trạng thái</th></tr>' +
        members.map((m) => "<tr><td " + td + "><b>" + reportEsc(m.name) + "</b>" + (m.phone ? "<br><small>" + reportEsc(m.phone) + "</small>" : "") + "</td><td " + td + ">" + reportEsc(m.vehicle) + "</td><td " + td + ">" + m.share + " " + unit + "</td><td " + td + ">" + m.photo_count + "</td><td " + td + ">" + (m.done_at ? "Đã hoàn tất" : "Đang làm") + "</td></tr>").join("") + "</table>";
    };
    const photoGroup = (title, stage) => {
      const list = (report.photos || []).filter((p) => p.stage === stage && p.status !== "retake");
      if (!list.length) return "";
      return '<h4 style="margin:16px 0 6px;font-size:14px">' + title + '</h4><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">' +
        list.map((p) => '<div><a href="' + reportEsc(p.photo_url) + '" target="_blank" rel="noopener"><img src="' + reportEsc(p.photo_url) + '" alt="" style="width:100%;height:100px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb"></a><div style="font-size:10.5px;color:#6b7280">' + reportEsc((p.volunteers && p.volunteers.full_name) || "TNV") + " · " + reportTime(p.taken_at) + (p.is_demo ? " · Ảnh demo" : "") + "<br>" + (REPORT_PHOTO_STATUS[p.status] || p.status) + "</div></div>").join("") + "</div>";
    };
    return '<div class="fs-report" style="font-family:system-ui,sans-serif;color:#111827">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><div style="font-size:18px;font-weight:800">BÁO CÁO LÔ TẶNG THỰC PHẨM</div><div style="font-size:12px;color:#6b7280">Mã lô ' + reportEsc(d.code) + "</div></div>" +
      '<div style="font-size:12px;text-align:right;color:#374151">' + reportEsc((report.store || {}).name) + " → " + reportEsc((report.charity || {}).name) + "</div></div>" +
      '<table style="width:100%;border-collapse:collapse;margin-top:12px"><tr><td ' + td + ">Mặt hàng</td><td " + td + "><b>" + reportEsc(d.items) + "</b></td><td " + td + ">Số lượng</td><td " + td + "><b>" + reportEsc(d.amount_text || d.quantity || "") + "</b></td></tr>" +
      "<tr><td " + td + ">Trọng lượng ước tính</td><td " + td + "><b>" + (Number(d.weight_kg) || 0) + " kg</b></td><td " + td + ">Số suất đã phát</td><td " + td + "><b>" + (d.portions || "—") + "</b></td></tr></table>" +
      teamTable("Đội lấy hàng", report.team && report.team.pickup, "sản phẩm") + teamTable("Đội phát hàng", report.team && report.team.distribute, "suất") +
      '<h4 style="margin:16px 0 6px;font-size:14px">Dòng thời gian</h4><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">' +
      (report.timeline || []).map((e) => "<li><b>" + reportTime(e.at) + "</b> · " + reportEsc(e.label) + "</li>").join("") + "</ul>" +
      photoGroup("Ảnh nhận hàng tại cửa hàng", "pickup") + photoGroup("Ảnh chế biến và phát hàng", "distribute") +
      '<div style="margin-top:14px;font-size:11px;color:#9ca3af">Tạo lúc ' + reportTime(new Date().toISOString()) + " bởi MIO</div></div>";
  }
  function printDonationReport() {
    const html = (window.FS && window.FS.lastReportHtml) || "";
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>Báo cáo lô</title></head><body style=\"padding:24px\">" + html + "</body></html>");
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  window.FS = window.FS || {};
  window.FS.renderDonationReport = renderDonationReport;
  window.FS.printDonationReport = printDonationReport;
  window.FS.sync = {
    source: "backend",
    apiBaseUrl: API_BASE_URL,
    authHeader: syncAuthHeader,
    actorKey: syncActorKey,
    ordersLoadFailed() { return ordersLoadFailed; },
    request,
    hydratePage,
    getNearbyLocation() {
      return readNearbyLocation();
    },
    clearNearbyLocation() {
      clearStoredNearbyLocation();
      return loadCatalogData({ location: null }).then((data) => {
        if (typeof window.renderHome === "function" && document.querySelector("#page-home.active")) window.renderHome();
        if (typeof window.renderMarket === "function" && document.querySelector("#page-market.active")) window.renderMarket();
        if (typeof window.renderMap === "function" && document.querySelector("#page-map.active")) window.renderMap();
        return data;
      });
    },
    async enableNearbyDeals() {
      const location = await browserLocation();
      saveNearbyLocation(location);

      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission().catch(() => "denied");
      }

      const data = await loadCatalogData({ location });
      if (typeof window.renderHome === "function" && document.querySelector("#page-home.active")) window.renderHome();
      if (typeof window.renderMarket === "function" && document.querySelector("#page-market.active")) window.renderMarket();
      if (typeof window.renderMap === "function" && document.querySelector("#page-map.active")) window.renderMap();
      return data;
    },
    pushOrder(orderPayload) {
      return request("/orders", { method: "POST", body: orderPayload });
    },
    createMomoPayment(orderPayload) {
      return request("/orders/payments/momo", { method: "POST", body: orderPayload });
    },
    refreshMomoPayment(orderId) {
      return request(`/orders/${encodeURIComponent(orderId)}/payments/momo/refresh`, { method: "POST" });
    },
    pollMomoPayment(orderId) {
      return request(`/orders/${encodeURIComponent(orderId)}/payments/momo/status`, { method: "GET" });
    },
    // Người mua hủy đơn (hoàn tiền hay không do Backend quyết định theo hạn miễn phí)
    cancelOrder(orderId, reason) {
      return request(`/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST", body: reason ? { reason } : {} });
    },
    // Đơn mới tạo đã ở trạng thái "chờ thanh toán": không cần ghi thêm
    markOrderPaymentPending() {
      return Promise.resolve(null);
    },
    // Chỉ đánh dấu đã thanh toán qua Backend. Trạng thái đơn do cửa hàng nhận đơn mới đổi.
    markOrderPaymentPaid(orderId, paymentMethod) {
      return request(`/orders/${encodeURIComponent(orderId)}/confirm-payment`, {
        method: "POST",
        body: paymentMethod ? { payment_method: paymentMethod } : {}
      });
    },
    getOrders() {
      return request("/orders?limit=100");
    },
    updateOrderStatus(orderId, status) {
      return request(`/orders/${encodeURIComponent(orderId)}/status`, { method: "PATCH", body: { status } });
    },
    pushDonation(donationPayload) {
      return request("/donations", { method: "POST", body: donationPayload });
    },
    getDonations() {
      return request("/donations?limit=100");
    },
    updateDonationStatus(donationId, status, note) {
      return request(`/donations/${encodeURIComponent(donationId)}/status`, {
        method: "PATCH",
        body: { status, ...(note ? { note } : {}) }
      });
    },
    hydratePage() {
      return hydratePage();
    },
    getCharityGallery(charityId) {
      return request(`/charity/gallery?charity_id=${encodeURIComponent(charityId)}`);
    },
    createCharityGalleryUpload(charityId, contentType) {
      return request("/charity/gallery/upload-url", { method: "POST", body: { charity_id: charityId, content_type: contentType } });
    },
    createCharityGalleryItem(body) {
      return request("/charity/gallery", { method: "POST", body });
    },
    getBeneficiaryGroups(charityId) {
      return request(`/charity/profiles/${encodeURIComponent(charityId)}/beneficiaries`);
    },
    createBeneficiaryGroup(body) {
      return request("/charity/beneficiaries", { method: "POST", body });
    },
    updateBeneficiaryGroup(groupId, body) {
      return request(`/charity/beneficiaries/${encodeURIComponent(groupId)}`, { method: "PATCH", body });
    },
    deleteBeneficiaryGroup(groupId) {
      return request(`/charity/beneficiaries/${encodeURIComponent(groupId)}`, { method: "DELETE" });
    },
    getCharityVolunteers(charityId) {
      return request(`/charity/profiles/${encodeURIComponent(charityId)}/volunteers`);
    },
    createCharityVolunteer(body) {
      return request("/charity/volunteers", { method: "POST", body });
    },
    updateCharityVolunteer(volunteerId, body) {
      return request(`/charity/volunteers/${encodeURIComponent(volunteerId)}`, { method: "PATCH", body });
    },
    createDonationProofUpload(donationId, contentType) {
      return request(`/donations/${encodeURIComponent(donationId)}/proof/upload-url`, { method: "POST", body: { content_type: contentType } });
    },
    submitDonationProof(donationId, photoUrls, note) {
      return request(`/donations/${encodeURIComponent(donationId)}/proof`, { method: "PATCH", body: { photo_urls: photoUrls, ...(note ? { note } : {}) } });
    },
    donationStoreResponse(donationId, accept) {
      return request(`/donations/${encodeURIComponent(donationId)}/store-response`, { method: "PATCH", body: { accept: Boolean(accept) } });
    },
    assignDonationVolunteer(donationId, volunteerId, extra) {
      return request(`/donations/${encodeURIComponent(donationId)}/assign-volunteer`, { method: "PATCH", body: { volunteer_id: volunteerId, ...(extra || {}) } });
    },
    getMarketingSettings() { return request("/marketing/settings"); },
    updateMarketingSettings(body) { return request("/marketing/settings", { method: "PATCH", body }); },
    getMarketingPosts() { return request("/marketing/posts"); },
    getMarketingContent(productId) { return request(`/marketing/products/${encodeURIComponent(productId)}/content`); },
    promoteProduct(productId, body) { return request(`/marketing/products/${encodeURIComponent(productId)}/promote`, { method: "POST", body }); },
    assignDonationTeam(donationId, body) {
      return request(`/donations/${encodeURIComponent(donationId)}/team`, { method: "PUT", body });
    },
    reviewDonationPhoto(photoId, body) {
      return request(`/donations/photos/${encodeURIComponent(photoId)}/review`, { method: "PATCH", body });
    },
    getDonationReport(donationId) {
      return request(`/donations/${encodeURIComponent(donationId)}/report`);
    },
    assignDonationDistribution(donationId, volunteerId, portions) {
      return request(`/donations/${encodeURIComponent(donationId)}/distribution`, { method: "PATCH", body: { volunteer_id: volunteerId, portions } });
    },
    markDonationPacked(donationId) {
      return request(`/donations/${encodeURIComponent(donationId)}/packed`, { method: "PATCH" });
    },
    confirmDonationHandover(donationId, code) {
      return request(`/donations/${encodeURIComponent(donationId)}/handover`, { method: "PATCH", body: { code } });
    },
    acceptDonation(donationId, charityId, assignedVolunteerId) {
      return request(`/donations/${encodeURIComponent(donationId)}/accept`, {
        method: "PATCH",
        body: {
          charity_id: charityId,
          ...(assignedVolunteerId ? { assigned_volunteer_id: assignedVolunteerId } : {})
        }
      });
    },
    pushComplaint(complaintPayload) {
      return request("/orders/complaints", { method: "POST", body: complaintPayload });
    },
    getComplaints() {
      return request("/orders/complaints/list");
    },
    getNotifications() {
      return request("/notifications?limit=100");
    },
    // Tải nhẹ riêng thông báo (chuông và banner khuyến mãi cập nhật mỗi 20 giây)
    async refreshNotifications() {
      const data = await request("/notifications?limit=100");
      applyAuthPart("notifications", data);
      markPolled(["notifications"]);
    },
    // Tải lại đúng các phần cần (vd ["complaints"]) khi mở màn hình tương ứng
    refreshParts(parts) {
      return refreshParts(parts);
    },
    // Làm mới toàn bộ (kể cả danh mục và thống kê tác động)
    refreshAll() {
      return hydratePage({ full: true });
    },
    getEcoImpactMe(params) {
      return request(`/eco-impact/me${params ? `?${params}` : ""}`);
    },
    getEcoImpactPartner(params) {
      return request(`/eco-impact/partner${params ? `?${params}` : ""}`);
    },
    getEcoImpactCharity(params) {
      return request(`/eco-impact/charity${params ? `?${params}` : ""}`);
    },
    getEcoImpactPlatform(params) {
      return request(`/eco-impact/platform${params ? `?${params}` : ""}`);
    },
    getEcoImpactLeaderboard(params) {
      return request(`/eco-impact/leaderboard${params ? `?${params}` : ""}`);
    },
    markAllNotifsRead() {
      return request("/notifications/read-all", { method: "PATCH" });
    },
    markNotifRead(notificationId) {
      return request(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH" });
    },
    refresh() {
      return hydratePage();
    },
    clearAll() {
      return Promise.resolve(true);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void hydratePage();
    });
  } else {
    void hydratePage();
  }

  const POLL_IDLE_MS = 15 * 60 * 1000;
  let lastInteractionAt = Date.now();

  if (!IS_PORTAL) {
    // Người mua: tự tải lại sản phẩm, đơn, quyên góp và thông báo mỗi 60 giây (polling thay cho realtime).
    // Không thao tác 15 phút thì bỏ qua các nhịp (thao tác lại là chạy tiếp ở nhịp sau).
    const markInteraction = () => { lastInteractionAt = Date.now(); };
    ["pointerdown", "keydown", "touchstart"].forEach((type) => document.addEventListener(type, markInteraction, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) markInteraction(); });
    setInterval(() => {
      if (document.hidden || window.MIO_DEMO_MODE) return;
      if (Date.now() - lastInteractionAt >= POLL_IDLE_MS) return;
      hydratePage().catch((error) => console.warn("[MIO] Không làm mới được dữ liệu:", error));
    }, 60000);
  }

  // ───── Lịch làm mới của cổng cửa hàng / tổ chức (giữ hạn mức 125k lượt gọi function/tháng của Netlify)
  // Mọi vòng lặp gọi API (đơn, quyên góp, thông báo, chat, ETA, sản phẩm) đăng ký ở đây và cùng tuân theo:
  //  - chỉ chạy khi tab đang hiển thị; hiện lại thì làm mới một lần (cách lần trước tối thiểu POLL_RESUME_GAP_MS);
  //  - không thao tác 15 phút thì dừng hẳn, hiện thông báo nhỏ; thao tác lại thì làm mới ngay.
  const POLL_HEARTBEAT_MS = 5000;
  const POLL_RESUME_GAP_MS = 10000;
  const POLL_NAV_GAP_MS = 30000;
  const pollTasks = [];

  function pollVisible() { return document.visibilityState === "visible"; }
  function pollIdle() { return Date.now() - lastInteractionAt >= POLL_IDLE_MS; }
  function pollCanRun() { return !window.MIO_DEMO_MODE && pollVisible() && !pollIdle(); }

  // Ghi nhận đã tải (ngoài lịch, vd lần tải đầu, sau thao tác) để nhịp kế tiếp không gọi trùng
  function markPolled(names) {
    const now = Date.now();
    pollTasks.forEach((task) => { if (names.indexOf(task.name) !== -1) task.last = now; });
  }

  // run() trả về false: không có gì cần tải lúc này (không tính là đã chạy)
  function runPollTask(task, resume, overrideMs) {
    if (task.running) return;
    const now = Date.now();
    if (now - task.last < (overrideMs || (resume ? task.minGap : task.ms))) return;
    let result;
    try { result = task.run(); } catch (error) { console.warn("[MIO] Không làm mới được dữ liệu:", error); return; }
    if (result === false) return;
    task.last = now;
    if (result && typeof result.then === "function") {
      task.running = true;
      result.catch((error) => console.warn("[MIO] Không làm mới được dữ liệu:", error)).then(() => { task.running = false; });
    }
  }

  function pollTick(resume) {
    paintPollPaused();
    if (!pollCanRun()) {
      // Rảnh nhưng tab vẫn hiện: chỉ các việc có idleMs (cửa hàng: đơn mới) chạy thưa, còn lại dừng hẳn
      if (IS_PORTAL && !resume && pollIdle() && pollVisible() && !window.MIO_DEMO_MODE && authToken()) {
        pollTasks.forEach((task) => { if (task.idleMs) runPollTask(task, false, task.idleMs); });
      }
      return;
    }
    pollTasks.forEach((task) => runPollTask(task, resume));
  }

  function registerPoll(name, ms, run, options) {
    const existing = pollTasks.find((task) => task.name === name);
    if (existing) { existing.ms = ms; existing.run = run; return existing; }
    const task = {
      name, ms, run,
      minGap: options && options.minGap ? options.minGap : POLL_RESUME_GAP_MS,
      idleMs: options && options.idleMs ? options.idleMs : 0,
      last: options && options.startNow ? 0 : Date.now(),
      running: false
    };
    pollTasks.push(task);
    return task;
  }

  function paintPollPaused() {
    if (!IS_PORTAL || !document.body) return;
    const show = pollIdle() && pollVisible() && !window.MIO_DEMO_MODE && Boolean(authToken());
    let box = document.querySelector("[data-poll-paused]");
    if (!show) { if (box) box.hidden = true; return; }
    if (!box) {
      box = document.createElement("button");
      box.type = "button";
      box.setAttribute("data-poll-paused", "");
      box.setAttribute("role", "status");
      box.textContent = "Đã tạm dừng cập nhật — chạm để tiếp tục";
      box.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:9000;max-width:calc(100vw - 32px);padding:8px 14px;border:1px solid #d7e5dc;border-radius:999px;background:#fff;color:#33523f;font:600 12.5px/1.4 inherit;box-shadow:0 4px 14px rgba(0,0,0,.08);cursor:pointer";
      document.body.appendChild(box);
    }
    box.hidden = false;
  }

  function pollTouch() {
    const wasIdle = pollIdle();
    lastInteractionAt = Date.now();
    if (wasIdle) {
      pollTasks.forEach((task) => { if (task.idleMs) task.last = 0; });   // lần đầu sau rảnh: tải + vẽ lại đơn ngay, bỏ qua minGap
      pollTick(true);
    }
  }

  // Tải lại vài phần khi cần (mở màn hình tương ứng, có thông báo mới); không gọi lại nếu vừa tải (< POLL_NAV_GAP_MS)
  function refreshParts(parts) {
    if (window.MIO_DEMO_MODE) return Promise.resolve(false);
    const now = Date.now();
    const due = (parts || []).filter((part) => AUTH_PARTS.indexOf(part) !== -1 && !(now - (partLoadedAt[part] || 0) < POLL_NAV_GAP_MS));
    if (!due.length) return Promise.resolve(false);
    due.forEach((part) => { partLoadedAt[part] = now; });
    return loadAuthenticatedData(due).then(() => { markPolled(due); renderAfterLoad(); return true; });
  }

  let partnerProductsAt = 0;
  function refreshPartnerProducts() {
    if (window.MIO_DEMO_MODE || typeof window.fetchProductsFromSupabase !== "function" || Date.now() - partnerProductsAt < POLL_NAV_GAP_MS) return false;
    partnerProductsAt = Date.now();
    return window.fetchProductsFromSupabase();
  }

  function refreshPortalNotifications() {
    return loadAuthenticatedData(["notifications"]);
  }

  // Cửa hàng có thông báo mới (quyên góp, khiếu nại, nhãn đổi màu) → tải lại phần liên quan; chỉ gọi thêm khi thực sự có chuyện mới
  function afterNewNotifications() {
    if (PAGE_ROLE !== "partner") return;
    refreshParts(["donations", "complaints"]).catch(() => {});
    refreshPartnerProducts();
  }

  if (IS_PORTAL) {
    ["pointerdown", "keydown", "touchstart"].forEach((type) => document.addEventListener(type, pollTouch, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", () => {
      if (!pollVisible()) return;
      lastInteractionAt = Date.now();   // quay lại tab = đang dùng
      pollTick(true);
    });
    setInterval(() => pollTick(false), POLL_HEARTBEAT_MS);

    // Dữ liệu thay đổi thường xuyên: cửa hàng cần đơn mới, tổ chức cần lô quyên góp; thông báo cho cả hai.
    // Cửa hàng còn chat 15 giây + ETA khi mở chi tiết đơn, nên thông báo/ETA giãn 120 giây để cả tab ≤ 6 lượt/phút.
    if (PAGE_ROLE === "partner") {
      // Cửa hàng rảnh (tab hiện) vẫn kiểm tra đơn mới 5 phút/lần để chủ quán biết có đơn
      registerPoll("orders", 60000, () => {
        ordersIdleCheck = !pollCanRun();
        return loadAuthenticatedData(["orders"]).then(() => { if (pollCanRun()) renderAfterLoad(); })
          .finally(() => { ordersIdleCheck = false; });
      }, { idleMs: 300000 });
      registerPoll("notifications", 120000, refreshPortalNotifications);
    } else {
      registerPoll("donations", 60000, () => loadAuthenticatedData(["donations"]).then(renderAfterLoad));
      registerPoll("notifications", 60000, refreshPortalNotifications);
    }

    // Màn hình ít thay đổi (khiếu nại, quyên góp phía cửa hàng, thống kê, sản phẩm): tải khi mở màn hình đó
    const NAV_PARTS = PAGE_ROLE === "partner"
      ? { complaints: ["complaints"], dona: ["donations"], ana: ["eco"], rank: ["eco"] }
      : { impact: ["eco"], reports: ["eco"] };
    if (typeof window.go === "function") {
      const originalGo = window.go;
      window.go = function (page) {
        const result = originalGo.apply(this, arguments);
        if (NAV_PARTS[page]) refreshParts(NAV_PARTS[page]).catch(() => {});
        if (PAGE_ROLE === "partner" && (page === "inv" || page === "marketing")) refreshPartnerProducts();
        return result;
      };
    }
  }

  window.FS.poll = {
    register: registerPoll,
    touch: markPolled,
    active: pollCanRun
  };
})();
