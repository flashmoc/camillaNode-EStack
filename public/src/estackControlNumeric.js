// Direct numeric entry for every Control-page fader.
// The existing range input remains the source of truth; this layer mirrors it
// with an input[type=number] and dispatches the same input/change events.

function estackClampNumber(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

function estackSyncAllNumericFaders() {
    document.querySelectorAll(".estack-vertical-fader").forEach(fader => {
        const numeric = fader.closest(".estack-mixer-strip")?.querySelector(".estack-fader-number");
        if (!numeric || document.activeElement === numeric) return;
        numeric.value = Number(fader.value).toFixed(Number(fader.step) < 0.5 ? 1 : 1);
    });
}

function estackAttachNumericToFader(fader) {
    if (!fader || fader.dataset.numericAttached === "true") return;
    const strip = fader.closest(".estack-mixer-strip");
    const valueBox = strip?.querySelector(".estack-fader-value");
    if (!strip || !valueBox) return;

    fader.dataset.numericAttached = "true";

    const wrap = document.createElement("div");
    wrap.className = "estack-fader-number-wrap";

    const numeric = document.createElement("input");
    numeric.type = "number";
    numeric.className = "estack-fader-number";
    numeric.min = fader.min;
    numeric.max = fader.max;
    numeric.step = fader.step;
    numeric.value = Number(fader.value).toFixed(1);
    numeric.inputMode = "decimal";
    numeric.setAttribute("aria-label", `${strip.querySelector(".estack-strip-head strong")?.textContent || "Channel"} gain in dB`);

    const unit = document.createElement("span");
    unit.textContent = "dB";

    wrap.append(numeric, unit);
    valueBox.insertAdjacentElement("afterend", wrap);

    const syncFromFader = () => {
        if (document.activeElement !== numeric) numeric.value = Number(fader.value).toFixed(1);
        requestAnimationFrame(estackSyncAllNumericFaders);
    };

    fader.addEventListener("input", syncFromFader);
    fader.addEventListener("change", syncFromFader);

    const previewFromNumber = () => {
        const min = Number(fader.min);
        const max = Number(fader.max);
        const next = estackClampNumber(numeric.value, min, max);
        fader.value = next;
        fader.dispatchEvent(new Event("input", { bubbles: true }));
        requestAnimationFrame(estackSyncAllNumericFaders);
    };

    const commitFromNumber = () => {
        previewFromNumber();
        numeric.value = Number(fader.value).toFixed(1);
        fader.dispatchEvent(new Event("change", { bubbles: true }));
    };

    numeric.addEventListener("input", previewFromNumber);
    numeric.addEventListener("change", commitFromNumber);
    numeric.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            commitFromNumber();
            numeric.blur();
        }
    });
}

function estackAttachNumericFaders() {
    document.querySelectorAll(".estack-vertical-fader").forEach(estackAttachNumericToFader);
    estackSyncAllNumericFaders();
}

function initEstackControlNumeric() {
    estackAttachNumericFaders();

    const root = document.getElementById("estackMixerStrips") || document.body;
    const observer = new MutationObserver(() => estackAttachNumericFaders());
    observer.observe(root, { childList: true, subtree: true });

    // Linked MID/HIGH previews change the peer fader programmatically, so keep
    // the corresponding numeric field synchronized as well.
    document.addEventListener("input", event => {
        if (event.target?.classList?.contains("estack-vertical-fader")) {
            requestAnimationFrame(estackSyncAllNumericFaders);
        }
    });
}

document.addEventListener("DOMContentLoaded", initEstackControlNumeric);
