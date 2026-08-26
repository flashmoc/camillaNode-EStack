// Capture-side input metering + digital input trim for E-Stack Control.
// The meter always shows the raw ADC/capture level. INPUT_TRIM_L/R are neutral
// 0 dB Gain filters inserted before the first Mixer, so trim is applied before
// the E-Stack routing/crossover/output chain.

let estackInputDSP;
let estackInputMeterTimer;
const estackInputMeterParts = new Map();
const estackInputTrimControls = new Map();

const ESTACK_INPUT_TRIMS = [
    { index: 0, name: "INPUT_TRIM_L", label: "IN L" },
    { index: 1, name: "INPUT_TRIM_R", label: "IN R" }
];

const ESTACK_INPUT_LINK_KEY = "estack.control.link.input";
let estackInputLinked = true;
let estackLastRawPeaks = [];

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
    const mapped = ESTACK_INPUT_TRIMS.find(item => item.index === index);
    if (mapped) return mapped.label;
    return `IN ${index + 1}`;
}

function inputTrimName(index) {
    return ESTACK_INPUT_TRIMS.find(item => item.index === index)?.name || null;
}

function channelsForPipelineStep(step) {
    if (Array.isArray(step?.channels)) return step.channels.map(Number);
    if (step?.channel !== undefined && step?.channel !== null) return [Number(step.channel)];
    return [];
}

function meterPercent(db) {
    const level = Math.max(-60, Math.min(0, Number(db)));
    return ((level + 60) / 60) * 100;
}

