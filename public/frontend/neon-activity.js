/* Public MIO community activity feed, backed by Neon Postgres and Realtime. */
(function (window, document) {
  "use strict";

  var REALTIME_CLIENT_MODULE = "/frontend/neon-realtime-client.mjs";
  var MAX_ITEMS = 50;

  function apiBase() {
    var configured = typeof window.FOODSAVE_API_BASE === "string" ? window.FOODSAVE_API_BASE.trim() : "";
    return (configured || window.location.origin + "/api/v1").replace(/\/+$/u, "");
  }

  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(function (item) {
      if (!item || typeof item.id !== "string" || typeof item.title !== "string") return false;
      var createdAt = item.created_at instanceof Date ? item.created_at.getTime() : Date.parse(item.created_at);
      return Number.isFinite(createdAt);
    }).slice(0, MAX_ITEMS).map(function (item) {
      var createdAt = item.created_at instanceof Date ? item.created_at : new Date(item.created_at);
      return { id: item.id, title: item.title.slice(0, 200), created_at: createdAt.toISOString() };
    });
  }

  function render(feed, items) {
    var list = feed.querySelector("[data-mio-activity-list]");
    if (!list) return;
    var rows = normalizeItems(items).map(function (item) {
      var row = document.createElement("li");
      row.className = "mio-activity-item";

      var title = document.createElement("span");
      title.className = "mio-activity-title";
      title.textContent = item.title;

      var created = document.createElement("time");
      created.className = "mio-activity-time";
      created.dateTime = item.created_at;
      created.textContent = new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(item.created_at));

      row.append(title, created);
      return row;
    });

    if (!rows.length) {
      var empty = document.createElement("li");
      empty.className = "mio-activity-empty";
      empty.textContent = "Chưa có hoạt động mới. Hãy quay lại sau nhé.";
      rows.push(empty);
    }
    list.replaceChildren.apply(list, rows);
  }

  function setStatus(feed, status) {
    var statusElement = feed.querySelector("[data-mio-activity-status]");
    if (statusElement) statusElement.textContent = status;
  }

  function safeRealtimeUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return null;
    try {
      var url = new URL(value);
      if (url.protocol !== "wss:" || !(url.hostname === "neon.tech" || url.hostname.endsWith(".neon.tech"))
        || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  async function getJson(fetchImpl, path, options) {
    var response = await fetchImpl(path, options);
    if (!response || !response.ok) throw new Error("Activity endpoint unavailable");
    var body = await response.json();
    if (!body || body.success !== true || !body.data) throw new Error("Activity response invalid");
    return body.data;
  }

  function expirationMilliseconds(sealedQuery) {
    if (!sealedQuery || typeof sealedQuery.expiresAt !== "number" || !Number.isFinite(sealedQuery.expiresAt)) return null;
    return sealedQuery.expiresAt < 1000000000000 ? sealedQuery.expiresAt * 1000 : sealedQuery.expiresAt;
  }

  async function initialize(feed, dependencies) {
    var fetchImpl = dependencies && dependencies.fetchImpl || window.fetch.bind(window);
    var importSdk = dependencies && dependencies.importSdk || function () { return import(REALTIME_CLIENT_MODULE); };
    var api = apiBase();
    var closed = false;
    var liveClient = null;
    var subscription = null;
    var renewalTimer = null;
    var retryTimer = null;
    var retryDelay = 1000;
    var connecting = false;
    var generation = 0;
    var hasLoadedRows = false;
    var rows = [];
    var sealedQuery = null;

    function stop() {
      closed = true;
      generation += 1;
      window.clearTimeout(renewalTimer);
      window.clearTimeout(retryTimer);
      window.removeEventListener("online", recoverOnline);
      if (subscription && typeof subscription.unsubscribe === "function") subscription.unsubscribe();
      if (liveClient && typeof liveClient.close === "function") liveClient.close();
    }

    function showUnavailable() {
      setStatus(feed, hasLoadedRows
        ? "Cập nhật trực tiếp tạm ngưng; danh sách gần đây vẫn hiển thị. Đang thử kết nối lại…"
        : "Chưa tải được hoạt động cộng đồng. Đang thử kết nối lại…");
    }

    function scheduleRecovery() {
      if (closed || retryTimer !== null) return;
      retryTimer = window.setTimeout(async function () {
        retryTimer = null;
        await startLive();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }

    async function recoverOnline() {
      if (closed) return;
      window.clearTimeout(retryTimer);
      retryTimer = null;
      retryDelay = 1000;
      await startLive();
    }

    async function requestSealedQuery() {
      var data = await getJson(fetchImpl, api + "/activity/live", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        body: "{}",
      });
      var url = safeRealtimeUrl(data.url);
      if (!url || !data.sealedQuery || typeof data.sealedQuery !== "object") {
        throw new Error("Realtime query invalid");
      }
      return { url: url, sealedQuery: data.sealedQuery };
    }

    function scheduleRenewal(sealed) {
      window.clearTimeout(renewalTimer);
      var expiry = expirationMilliseconds(sealed);
      if (expiry === null || closed) return;
      var delay = Math.max(0, expiry - Date.now() - 10000);
      renewalTimer = window.setTimeout(async function renew() {
        try {
          var fresh = await requestSealedQuery();
          if (closed) return;
          if (fresh.url !== liveUrl) {
            await connect(fresh);
            return;
          }
          await subscription.renew(fresh.sealedQuery);
          sealedQuery = fresh.sealedQuery;
          scheduleRenewal(sealedQuery);
        } catch {
          showUnavailable();
          scheduleRecovery();
        }
      }, delay);
    }

    var liveUrl = "";
    async function connect(sealed) {
      if (closed) return;
      generation += 1;
      var activeGeneration = generation;
      window.clearTimeout(renewalTimer);
      if (subscription && typeof subscription.unsubscribe === "function") subscription.unsubscribe();
      if (liveClient && typeof liveClient.close === "function") liveClient.close();

      var sdk = await importSdk();
      if (closed || activeGeneration !== generation) return;
      if (!sdk || typeof sdk.createRealtimeClient !== "function") throw new Error("Realtime client unavailable");
      liveUrl = sealed.url;
      sealedQuery = sealed.sealedQuery;
      liveClient = sdk.createRealtimeClient({ url: liveUrl });
      subscription = liveClient.subscribe(sealedQuery);
      subscription.onChange(function (snapshot) {
        if (closed || activeGeneration !== generation || !snapshot || !Array.isArray(snapshot.data)) return;
        rows = normalizeItems(snapshot.data);
        hasLoadedRows = true;
        render(feed, rows);
      });
      if (typeof subscription.onStateChange === "function") {
        subscription.onStateChange(function (state) {
          if (!state || closed || activeGeneration !== generation) return;
          if (state.status === "live") {
            retryDelay = 1000;
            window.clearTimeout(retryTimer);
            retryTimer = null;
            setStatus(feed, "Đang cập nhật trực tiếp.");
          }
          else if (state.status === "connecting") setStatus(feed, "Đang kết nối cập nhật trực tiếp…");
          else if (state.status === "stale") setStatus(feed, "Đang khôi phục cập nhật; danh sách gần đây vẫn hiển thị.");
          else if (state.status === "error" || state.status === "closed") {
            showUnavailable();
            scheduleRecovery();
          }
        });
      }
      scheduleRenewal(sealedQuery);
    }

    async function startLive() {
      if (closed || connecting) return;
      connecting = true;
      try {
        var sealed = await requestSealedQuery();
        await connect(sealed);
      } catch {
        if (!closed) {
          showUnavailable();
          scheduleRecovery();
        }
      } finally {
        connecting = false;
      }
    }

    setStatus(feed, "Đang tải hoạt động gần đây…");
    try {
      var initial = await getJson(fetchImpl, api + "/activity", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
      });
      rows = normalizeItems(initial.items);
      hasLoadedRows = true;
      render(feed, rows);
      setStatus(feed, "Hoạt động cộng đồng gần đây.");
    } catch {
      render(feed, []);
      setStatus(feed, "Chưa tải được hoạt động cộng đồng. Vui lòng thử lại sau.");
    }

    await startLive();

    window.addEventListener("online", recoverOnline);
    window.addEventListener("beforeunload", stop, { once: true });
    return { stop: stop, getItems: function () { return rows.slice(); } };
  }

  window.MIOActivity = Object.freeze({ initialize: initialize, render: render, normalizeItems: normalizeItems });

  function start() {
    var feed = document.querySelector("[data-mio-activity]");
    if (!feed) return;
    void initialize(feed);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(window, document);
