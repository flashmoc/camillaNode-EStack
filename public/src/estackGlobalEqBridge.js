// Narrow bridge for E-Stack Global EQ helper modules.
// globalEqDSP is a top-level lexical binding in estackGlobalEq.js, so it does
// not naturally exist as window.globalEqDSP. Expose a read-only getter only.

(() => {
    if (Object.getOwnPropertyDescriptor(window, "globalEqDSP")) return;
    Object.defineProperty(window, "globalEqDSP", {
        configurable: true,
        enumerable: false,
        get() {
            try { return globalEqDSP || null; }
            catch (_) { return null; }
        }
    });
})();
