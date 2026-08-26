// Read-only capture-side input metering for E-Stack Control.
// Inputs are deliberately separate from the output gain mixer: they show what
// CamillaDSP receives before the E-Stack output processing chain.

let estackInputDSP;
let estackInputMeterTimer;
const estackInputMeterParts = new Map();

function waitForInputDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

function configuredCaptureChannels() {
    const configured = Number(estackInputDSP?.config?.devices?.capture?.channels ?? 2);
    return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 8) : 2;
}

function inputLabel(index) {
    if (index === 0) return "IN L";
    if (index === 1) return "IN R";
    return `IN ${index + 1}`;
}

function meterPercent(db) {
    const level = Math.max(-60, Math.min(0, Number(db)));
    return ((level + 60) / 60) * 100;
}

function makeInputMeter(index) {
    const card = document.createElement("article");
    card.className = "estack-input-card";
    card.innerHTML = `
        <div class="estack-input-card-head">
            <div>
                <strong>${inputLabel(index)}</strong>
                <span>CAPTURE ${index + 1}</span>
            </div>
            <output class="estack-input-value">-60.0 dBFS</output>
        </div>
        <div class="estack-input-meter">
            <div class="estack-input-meter-fill"></div>
            <div class="estack-input-meter-peak"></div>
            <div class="estack-input-zero">0</div>
            <div class="estack-input-minus60">-60</div>
        </div>`;

    return {
        card,
        fill: card.querySelector(".estack-input-meter-fill"),
        peak: card.querySelector(".estack-input-meter-peak"),
        value: card.querySelector(".estack-input-value")
    };
}

function updateInputMeter(parts, db) {
    if (!parts) return;
    const level = Number.isFinite(Number(db)) ? Number(db) : -60;
    const pct = meterPercent(level);
    parts.fill.style.width = `${pct}%`;
    parts.peak.style.left = `${pct}%`;
    parts.value.textContent = `${level.toFixed(1)} dBFS`;
    parts.fill.dataset.zone = level > -3 ? "clip" : level > -10 ? "hot" : "normal";
}

function renderInputMeters() {
    const root = document.getElementById("estackInputMeters");
    if (!root) return;
    root.replaceChildren();
    estackInputMeterParts.clear();

    const count = configuredCaptureChannels();
    for (let index = 0; index < count; index++) {
        const parts = makeInputMeter(index);
        root.appendChild(parts.card);
        estackInputMeterParts.set(index, parts);
    }
}

function clarifyMasterMeter() {
    const masterFader = document.getElementById("masterVolume");
    const strip = masterFader?.closest(".estack-mixer-strip");
    const subtitle = strip?.querySelector(".estack-strip-head span");
    if (subtitle) subtitle.textContent = "DSP volume · meter = max OUT";
    const head = strip?.querySelector(".estack-strip-head strong");
    if (head) head.title = "Master is the global CamillaDSP volume control. Its meter is the highest instantaneous playback/output peak, not a separate audio channel.";
}

async function startInputMeters() {
    if (estackInputMeterTimer) clearInterval(estackInputMeterTimer);
    estackInputMeterTimer = setInterval(async () => {
        try {
            if (!estackInputDSP?.connected) return;
            const peaks = await estackInputDSP.sendDSPMessage("GetCaptureSignalPeak");
            if (!Array.isArray(peaks)) return;
            for (const [index, parts] of estackInputMeterParts.entries()) {
                updateInputMeter(parts, peaks[index] ?? -60);
            }
        } catch (_) {}
    }, 160);
}

async function initInputMeters() {
    estackInputDSP = await waitForInputDSP();
    await estackInputDSP.downloadConfig();
    renderInputMeters();

    // estackBasic.js builds the mixer asynchronously after the same DOM load.
    // Give it a moment, then make the MASTER meter semantics explicit.
    setTimeout(clarifyMasterMeter, 180);
    setTimeout(clarifyMasterMeter, 600);

    startInputMeters();
}

window.addEventListener("beforeunload", () => {
    if (estackInputMeterTimer) clearInterval(estackInputMeterTimer);
});

document.addEventListener("DOMContentLoaded", initInputMeters);
