// E-Stack Control safety layer.
// Keeps per-output calibration gains fixed on demand and requires a session
// unlock before increasing MASTER above the configured safety threshold.

(() => {
    const OUTPUT_LOCK_KEY = "estack.control.outputLevelsLocked";
    const MASTER_PIN_KEY = "estack.control.masterSafetyPin";
    const MASTER_THRESHOLD_DB = -15;
    const DEFAULT_MASTER_PIN = "1234";

    let outputLevelsLocked = window.localStorage.getItem(OUTPUT_LOCK_KEY) === "true";
    let masterUnlockedForSession = false;
    let masterUnlockPromise = null;
    let pendingMasterTarget = null;
    let scanScheduled = false;

    function getMasterPin() {
        return window.localStorage.getItem(MASTER_PIN_KEY) || DEFAULT_MASTER_PIN;
    }

    function syncMasterVisual(fader, value) {
        if (typeof window.estackSyncControlFaderVisual === "function") {
            window.estackSyncControlFaderVisual(fader);
        }
        const numeric = fader.closest(".estack-mixer-strip")?.querySelector(".estack-fader-number");
        if (numeric) numeric.value = Number(value).toFixed(1);
    }

    function ensureMasterDialog() {
        let dialog = document.getElementById("estackMasterSafetyDialog");
        if (dialog) return dialog;

        dialog = document.createElement("dialog");
        dialog.id = "estackMasterSafetyDialog";
        dialog.className = "estack-master-safety-dialog";
        dialog.innerHTML = `
            <div class="estack-master-safety-head">
                <strong>MASTER SAFETY</strong>
                <span>Above ${MASTER_THRESHOLD_DB} dB</span>
            </div>
            <p>Enter the safety code to raise MASTER above ${MASTER_THRESHOLD_DB} dB. The unlock lasts only for this Control session.</p>
            <label class="estack-master-pin-label">
                <span>SAFETY CODE</span>
                <input id="estackMasterSafetyPin" type="password" inputmode="numeric" autocomplete="off" maxlength="32">
            </label>
            <div id="estackMasterSafetyStatus" class="estack-master-safety-status"></div>
            <div class="estack-master-safety-actions">
                <button type="button" data-action="cancel">CANCEL</button>
                <button type="button" data-action="unlock" class="primary">UNLOCK</button>
            </div>`;
        document.body.appendChild(dialog);
        return dialog;
    }

    function requestMasterUnlock() {
        if (masterUnlockedForSession) return Promise.resolve(true);
        if (masterUnlockPromise) return masterUnlockPromise;

        const dialog = ensureMasterDialog();
        const pin = dialog.querySelector("#estackMasterSafetyPin");
        const status = dialog.querySelector("#estackMasterSafetyStatus");
        const unlock = dialog.querySelector('[data-action="unlock"]');
        const cancel = dialog.querySelector('[data-action="cancel"]');

        pin.value = "";
        status.textContent = `MASTER is locked above ${MASTER_THRESHOLD_DB} dB`;
        status.dataset.state = "info";

        masterUnlockPromise = new Promise(resolve => {
            let finished = false;

            const finish = allowed => {
                if (finished) return;
                finished = true;
                unlock.onclick = null;
                cancel.onclick = null;
                pin.onkeydown = null;
                dialog.oncancel = null;
                if (dialog.open) dialog.close();
                masterUnlockPromise = null;
                resolve(allowed);
            };

            const tryUnlock = () => {
                if (pin.value === getMasterPin()) {
                    masterUnlockedForSession = true;
                    status.textContent = "MASTER unlocked for this session";
                    status.dataset.state = "ok";
                    finish(true);
                    return;
                }
                status.textContent = "Incorrect safety code";
                status.dataset.state = "error";
                pin.select();
            };

            unlock.onclick = tryUnlock;
            cancel.onclick = () => finish(false);
            pin.onkeydown = event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                tryUnlock();
            };
            dialog.oncancel = event => {
                event.preventDefault();
                finish(false);
            };
        });

        if (!dialog.open) dialog.showModal();
        requestAnimationFrame(() => pin.focus());
        return masterUnlockPromise;
    }

    function attachMasterSafety() {
        const fader = document.getElementById("masterVolume");
        if (!fader || fader.dataset.estackMasterSafety === "true") return;
        fader.dataset.estackMasterSafety = "true";

        let lastAccepted = Number(fader.value);
        if (!Number.isFinite(lastAccepted)) lastAccepted = MASTER_THRESHOLD_DB;

        // Capture phase runs before the existing Control preview listener.
        fader.addEventListener("input", () => {
            const wanted = Number(fader.value);
            if (!Number.isFinite(wanted)) return;

            // Moving downward is always allowed. Only an upward move in the
            // protected region asks for the code.
            if (masterUnlockedForSession || wanted <= MASTER_THRESHOLD_DB || wanted <= lastAccepted) {
                lastAccepted = wanted;
                return;
            }

            pendingMasterTarget = wanted;
            fader.value = String(lastAccepted);
            syncMasterVisual(fader, lastAccepted);

            requestMasterUnlock().then(allowed => {
                if (!allowed || pendingMasterTarget === null) return;
                const target = pendingMasterTarget;
                pendingMasterTarget = null;
                lastAccepted = target;
                fader.value = String(target);
                syncMasterVisual(fader, target);
                fader.dispatchEvent(new Event("input", { bubbles: true }));
                fader.dispatchEvent(new Event("change", { bubbles: true }));
            });
        }, true);
    }

    function renderOutputLockButton() {
        const root = document.getElementById("linkControls");
        if (!root) return;

        let button = root.querySelector(".estack-level-lock-button");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "estack-link-button estack-level-lock-button";
            button.addEventListener("click", () => {
                outputLevelsLocked = !outputLevelsLocked;
                window.localStorage.setItem(OUTPUT_LOCK_KEY, String(outputLevelsLocked));
                applyOutputLevelLock();
            });
            root.appendChild(button);
        }

        button.classList.toggle("active", outputLevelsLocked);
        button.setAttribute("aria-pressed", String(outputLevelsLocked));
        button.innerHTML = `<span>OUTPUT LEVELS</span><strong>${outputLevelsLocked ? "LOCKED" : "FREE"}</strong>`;
        button.title = outputLevelsLocked
            ? "Output calibration gains are locked. MASTER remains adjustable."
            : "Output calibration gains are editable.";
    }

    function applyOutputLevelLock() {
        document.querySelectorAll(".estack-mixer-strip:not(.master)").forEach(strip => {
            const unavailable = strip.classList.contains("disabled");
            strip.classList.toggle("level-locked", outputLevelsLocked);

            const fader = strip.querySelector(".estack-vertical-fader");
            if (fader) fader.disabled = unavailable || outputLevelsLocked;

            const numeric = strip.querySelector(".estack-fader-number");
            if (numeric) numeric.disabled = unavailable || outputLevelsLocked;
        });
        renderOutputLockButton();
    }

    function scanControl() {
        attachMasterSafety();
        applyOutputLevelLock();
    }

    function scheduleScan() {
        if (scanScheduled) return;
        scanScheduled = true;
        requestAnimationFrame(() => {
            scanScheduled = false;
            scanControl();
        });
    }

    window.estackOutputLevelsLocked = () => outputLevelsLocked;
    window.estackSetOutputLevelsLocked = locked => {
        outputLevelsLocked = !!locked;
        window.localStorage.setItem(OUTPUT_LOCK_KEY, String(outputLevelsLocked));
        applyOutputLevelLock();
        return outputLevelsLocked;
    };
    window.estackSetMasterSafetyPin = pin => {
        const value = String(pin ?? "").trim();
        if (value.length < 4 || value.length > 32) {
            throw new Error("Safety code must contain 4 to 32 characters");
        }
        window.localStorage.setItem(MASTER_PIN_KEY, value);
        masterUnlockedForSession = false;
        return true;
    };
    window.estackLockMasterSafety = () => {
        masterUnlockedForSession = false;
    };

    const observer = new MutationObserver(scheduleScan);

    const start = () => {
        observer.observe(document.body, { childList: true, subtree: true });
        scheduleScan();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
