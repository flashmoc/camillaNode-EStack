(() => {
  "use strict";
  const B = window.EStackDSPBridge;
  const $ = (id) => document.getElementById(id);
  function preferences() {
    let p = {};
    try {
      p = JSON.parse(
        localStorage.getItem("estack.product.presentation") || "{}",
      );
    } catch {}
    document.documentElement.dataset.density =
      p.density === "compact" ? "compact" : "comfortable";
    document.documentElement.dataset.contrast =
      p.contrast === "high" ? "high" : "standard";
  }
  preferences();
  addEventListener("storage", preferences);
  const note = (text, error = false) => {
    if ($("notice")) {
      $("notice").textContent = text;
      $("notice").dataset.error = error;
    }
  };
  const post = (path, data = {}) =>
    B.api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
  window.EStackSurface = { B, $, note, post, preferences };
})();
