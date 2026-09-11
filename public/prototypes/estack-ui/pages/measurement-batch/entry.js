(async () => {
  const load = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  if (window.EStackDSPBridge.mode !== "camillanode")
    await load("../../shared/mock-camilladsp.js");
  await load("./page.js?v=live-batch1");
})();
