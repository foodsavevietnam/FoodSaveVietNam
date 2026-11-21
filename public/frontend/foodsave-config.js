/* Cấu hình công khai dùng chung; nạp trước các script nghiệp vụ. */
(function (window, document) {
  "use strict";

  if (typeof window.FOODSAVE_API_BASE === "string" && window.FOODSAVE_API_BASE.trim()) return;

  var meta = document.querySelector('meta[name="foodsave-api-base"]');
  var configured = meta && meta.getAttribute("content");
  if (configured && configured.trim()) {
    window.FOODSAVE_API_BASE = configured.trim();
    return;
  }

  var location = window.location;
  window.FOODSAVE_API_BASE = /^https?:$/.test(location.protocol)
    ? location.origin + "/api/v1"
    : "http://localhost:8080/api/v1";
})(window, document);
