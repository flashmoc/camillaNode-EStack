// E-Stack Control fine-adjust layer.
// Keeps MASTER visually separate, defaults calibrated output gains to LOCKED,
// and adds precise +/-1 dB and +/-0.2 dB nudge buttons without changing fader geometry.

(() => {
    const NUDGES = [-1, -0.2, 0.2, 1];
    let bootLockApplied = false;
    let scanQueued = false;

    function clamp(value, min, max) {
        return Math.min(Number(max), Math.max(Number(min), Number(value)));
    }

    function formatDelta(delta) {
        return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(Math.abs(delta) === 1 ? 0 : 1)}`;
    }

    function commitFaderValue(fader, next) {
        const rounded = Math.round(clamp(next, fader.min, fader.max) * 10) / 10;
        fader.value = String(rounded);
        fader.dispatchEvent(new Event("input", { bubbles: true }));

        // MASTER safety runs in capture phase. If the requested value crosses
        // the protected -15 dB boundary it immediately restores the previous
        // accepted value and opens its code dialog. In that case do not emit a
        // premature change event; the safety layer commits after successful unlock.
        if (Math.abs(Number(fader.value) - rounded) < 0.0001) {
            fader.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }

    function ensureNudges(strip) {
        const fader = strip.querySelector(".estack-vertical-fader");
        if (!fader) return;

        if (strip.classList.contains("master")) {
            fader.step = "0.1";
            const numeric = strip.querySelector(".estack-fader-number");
            if (numeric) numeric.step = "0.1";
        }

        let row = strip.querySelector(".estack-fader-nudges");
        if (!row) {
            row = document.createElement("div");
            row.className = "estack-fader-nudges";
            row.setAttribute("aria-label", `${strip.classList.contains("master") ? "Master" : "Output"} gain fine adjustment`);

            for (const delta of NUDGES) {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.delta = String(delta);
                button.textContent = formatDelta(delta);
                button.title = `${delta > 0 ? "Increase" : "Decrease"} gain by ${Math.abs(delta)} dB`;
                button.addEventListener("click", () => {
                    if (button.disabled || fader.disabled) return;
                    commitFaderValue(fader, Number(fader.value) + delta);
                });
                row.appendChild(button);
            }

            const numberWrap = strip.querySelector(".estack-fader-number-wrap");
            const actions = strip.querySelector(".estack-strip-actions");
            if (numberWrap) numberWrap.insertAdjacentElement("afterend", row);
            else if (actions) actions.insertAdjacentElement("beforebegin", row);
            else strip.appendChild(row);
        }

        const locked = !strip.classList.contains("master") && strip.classList.contains("level-locked");
        row.querySelectorAll("button").forEach(button => {
            button.disabled = locked || strip.classList.contains("disabled");
        });
    }

    function ensureMixerBanks() {
        const root = document.getElementById("estackMixerStrips");
        if (!root) return;

        const master = root.querySelector(".estack-mixer-strip.master");
        const outputs = [...root.querySelectorAll(".estack-mixer-strip:not(.master)")];
        if (!master) return;

        let masterIsland = root.querySelector(":scope > .estack-master-island");
        if (!masterIsland) {
            masterIsland = document.createElement("div");
            masterIsland.className = "estack-master-island";
            root.insertBefore(masterIsland, root.firstChild);
        }
        if (master.parentElement !== masterIsland) masterIsland.appendChild(master);

        let outputBank = root.querySelector(":scope > .estack-output-bank");
        if (!outputBank) {
            outputBank = document.createElement("div");
            outputBank.className = "estack-output-bank";
            root.appendChild(outputBank);
        }
        for (const strip of outputs) {
            if (strip.parentElement !== outputBank) outputBank.appendChild(strip);
        }
    }

    function applyBootLock() {
        if (bootLockApplied || typeof window.estackSetOutputLevelsLocked !== "function") return;
        bootLockApplied = true;
        window.estackSetOutputLevelsLocked(true);
    }

    function scan() {
        applyBootLock();
        ensureMixerBanks();
        document.querySelectorAll(".estack-mixer-strip").forEach(ensureNudges);
    }

    function scheduleScan() {
        if (scanQueued) return;
        scanQueued = true;
        requestAnimationFrame(() => {
            scanQueued = false;
            scan();
        });
    }

    const observer = new MutationObserver(scheduleScan);

    function start() {
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "disabled"]
        });
        scheduleScan();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
