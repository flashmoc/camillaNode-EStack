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

function zeroSnapThreshold(input) {
    const min = Number(input?.min);
    const max = Number(input?.max);
    const step = Math.abs(Number(input?.step)) || 0.1;
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < 0 && max >= 0)) return 0;

    const span = Math.abs(max - min);
    const isLevelControl = input.classList?.contains("estack-vertical-fader") ||
        input.classList?.contains("global-eq-gain") ||
        /gain|volume|level/i.test(String(input.id || input.name || ""));

    // A 0.3 dB zone was technically present but almost impossible to feel with
    // a mouse. Level controls now have a clearly perceptible detent (~0.8 dB),
    // while other bipolar ranges remain a little tighter.
    const cap = isLevelControl ? 0.8 : 0.6;
    return Math.max(step * 2, Math.min(cap, span * 0.02));
}

function snapRangeToZero(input) {
    if (!input || input.type !== "range") return false;
    const threshold = zeroSnapThreshold(input);
    if (!threshold) return false;
    const value = Number(input.value);
    if (!Number.isFinite(value) || Math.abs(value) > threshold || value === 0) return false;
    input.value = "0";
    input.dataset.estackAtDetent = "true";
    return true;
}

function decorateZeroSnapControls(doc) {
    if (!doc?.querySelectorAll) return;
    doc.querySelectorAll('input[type="range"]').forEach(input => {
        const min = Number(input.min);
        const max = Number(input.max);
        if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < 0 && max >= 0)) {
            delete input.dataset.estackZeroSnap;
            delete input.dataset.estackAtDetent;
            return;
        }
        input.dataset.estackZeroSnap = "true";
        const position = ((max - 0) / (max - min)) * 100;
        input.style.setProperty("--estack-zero-pos", `${Math.max(0, Math.min(100, position))}%`);
        input.title = input.title || "0 dB detent · double-click returns to 0";
    });
}

function installRangeInteraction(doc) {
    if (!doc?.documentElement || doc.documentElement.dataset.estackRangeInteractionInstalled === "true") return;
    doc.documentElement.dataset.estackRangeInteractionInstalled = "true";

    const commitTimers = new WeakMap();

    const RangeCtor = doc.defaultView?.HTMLInputElement;
    const isRange = input => !!RangeCtor && input instanceof RangeCtor && input.type === "range";

    const emit = (input, type) => {
        input.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true }));
    };

    const maybeSnap = event => {
        const input = event.target;
        if (!isRange(input)) return;
        if (!snapRangeToZero(input)) delete input.dataset.estackAtDetent;
    };

    // Capture phase means page-specific input listeners receive the snapped value.
    doc.addEventListener("input", maybeSnap, true);
    doc.addEventListener("change", maybeSnap, true);

    // Clicking the control explicitly gives it keyboard focus, even for custom
    // CSS overlays/vertical writing modes.
    doc.addEventListener("pointerdown", event => {
        const input = event.target;
        if (!isRange(input) || input.disabled) return;
        try { input.focus({ preventScroll: true }); }
        catch (_) { input.focus(); }
    }, true);

    // Deterministic arrows across browsers and vertical sliders:
    // UP/RIGHT = increase, DOWN/LEFT = decrease. A short debounce emits the
    // commit/change event so holding an arrow remains smooth without flooding DSP.
    doc.addEventListener("keydown", event => {
        const input = event.target;
        if (!isRange(input) || input.disabled) return;
        if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) return;

        event.preventDefault();
        const min = Number(input.min);
        const max = Number(input.max);
        const stepRaw = Number(input.step);
        const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
        const direction = (event.key === "ArrowUp" || event.key === "ArrowRight") ? 1 : -1;
        const current = Number(input.value);
        const next = Math.max(min, Math.min(max, current + direction * step));

        input.value = String(next);
        snapRangeToZero(input);
        emit(input, "input");

        clearTimeout(commitTimers.get(input));
        commitTimers.set(input, setTimeout(() => {
            emit(input, "change");
            commitTimers.delete(input);
        }, 130));
    }, true);

    // Double-click any bipolar range to return to exact unity/zero.
    doc.addEventListener("dblclick", event => {
        const input = event.target;
        if (!isRange(input) || !zeroSnapThreshold(input)) return;
        input.value = "0";
        input.dataset.estackAtDetent = "true";
        emit(input, "input");
        emit(input, "change");
    }, true);
}

function polishDocument(doc) {
    if (!doc) return;
    applyDeclutter(doc);
    clampMasterControls(doc);
    decorateZeroSnapControls(doc);
    installRangeInteraction(doc);

    // Several E-Stack controls are rendered asynchronously after DSP connects.
    // Re-apply the DOM-only rules when that happens.
    if (!doc.documentElement?.dataset.estackPolishObserved) {
        doc.documentElement.dataset.estackPolishObserved = "true";
        const observer = new MutationObserver(() => {
            clampMasterControls(doc);
            decorateZeroSnapControls(doc);
        });
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
