// Global UI polish applied by the parent CamillaNode page to every iframe page.
// Keeps functional labels, values, warnings and runtime states, while removing
// repetitive explanatory micro-copy for a cleaner control-surface layout.

const ESTACK_DECLUTTER_CSS = `
.estack-input-head > div:first-child > span,
.estack-signal-flow-note,
.estack-control-head > div:first-child > span,
.estack-control-note,
.estack-strip-head > span,
.estack-input-card-head > div > span,
.estack-input-raw-note,
.global-eq-eyebrow,
.global-eq-head > div:first-child > span:last-child,
.global-eq-graph-head > div:first-child > span,
.global-eq-console-head > div:first-child > span,
.global-eq-statusbar > span:last-child,
.venu-eyebrow,
#selectedChannelMeta,
.venu-rta-label > span,
#moduleSubtitle,
.venu-control-left > p:not(.danger-note),
.smallInfo,
body > p {
    display: none !important;
}

/* Collapse the empty space left by the removed helper copy. */
.estack-input-head > div:first-child,
.estack-control-head > div:first-child,
.global-eq-head > div:first-child,
.global-eq-graph-head > div:first-child,
.global-eq-console-head > div:first-child,
.venu-page-identity,
.venu-module-title > div:first-child,
.venu-rta-label {
    gap: 0 !important;
}

.estack-strip-head,
.estack-input-card-head {
    min-height: 0 !important;
}
`;

function applyDeclutter(doc) {
    if (!doc?.head) return;
    if (!doc.getElementById("estackDeclutterStyles")) {
        const style = doc.createElement("style");
        style.id = "estackDeclutterStyles";
        style.textContent = ESTACK_DECLUTTER_CSS;
        doc.head.appendChild(style);
    }
}

function clampMasterControls(doc) {
    const master = doc?.getElementById("masterVolume");
    if (!master) return;

    // User-facing MASTER range is deliberately limited to -50..0 dB.
    master.min = "-50";
    master.max = "0";

    const numeric = master.closest(".estack-mixer-strip")?.querySelector(".estack-fader-number");
    if (numeric) {
        numeric.min = "-50";
        numeric.max = "0";
    }
}

function polishDocument(doc) {
    if (!doc) return;
    applyDeclutter(doc);
    clampMasterControls(doc);

    // Several E-Stack controls are rendered asynchronously after DSP connects.
    // Re-apply the tiny set of DOM-only rules when that happens.
    if (!doc.documentElement?.dataset.estackPolishObserved) {
        doc.documentElement.dataset.estackPolishObserved = "true";
        const observer = new MutationObserver(() => clampMasterControls(doc));
        observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    }
}

function attachEStackFramePolish() {
    const frame = document.getElementById("mainframe");
    if (!frame) return;

    const apply = () => {
        try { polishDocument(frame.contentDocument); }
        catch (error) { console.warn("E-Stack UI polish skipped", error); }
    };

    frame.addEventListener("load", apply);
    apply();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachEStackFramePolish);
} else {
    attachEStackFramePolish();
}
