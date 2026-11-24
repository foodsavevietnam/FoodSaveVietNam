/* Cấu hình công khai dùng chung; nạp trước các script nghiệp vụ. */
(function (window, document) {
  "use strict";

  var DEFAULT_SUPABASE_URL = "https://idhpydhlgnxjjtyrgfkj.supabase.co";
  var DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_kBjao9fkPwim7sJKZfWf_Q_JGRZuUOf";

  function readMeta(name) {
    if (!document || typeof document.querySelector !== "function") return "";
    var meta = document.querySelector('meta[name="' + name + '"]');
    var content = meta && typeof meta.getAttribute === "function" ? meta.getAttribute("content") : "";
    return typeof content === "string" ? content.trim() : "";
  }

  if (!(typeof window.FOODSAVE_API_BASE === "string" && window.FOODSAVE_API_BASE.trim())) {
    var configured = readMeta("foodsave-api-base");
    if (configured) {
      window.FOODSAVE_API_BASE = configured;
    } else {
      var location = window.location;
      window.FOODSAVE_API_BASE = /^https?:$/.test(location.protocol)
        ? location.origin + "/api/v1"
        : "http://localhost:8080/api/v1";
    }
  }

  if (!(typeof window.FOODSAVE_SUPABASE_URL === "string" && window.FOODSAVE_SUPABASE_URL.trim())) {
    window.FOODSAVE_SUPABASE_URL = readMeta("foodsave-supabase-url") || DEFAULT_SUPABASE_URL;
  }

  if (!(typeof window.FOODSAVE_SUPABASE_ANON_KEY === "string" && window.FOODSAVE_SUPABASE_ANON_KEY.trim())) {
    window.FOODSAVE_SUPABASE_ANON_KEY = readMeta("foodsave-supabase-anon-key") || DEFAULT_SUPABASE_ANON_KEY;
  }
})(window, document);
