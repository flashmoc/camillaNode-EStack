// Capture-side input metering for E-Stack Control.
// This page deliberately exposes NO synthetic input gain. CamillaDSP's capture
// meter is read-only here, matching the native model: if the ADC clips, a
// downstream digital Gain filter cannot repair it.

let estackInputDSP;
let estackInputMeterTimer;
const estackInputMeterParts = new Map();

const LEGACY_INPUT_TRIM_NAMES = new Set(["INPUT_TRIM_L", "INPUT_TRIM_R"]);

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

function setInputStatus(message, state = "info") {
    const status = document.getElementById("inputMeterStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

// Migration from the short-lived E-Stack INPUT_TRIM experiment. Only the two
// exact filters created by this UI are removed; every other filter and pipeline
// stage is preserved untouched.
async function cleanupLegacyInputTrims() {
    const config = estackInputDSP?.config;
    if (!config || !Array.isArray(config.pipeline)) return false;

    let changed = false;

    for (const step of config.pipeline) {
        if (step?.type !== "Filter" || !Array.isArray(step.names)) continue;
        const before = step.names.length;
        step.names = step.names.filter(name => !LEGACY_INPUT_TRIM_NAMES.has(String(name)));
        if (step.names.length !== before) changed = true;
    }

    const cleanedPipeline = config.pipeline.filter(step =>
        step?.type !== "Filter" || !Array.isArray(step.names) || step.names.length > 0
    );
    if (cleanedPipeline.length !== config.pipeline.length) changed = true;
    config.pipeline = cleanedPipeline;

    if (config.filters) {
        for (const name of LEGACY_INPUT_TRIM_NAMES) {
            if (Object.prototype.hasOwnProperty.call(config.filters, name)) {
                delete config.filters[name];
                changed = true;
            }
        }
    }

    if (!changed) return false;

    setInputStatus("Removing legacy digital input trims…", "info");
    const ok = await estackInputDSP.uploadConfig();
    if (!ok) throw new Error("CamillaDSP rejected legacy input-trim cleanup");
    await estackInputDSP.downloadConfig();
    setInputStatus("RAW capture metering · no input gain stage", "ok");
    return true;
}

function makeInputMeter(index) {
    const card = document.createElement("article");
    card.className = "estack-input-card";
    card.innerHTML = `
        <div class="estack-input-card-head">
            <div>
                <strong>${inputLabel(index)}</strong>
                <span>ADC / CAPTURE ${index + 1}</span>
            </div>
            <output class="estack-input-value">-60.0 dBFS</output>
        </div>
        <div class="estack-input-meter">
            <div class="estack-input-meter-fill"></div>
            <div class="estack-input-meter-peak"></div>
            <div class="estack-input-zero">0</div>
            <div class="estack-input-minus60">-60</div>
        </div>
        <div class="estack-input-raw-note">RAW ADC / CAPTURE · metering only</div>`;

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
    if (subtitle) subtitle.textContent = "DSP volume · 0 dB hard limit · meter = max OUT";
    const head = strip?.querySelector(".estack-strip-head strong");
    if (head) head.title = "Master is the global CamillaDSP volume control. E-Stack volume_limit is 0 dB, so 0 dB is the hard maximum. Its meter shows the hottest playback/output channel.";
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
    }, 120);
}

async function initInputMeters() {
    estackInputDSP = await waitForInputDSP();
    await estackInputDSP.downloadConfig();

    try {
        const cleaned = await cleanupLegacyInputTrims();
        if (!cleaned) setInputStatus("RAW capture metering · read only", "ok");
    } catch (error) {
        console.error("Legacy input-trim cleanup failed", error);
        setInputStatus(`Cleanup failed: ${error?.message || error}`, "error");
    }

    renderInputMeters();

    // estackBasic.js builds the mixer asynchronously after the same DOM load.
    setTimeout(clarifyMasterMeter, 180);
    setTimeout(clarifyMasterMeter, 600);

    startInputMeters();
}

window.addEventListener("beforeunload", () => {
    if (estackInputMeterTimer) clearInterval(estackInputMeterTimer);
});

document.addEventListener("DOMContentLoaded", initInputMeters);