function trimValue(index) {
    const name = inputTrimName(index);
    const value = Number(estackInputDSP?.config?.filters?.[name]?.parameters?.gain ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function jsonPointerEscape(value) {
    return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function loadInputLink() {
    const stored = window.localStorage.getItem(ESTACK_INPUT_LINK_KEY);
    estackInputLinked = stored === null ? true : stored === "true";
}

function saveInputLink() {
    window.localStorage.setItem(ESTACK_INPUT_LINK_KEY, String(estackInputLinked));
}

function setInputStatus(message, state = "info") {
    const status = document.getElementById("inputTrimStatus");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function renderInputLinkControl() {
    const button = document.getElementById("inputLinkToggle");
    if (!button) return;
    button.classList.toggle("active", estackInputLinked);
    button.setAttribute("aria-pressed", String(estackInputLinked));
    button.innerHTML = `<span>IN L/R</span><strong>${estackInputLinked ? "LINKED" : "FREE"}</strong>`;
    button.title = estackInputLinked
        ? "Input trims move together. Click to unlink."
        : "Input trims are independent. Click to link.";
}

async function ensureInputTrimStage() {
    const config = estackInputDSP.config;
    if (!config || !Array.isArray(config.pipeline)) throw new Error("DSP pipeline unavailable");
    if (!config.filters) config.filters = {};

    const firstMixerIndex = config.pipeline.findIndex(step => step?.type === "Mixer");
    if (firstMixerIndex < 0) throw new Error("No Mixer stage found; cannot place input trim safely");

    let changed = false;
    const stagesToInsert = [];

    for (const trim of ESTACK_INPUT_TRIMS) {
        const existingFilter = config.filters[trim.name];
        if (existingFilter && existingFilter.type !== "Gain") {
            throw new Error(`${trim.name} exists but is not a Gain filter`);
        }
        if (!existingFilter) {
            config.filters[trim.name] = {
                type: "Gain",
                description: `${trim.label} digital input trim`,
                parameters: { gain: 0.0 }
            };
            changed = true;
        } else {
            existingFilter.parameters = existingFilter.parameters || {};
            if (!Number.isFinite(Number(existingFilter.parameters.gain))) existingFilter.parameters.gain = 0.0;
        }

        const referencedBeforeMixer = config.pipeline
            .slice(0, firstMixerIndex)
            .some(step => step?.type === "Filter" &&
                channelsForPipelineStep(step).includes(trim.index) &&
                Array.isArray(step.names) && step.names.includes(trim.name));

        if (!referencedBeforeMixer) {
            // Remove an accidental reference elsewhere before creating the proper
            // pre-mixer stage. This never removes any other filter from a stage.
            for (const step of config.pipeline) {
                if (step?.type !== "Filter" || !Array.isArray(step.names)) continue;
                step.names = step.names.filter(name => name !== trim.name);
            }
            stagesToInsert.push({
                type: "Filter",
                channels: [trim.index],
                names: [trim.name],
                description: `${trim.label} digital input trim`,
                bypassed: false
            });
            changed = true;
        }
    }

    // Drop any empty Filter stage produced only by moving INPUT_TRIM_*.
    config.pipeline = config.pipeline.filter(step => step?.type !== "Filter" || (step.names || []).length > 0);

    if (stagesToInsert.length) {
        const mixerIndex = config.pipeline.findIndex(step => step?.type === "Mixer");
        config.pipeline.splice(mixerIndex, 0, ...stagesToInsert);
    }

    if (!changed) return false;

    setInputStatus("Initializing neutral input trims…", "info");
    const ok = await estackInputDSP.uploadConfig();
    if (!ok) throw new Error("CamillaDSP rejected input trim stage");
    await estackInputDSP.downloadConfig();
    setInputStatus("Input trim ready · 0 dB is neutral", "ok");
    return true;
}

async function setTrimValues(indexes, gain) {
    const value = Math.max(-24, Math.min(6, Number(gain)));
    const targets = [...new Set(indexes.map(Number))];

    try {
        for (const index of targets) {
            const name = inputTrimName(index);
            if (!name || !estackInputDSP.config?.filters?.[name]) continue;
            const pointer = `/filters/${jsonPointerEscape(name)}/parameters/gain`;
            await estackInputDSP.sendDSPMessage({ SetConfigValue: [pointer, value] });
            estackInputDSP.config.filters[name].parameters.gain = value;
        }
        const labels = targets.map(inputLabel).join(" + ");
        setInputStatus(`${labels} trim: ${value.toFixed(1)} dB`, value > 0 ? "warn" : "ok");
        return true;
    } catch (error) {
        console.error("Input trim update failed", error);
        setInputStatus(`Input trim failed: ${error?.message || error}`, "error");
        return false;
    }
}

function linkedInputIndexes(index) {
    if (!estackInputLinked || index > 1) return [index];
    return ESTACK_INPUT_TRIMS
        .map(item => item.index)
        .filter(candidate => candidate < configuredCaptureChannels());
}

function syncInputTrimPreview(index, value) {
    if (!estackInputLinked || index > 1) return;
    for (const linkedIndex of linkedInputIndexes(index)) {
        if (linkedIndex === index) continue;
        const control = estackInputTrimControls.get(linkedIndex);
        if (!control) continue;
        control.slider.value = value;
        updateTrimReadout(linkedIndex, value);
    }
}

function updateTrimReadout(index, gain = trimValue(index)) {
    const parts = estackInputTrimControls.get(index);
    if (!parts) return;
    const value = Number(gain);
    parts.trimValue.textContent = `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB`;
    parts.trimValue.dataset.positive = String(value > 0);

    const raw = Number(estackLastRawPeaks[index] ?? -60);
    const post = Math.min(0, raw + value);
    parts.postValue.textContent = `POST ≈ ${post.toFixed(1)} dBFS`;
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
        <div class="estack-input-trim-row">
            <span class="estack-input-trim-label">TRIM</span>
            <input class="estack-input-trim" type="range" min="-24" max="6" step="0.1" value="0" aria-label="${inputLabel(index)} digital input trim">
            <output class="estack-input-trim-value">+0.0 dB</output>
            <span class="estack-input-post-value">POST ≈ -60.0 dBFS</span>
        </div>`;

    const parts = {
        card,
        fill: card.querySelector(".estack-input-meter-fill"),
        peak: card.querySelector(".estack-input-meter-peak"),
        value: card.querySelector(".estack-input-value"),
        slider: card.querySelector(".estack-input-trim"),
        trimValue: card.querySelector(".estack-input-trim-value"),
        postValue: card.querySelector(".estack-input-post-value")
    };

    parts.slider.value = trimValue(index);
    parts.slider.addEventListener("input", () => {
        const value = Number(parts.slider.value);
        updateTrimReadout(index, value);
        syncInputTrimPreview(index, value);
    });
    parts.slider.addEventListener("change", async () => {
        const value = Number(parts.slider.value);
        const targets = linkedInputIndexes(index);
        for (const target of targets) {
            const control = estackInputTrimControls.get(target);
            if (control) control.slider.disabled = true;
        }
        await setTrimValues(targets, value);
        for (const target of targets) {
            const control = estackInputTrimControls.get(target);
            if (control) {
                control.slider.disabled = false;
                updateTrimReadout(target, value);
            }
        }
    });

    return parts;
}

function updateInputMeter(parts, index, db) {
    if (!parts) return;
    const level = Number.isFinite(Number(db)) ? Number(db) : -60;
    const pct = meterPercent(level);
    estackLastRawPeaks[index] = level;
    parts.fill.style.width = `${pct}%`;
    parts.peak.style.left = `${pct}%`;
    parts.value.textContent = `${level.toFixed(1)} dBFS`;
    parts.fill.dataset.zone = level > -3 ? "clip" : level > -10 ? "hot" : "normal";
    updateTrimReadout(index);
}

function renderInputMeters() {
    const root = document.getElementById("estackInputMeters");
    if (!root) return;
    root.replaceChildren();
    estackInputMeterParts.clear();
    estackInputTrimControls.clear();

    const count = configuredCaptureChannels();
    for (let index = 0; index < count; index++) {
        const parts = makeInputMeter(index);
        root.appendChild(parts.card);
        estackInputMeterParts.set(index, parts);
        estackInputTrimControls.set(index, parts);
        updateTrimReadout(index);
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
                updateInputMeter(parts, index, peaks[index] ?? -60);
            }
        } catch (_) {}
    }, 160);
}

async function initInputMeters() {
    estackInputDSP = await waitForInputDSP();
    await estackInputDSP.downloadConfig();
    loadInputLink();

    try {
        await ensureInputTrimStage();
    } catch (error) {
        console.error("Input trim initialization failed", error);
        setInputStatus(`Input trim unavailable: ${error?.message || error}`, "error");
    }

    renderInputLinkControl();
    const linkButton = document.getElementById("inputLinkToggle");
    if (linkButton) {
        linkButton.addEventListener("click", () => {
            estackInputLinked = !estackInputLinked;
            saveInputLink();
            renderInputLinkControl();
            setInputStatus(`IN L/R: ${estackInputLinked ? "linked" : "independent"}`, "ok");
        });
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
