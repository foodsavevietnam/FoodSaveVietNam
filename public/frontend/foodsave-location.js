(function () {
  "use strict";

  // Client vị trí dùng chung: hộp xin quyền một lần, theo dõi vị trí chỉ khi đang làm nhiệm vụ.
  var POLICY_VERSION = "2026-11-22";
  var STORAGE_KEY = "mio.location.consent.v1";
  var timing = {
    SEND_INTERVAL_MS: 120000,
    SEND_DISTANCE_M: 300,
    MIN_SEND_MS: 60000
  };

  var apiBase = "";
  var getAuthHeader = function () { return null; };
  var getActorKey = null;     // () => khóa tài khoản đang đăng nhập (vd "customer:<id>") hoặc null
  var serverSync = true;      // false: trang chỉ cần quyền trình duyệt (cửa hàng/tổ chức), không gửi consent lên máy chủ
  var promptText = null;      // nội dung hộp hỏi riêng của trang (mặc định: nội dung về nhiệm vụ)
  var permissionState = null;  // null: chưa hỏi xong trình duyệt (init sẽ tự hỏi khi biết)
  var latest = null;          // { lat, lng, accuracy_m, at }
  var task = null;            // { kind, id }
  var watchId = null;
  var timerId = null;
  var lastSent = null;        // { lat, lng, t }
  var sending = false;
  var syncing = null;         // promise gửi lựa chọn đang chạy (tránh gửi trùng)
  var memoryChoice = null;    // dùng khi localStorage bị chặn
  var readyPromise = Promise.resolve();

  // ---------- localStorage (luôn bọc try/catch) ----------
  // Lựa chọn lưu kèm chủ của nó: { choice, version, at, actor, pending }.
  // actor = null: chọn lúc chưa đăng nhập. Bản lưu cũ không có trường actor bị bỏ qua (không biết của ai).
  function readChoice() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.choice === "string" && Object.prototype.hasOwnProperty.call(parsed, "actor")) return parsed;
        return null;
      }
    } catch (error) { /* bỏ qua: trình duyệt chặn lưu trữ */ }
    return memoryChoice;
  }

  function writeChoice(choice, actor, pending) {
    memoryChoice = { choice: choice, version: POLICY_VERSION, at: Date.now(), actor: actor || null, pending: Boolean(pending) };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryChoice));
    } catch (error) { /* bỏ qua */ }
    return memoryChoice;
  }

  // Đánh dấu đã gửi xong, chỉ khi bản lưu vẫn là đúng lựa chọn vừa gửi (người dùng chưa đổi ý trong lúc chờ)
  function markSynced(entry) {
    var saved = readChoice();
    if (!saved || saved.at !== entry.at || saved.actor !== entry.actor || saved.choice !== entry.choice) return;
    memoryChoice = { choice: saved.choice, version: saved.version, at: saved.at, actor: saved.actor, pending: false };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryChoice)); } catch (error) { /* bỏ qua */ }
  }

  function jwtSubject(header) {
    try {
      var part = String(header || "").replace(/^Bearer\s+/i, "").split(".")[1];
      if (!part) return null;
      var json = JSON.parse(window.atob(part.replace(/-/g, "+").replace(/_/g, "/")));
      return json && json.sub ? "sub:" + json.sub : null;
    } catch (error) { return null; }
  }

  // Tài khoản đang đăng nhập trên trang (null = chưa đăng nhập).
  function currentActor() {
    if (typeof getActorKey === "function") {
      try {
        var key = getActorKey();
        return key ? String(key) : null;
      } catch (error) { return null; }
    }
    return jwtSubject(authHeader());
  }

  // Lựa chọn thuộc về tài khoản hiện tại. Lựa chọn lúc chưa đăng nhập thuộc về tài khoản đầu tiên đăng nhập sau đó;
  // lựa chọn của tài khoản khác KHÔNG BAO GIỜ được dùng hay gửi cho tài khoản này.
  function ownChoice() {
    var saved = readChoice();
    if (!saved) return null;
    var actor = currentActor();
    if (saved.actor === actor) return saved;
    if (saved.actor === null && actor) {
      var adopted = writeChoice(saved.choice, actor, saved.choice === "granted" || saved.choice === "denied");
      return adopted;
    }
    return null;
  }

  function consentState() {
    var own = ownChoice();
    if (own && own.choice === "granted") return "granted";
    if (own && own.choice === "denied") return "denied";
    return "unknown";
  }

  // ---------- API ----------
  function authHeader() {
    try { return getAuthHeader() || null; } catch (error) { return null; }
  }

  function request(method, path, body) {
    var headers = { "Content-Type": "application/json" };
    var auth = authHeader();
    if (auth) headers.Authorization = auth;
    var options = { method: method, headers: headers, credentials: "same-origin" };
    if (body !== undefined) options.body = JSON.stringify(body);
    return fetch(apiBase + path, options);
  }

  function postConsent(granted) {
    if (!authHeader()) return Promise.resolve(false);
    return request("POST", "/location/consent", { granted: granted, policy_version: POLICY_VERSION })
      .then(function (response) { return response.ok; })
      .catch(function () { return false; });
  }

  function errorCode(response) {
    try {
      return response.clone().json()
        .then(function (payload) { return payload && payload.error ? payload.error.code : null; })
        .catch(function () { return null; });
    } catch (error) { return Promise.resolve(null); }
  }

  // Gửi lựa chọn của tài khoản hiện tại lên máy chủ. Rút lại thì xóa luôn vị trí (DELETE /location).
  // Thành công → bỏ cờ chờ; lỗi (mất mạng, máy chủ lỗi) → giữ cờ chờ để gửi lại khi có mạng / lần mở trang sau.
  function pushChoice(entry) {
    var granted = entry.choice === "granted";
    var jobs = [postConsent(granted)];
    if (!granted) {
      jobs.push(request("DELETE", "/location").then(function (response) { return response.ok; }, function () { return false; }));
    }
    return Promise.all(jobs).then(function (results) {
      if (results.indexOf(false) !== -1) throw new Error("Chưa gửi được lựa chọn chia sẻ vị trí lên máy chủ.");
      markSynced(entry);
    });
  }

  // Gửi lựa chọn đang chờ của chính tài khoản đang đăng nhập (sau khi đăng nhập, có mạng lại, mở trang).
  // Tài khoản này chưa chọn thì hỏi lại, không gửi lựa chọn của người khác.
  function syncConsent() {
    if (!serverSync) return Promise.resolve();
    var actor = currentActor();
    if (!actor || !authHeader()) return Promise.resolve();
    var own = ownChoice();
    if (!own) { promptIfNeeded(); return Promise.resolve(); }
    if (!own.pending || (own.choice !== "granted" && own.choice !== "denied")) return Promise.resolve();
    if (syncing) return syncing;
    syncing = pushChoice(own).catch(function () { /* giữ cờ chờ, thử lại sau */ })
      .then(function () { syncing = null; });
    return syncing;
  }

  // Trả về promise: bị từ chối khi chưa gửi được lên máy chủ (lựa chọn vẫn lưu ở máy và được gửi lại sau).
  function setConsent(granted) {
    var actor = currentActor();
    var entry = writeChoice(granted ? "granted" : "denied", actor, serverSync);
    hidePrompt();
    if (!granted) stopWatching();
    if (granted) requestOnce();   // để trình duyệt hiện hộp quyền thật
    if (!serverSync || !actor || !authHeader()) return Promise.resolve();   // chưa đăng nhập: gửi khi đăng nhập
    // Cho phép mà mạng lỗi: vẫn theo dõi theo lựa chọn ở máy; maybeSend gửi consent đang chờ trước khi gửi vị trí
    return pushChoice(entry).then(function () {
      if (granted && task) beginWatching();
    }, function (error) {
      if (granted && task) beginWatching();
      throw error;
    });
  }

  // ---------- Vị trí ----------
  function distanceMeters(a, b) {
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function hasGeolocation() {
    return typeof navigator !== "undefined" && navigator.geolocation;
  }

  function remember(position) {
    var c = position && position.coords;
    if (!c || !isFinite(c.latitude) || !isFinite(c.longitude)) return null;
    latest = {
      lat: c.latitude,
      lng: c.longitude,
      accuracy_m: isFinite(c.accuracy) ? c.accuracy : 0,
      at: position.timestamp || Date.now()
    };
    return latest;
  }

  var GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 };

  function requestOnce() {
    if (!hasGeolocation()) return;
    try {
      navigator.geolocation.getCurrentPosition(remember, function () {}, GEO_OPTIONS);
    } catch (error) { /* bỏ qua */ }
  }

  function shouldSend(now) {
    if (!lastSent) return true;
    var elapsed = now - lastSent.t;
    if (elapsed < timing.MIN_SEND_MS) return false;
    if (elapsed >= timing.SEND_INTERVAL_MS) return true;
    return distanceMeters(lastSent, latest) >= timing.SEND_DISTANCE_M;
  }

  function maybeSend() {
    if (!task || !latest || sending || consentState() !== "granted") return;
    var now = Date.now();
    if (!shouldSend(now)) return;
    sending = true;
    lastSent = { lat: latest.lat, lng: latest.lng, t: now };
    var payload = {
      lat: latest.lat,
      lng: latest.lng,
      context: { kind: task.kind, id: task.id }
    };
    if (latest.accuracy_m > 0) payload.accuracy_m = Math.round(latest.accuracy_m);
    payload.recorded_at = new Date(latest.at).toISOString();
    var stamp = task;
    var askAgain = false;
    var revoked = false;
    function post() { return request("POST", "/location", payload); }
    syncConsent()
      .then(post)
      .then(function (response) {
        if (response.status !== 403) return response;
        return errorCode(response).then(function (code) {
          if (code === "LOCATION_CONSENT_REVOKED") {
            // Tài khoản này đã TẮT chia sẻ (có thể trên máy khác): theo lựa chọn đó, không tự bật lại, không hỏi.
            // Máy chủ đã xóa vị trí nên lưu "denied" ở trạng thái đã đồng bộ (không gửi consent/DELETE nữa).
            revoked = true;
            writeChoice("denied", currentActor(), false);
            hidePrompt();
            return response;
          }
          if (code !== "LOCATION_CONSENT_REQUIRED") return response;   // 403 khác (vai trò/phiên): không đụng tới consent
          // Máy chủ chưa có consent: chỉ gửi lại khi lựa chọn "Cho phép" là của CHÍNH tài khoản đang đăng nhập
          var own = ownChoice();
          if (!own || own.choice !== "granted") { askAgain = true; return response; }
          return postConsent(true).then(function (ok) {
            return ok ? post() : response;
          });
        });
      })
      .then(function (response) {
        if (askAgain) promptIfNeeded();
        if (revoked) { stopTask(false); return; }                     // đã tắt: dừng mọi theo dõi, kể cả nhiệm vụ mới
        if (stamp !== task) return;                                   // nhiệm vụ đã đổi/dừng trong lúc gửi
        if (response.status === 409) stopTask(false);                 // hết nhiệm vụ: server đã xóa dòng
        else if (response.status === 403) stopTask(false);
      })
      .catch(function () { /* mạng lỗi: thử lại ở nhịp sau */ })
      .then(function () { sending = false; });
  }

  function beginWatching() {
    if (watchId !== null || !task || !hasGeolocation() || consentState() !== "granted") return;
    try {
      watchId = navigator.geolocation.watchPosition(function (position) {
        if (remember(position)) maybeSend();
      }, function () { /* không có quyền/hết thời gian: luồng chính vẫn chạy */ }, GEO_OPTIONS);
    } catch (error) {
      watchId = null;
      return;
    }
    timerId = window.setInterval(maybeSend, Math.min(timing.SEND_INTERVAL_MS, 30000));
  }

  function stopWatching() {
    if (watchId !== null) {
      try { navigator.geolocation.clearWatch(watchId); } catch (error) { /* bỏ qua */ }
      watchId = null;
    }
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function startTask(context) {
    if (!context || (context.kind !== "donation" && context.kind !== "order") || !context.id) return;
    if (task && task.kind === context.kind && task.id === context.id && watchId !== null) return;
    if (!task || task.kind !== context.kind || task.id !== String(context.id)) lastSent = null;
    task = { kind: context.kind, id: String(context.id) };
    beginWatching();
  }

  function stopTask(callServer) {
    var wasActive = Boolean(task);
    task = null;
    lastSent = null;
    stopWatching();
    if (callServer !== false && wasActive && authHeader()) {
      request("DELETE", "/location").catch(function () { /* bỏ qua */ });
    }
  }

  // Đăng xuất: dừng theo dõi và LUÔN xóa vị trí trên máy chủ khi còn token (kể cả chưa kịp bắt đầu theo dõi).
  // Gọi TRƯỚC khi xóa token. Đặt lại trạng thái đồng bộ để tài khoản kế tiếp không thừa hưởng.
  function clearServer() {
    task = null;
    lastSent = null;
    stopWatching();
    if (!serverSync || !authHeader()) return Promise.resolve(false);
    return request("DELETE", "/location").then(function (response) { return response.ok; }, function () { return false; });
  }

  // Trả về null khi điểm đến không hợp lệ (thiếu hoặc không phải số hữu hạn).
  function directionsUrl(destination) {
    if (!destination || !isFinite(destination.lat) || !isFinite(destination.lng) ||
        destination.lat === null || destination.lng === null) return null;
    var url = "https://www.google.com/maps/dir/?api=1&destination=" + destination.lat + "," + destination.lng;
    if (latest) url += "&origin=" + latest.lat + "," + latest.lng;
    return url + "&travelmode=driving";
  }

  // ---------- Hộp xin quyền ----------
  function hidePrompt() {
    var box = document.querySelector("[data-location-prompt]");
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showPrompt() {
    if (!document.body || document.querySelector("[data-location-prompt]")) return;
    var box = document.createElement("div");
    box.className = "fs-location-prompt";
    box.setAttribute("data-location-prompt", "");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", promptText ? "Cho phép dùng vị trí" : "Chia sẻ vị trí khi làm nhiệm vụ");
    var copy = promptText
      ? '  <p>' + escapeHtml(promptText) + ' '
      : '  <p>MIO dùng vị trí khi bạn đang làm nhiệm vụ (lấy/giao hàng, đi nhận đơn) để chỉ đường tối ưu. ' +
        '  Vị trí chỉ chia sẻ trong lúc làm nhiệm vụ và được xóa khi xong. ';
    box.innerHTML = [
      '<div class="fs-location-copy">',
      '  <div class="fs-location-kicker">Vị trí của bạn</div>',
      copy,
      '  <a href="/chinh-sach.html#privacy-9">Xem chính sách</a></p>',
      '</div>',
      '<div class="fs-location-actions">',
      '  <button type="button" class="fs-location-btn secondary" data-location-later>Để sau</button>',
      '  <button type="button" class="fs-location-btn primary" data-location-allow>Cho phép</button>',
      '</div>'
    ].join("");
    box.querySelector("[data-location-allow]").addEventListener("click", function () {
      setConsent(true).catch(function () { /* đã lưu ở máy, gửi lại khi có mạng */ });
    });
    box.querySelector("[data-location-later]").addEventListener("click", function () {
      writeChoice("later", currentActor(), false);
      hidePrompt();
    });
    document.body.appendChild(box);
  }

  // Hỏi khi tài khoản hiện tại chưa chọn. Chưa đăng nhập: chỉ hỏi khi máy chưa có lựa chọn nào
  // (không hỏi lại ngay sau khi người trước vừa đăng xuất). Trình duyệt đã chặn quyền thì không hỏi.
  function promptIfNeeded() {
    if (permissionState === null || permissionState === "denied") return;
    var need = currentActor() ? !ownChoice() : !readChoice();
    if (!need) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showPrompt, { once: true });
    } else {
      showPrompt();
    }
  }

  function browserPermission() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        return navigator.permissions.query({ name: "geolocation" })
          .then(function (status) { return status.state; })
          .catch(function () { return "prompt"; });
      }
    } catch (error) { /* bỏ qua */ }
    return Promise.resolve("prompt");
  }

  function init(options) {
    options = options || {};
    apiBase = String(options.apiBase || "").replace(/\/+$/, "");
    if (typeof options.getAuthHeader === "function") getAuthHeader = options.getAuthHeader;
    if (typeof options.getActorKey === "function") getActorKey = options.getActorKey;
    serverSync = options.serverSync !== false;
    promptText = typeof options.promptText === "string" && options.promptText.trim() ? options.promptText.trim() : null;
    syncConsent();
    readyPromise = browserPermission().then(function (state) {
      permissionState = state;   // đã granted vẫn hỏi: server cần bản ghi consent
      promptIfNeeded();
    });
    if (consentState() === "granted") requestOnce();
  }

  window.addEventListener("pagehide", function () { stopWatching(); });
  // Có mạng lại / vừa đăng nhập (foodsave-auth-client.js phát sự kiện này): gửi lựa chọn đang chờ của tài khoản hiện tại
  window.addEventListener("online", function () { syncConsent(); });
  window.addEventListener("foodsave:session-saved", function () { window.setTimeout(syncConsent, 0); });

  window.FoodSaveLocation = {
    init: init,
    consentState: consentState,
    setConsent: setConsent,
    syncConsent: syncConsent,
    startTask: startTask,
    stopTask: function () { stopTask(true); },
    clearServer: clearServer,
    current: function () { return latest; },
    directionsUrl: directionsUrl,
    get _ready() { return readyPromise; },
    _isTracking: function () { return watchId !== null; },
    _setTimingForTest: function (overrides) {
      Object.keys(overrides || {}).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(timing, key)) timing[key] = overrides[key];
      });
    }
  };
})();
