// E-Stack Loudness
// Uses CamillaDSP's native Loudness filter linked to the Main fader.
// The filter is placed on capture L/R immediately before the first mixer so it
// affects the complete routed system without touching output crossovers,
// protection, per-output EQ or limiter stages.

const ESTACK_LOUDNESS_FILTER = "ESTACK_LOUDNESS";
const ESTACK_LOUDNESS_STEP = "E-Stack loudness input stage";
const ESTACK_LOUDNESS_STORAGE = "estack.loudness.preset";

const ESTACK_LOUDNESS_PRESETS = {
    reference: { key: "reference", name: "REFERENCE", description: "Flat response for tuning and critical listening.", disabled: true, lowBoost: 0, highBoost: 0, referenceLevel: -10, color: "#9aa7aa" },
    home: { key: "home", name: "HOME", description: "Fuller low-volume balance; the Sonos-like starting point.", lowBoost: 6, highBoost: 2.5, referenceLevel: -10, color: "#59d5e3", recommended: true },
    punch: { key: "punch", name: "PUNCH", description: "Stronger low-end compensation for a more physical listen.", lowBoost: 8, highBoost: 2.5, referenceLevel: -8, color: "#ffd166" },
    night: { key: "night", name: "NIGHT", description: "Moderate compensation for quiet apartment listening.", lowBoost: 4, highBoost: 1.5, referenceLevel: -5, color: "#a78bfa" },
    outdoor: { key: "outdoor", name: "OUTDOOR", description: "Lighter bass lift with a little more upper-frequency support.", lowBoost: 3, highBoost: 2.5, referenceLevel: -10, color: "#7fd8b2" },
    maxspl: { key: "maxspl", name: "MAX SPL", description: "No loudness compensation; preserve maximum system margin.", disabled: true, lowBoost: 0, highBoost: 0, referenceLevel: 0, color: "#df7777" }
};

let loudnessDSP;
let loudnessActiveKey = "reference";
let loudnessMasterVolume = -20;
let loudnessTimer;
let loudnessResizeObserver;
let loudnessApplying = false;

function loudnessWaitForDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

function loudnessStatus(message, state = "info") {
    const el = document.getElementById("loudnessStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
}

function loudnessCaptureChannels() {
    const count = Math.max(1, Number(loudnessDSP?.config?.devices?.capture?.channels || 2));
    return Array.from({ length: Math.min(2, count) }, (_, index) => index);
}

function loudnessFirstMixerIndex() {
    return (loudnessDSP?.config?.pipeline || []).findIndex(step => step?.type === "Mixer");
}

function loudnessStep() {
    return (loudnessDSP?.config?.pipeline || []).find(step =>
        step?.type === "Filter" && (
            step?.description === ESTACK_LOUDNESS_STEP ||
            (step.names || []).includes(ESTACK_LOUDNESS_FILTER)
        )
    ) || null;
}

function loudnessEnsureStep() {
    const pipeline = loudnessDSP.config.pipeline || (loudnessDSP.config.pipeline = []);
    let step = loudnessStep();
    let mixerIndex = loudnessFirstMixerIndex();
    if (mixerIndex < 0) throw new Error("No Mixer stage found");

    if (!step) {
        step = {
            type: "Filter",
            channels: loudnessCaptureChannels(),
            names: [ESTACK_LOUDNESS_FILTER],
            description: ESTACK_LOUDNESS_STEP,
            bypassed: false
        };
        pipeline.splice(mixerIndex, 0, step);
        return step;
    }

    const currentIndex = pipeline.indexOf(step);
    if (currentIndex >= mixerIndex) {
        pipeline.splice(currentIndex, 1);
        mixerIndex = loudnessFirstMixerIndex();
        pipeline.splice(mixerIndex, 0, step);
    }

    step.channels = loudnessCaptureChannels();
    delete step.channel;
    step.names = [ESTACK_LOUDNESS_FILTER];
    step.description = ESTACK_LOUDNESS_STEP;
    step.bypassed = false;
    return step;
}

function loudnessRemoveStage() {
    if (!loudnessDSP?.config) return;
    const pipeline = loudnessDSP.config.pipeline || [];
    for (const step of pipeline) {
        if (step?.type !== "Filter" || !Array.isArray(step.names)) continue;
        step.names = step.names.filter(name => name !== ESTACK_LOUDNESS_FILTER);
    }
    loudnessDSP.config.pipeline = pipeline.filter(step =>
        !(step?.type === "Filter" && step?.description === ESTACK_LOUDNESS_STEP && (step.names || []).length === 0)
    );
    if (loudnessDSP.config.filters) delete loudnessDSP.config.filters[ESTACK_LOUDNESS_FILTER];
}

function loudnessPresetFromConfig() {
    const filter = loudnessDSP?.config?.filters?.[ESTACK_LOUDNESS_FILTER];
    const inPipeline = !!loudnessStep();
    if (!filter || filter.type !== "Loudness" || !inPipeline) {
        const stored = window.localStorage.getItem(ESTACK_LOUDNESS_STORAGE);
        return stored === "maxspl" ? "maxspl" : "reference";
    }

    const description = String(filter.description || "").toLowerCase();
    for (const preset of Object.values(ESTACK_LOUDNESS_PRESETS)) {
        if (!preset.disabled && description.includes(`· ${preset.name.toLowerCase()}`)) return preset.key;
    }

    const p = filter.parameters || {};
    for (const preset of Object.values(ESTACK_LOUDNESS_PRESETS)) {
        if (preset.disabled) continue;
        if (
            Math.abs(Number(p.reference_level) - preset.referenceLevel) < .05 &&
            Math.abs(Number(p.low_boost) - preset.lowBoost) < .05 &&
            Math.abs(Number(p.high_boost) - preset.highBoost) < .05
        ) return preset.key;
    }
    return "home";
}

function loudnessCompensationFactor(volume, preset) {
    if (!preset || preset.disabled) return 0;
    const ref = Number(preset.referenceLevel);
    const vol = Number(volume);
    if (!Number.isFinite(vol)) return 0;
    if (vol >= ref) return 0;
    if (vol <= ref - 20) return 1;
    return Math.max(0, Math.min(1, (ref - vol) / 20));
}

function loudnessCurrentValues() {
    const preset = ESTACK_LOUDNESS_PRESETS[loudnessActiveKey] || ESTACK_LOUDNESS_PRESETS.reference;
    const factor = loudnessCompensationFactor(loudnessMasterVolume, preset);
    return { preset, factor, low: preset.lowBoost * factor, high: preset.highBoost * factor };
}

function loudnessRenderHeader() {
    const { preset, low, high } = loudnessCurrentValues();
    const title = document.getElementById("loudnessPresetTitle");
    const sub = document.getElementById("loudnessPresetSub");
    const master = document.getElementById("loudnessMaster");
    const bass = document.getElementById("loudnessBass");
    const highEl = document.getElementById("loudnessHigh");
    if (title) title.textContent = preset.name;
    if (sub) sub.textContent = preset.disabled ? "Flat response" : `Full correction below ${preset.referenceLevel - 20} dB`;
    if (master) master.textContent = `${Number(loudnessMasterVolume).toFixed(1)} dB`;
    if (bass) bass.textContent = `+${low.toFixed(1)} dB`;
    if (highEl) highEl.textContent = `+${high.toFixed(1)} dB`;
}

function loudnessRenderPresetButtons() {
    const root = document.getElementById("loudnessPresets");
    if (!root) return;
    const fragment = document.createDocumentFragment();

    for (const preset of Object.values(ESTACK_LOUDNESS_PRESETS)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "loudness-preset";
        button.classList.toggle("active", preset.key === loudnessActiveKey);
        button.classList.toggle("recommended", !!preset.recommended);
        button.style.setProperty("--preset-color", preset.color);
        button.disabled = loudnessApplying;
        button.innerHTML = `
            <span class="loudness-preset-name">${preset.name}</span>
            <span class="loudness-preset-desc">${preset.description}</span>
            <span class="loudness-preset-meta">
                <span>LOW<strong>${preset.disabled ? "OFF" : `+${preset.lowBoost.toFixed(1)} dB`}</strong></span>
                <span>HIGH<strong>${preset.disabled ? "OFF" : `+${preset.highBoost.toFixed(1)} dB`}</strong></span>
            </span>`;
        button.addEventListener("click", () => loudnessApplyPreset(preset.key));
        fragment.appendChild(button);
    }
    root.replaceChildren(fragment);
}

function loudnessLogX(freq, left, width) {
    const min = Math.log10(20);
    const max = Math.log10(20000);
    return left + ((Math.log10(freq) - min) / (max - min)) * width;
}

function loudnessRelativeGain(freq, low, high) {
    const f = Math.max(1, Number(freq));
    const lowWeight = 1 / (1 + Math.pow(f / 70, 4));
    const highWeight = 1 / (1 + Math.pow(3500 / f, 4));
    return low * lowWeight + high * highWeight;
}

function loudnessDraw() {
    const canvas = document.getElementById("loudnessCanvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const style = getComputedStyle(document.documentElement);
    const grid = "rgba(230,238,240,.10)";
    const gridStrong = "rgba(230,238,240,.18)";
    const text = "rgba(226,234,236,.44)";
    const accent = style.getPropertyValue("--estack-accent").trim() || "#59d5e3";
    const preset = ESTACK_LOUDNESS_PRESETS[loudnessActiveKey] || ESTACK_LOUDNESS_PRESETS.reference;
    const current = loudnessCurrentValues();

    const left = 42, right = 14, top = 16, bottom = 28;
    const width = Math.max(1, rect.width - left - right);
    const height = Math.max(1, rect.height - top - bottom);
    const maxDb = 10;
    const yFor = db => top + height - (Math.max(0, Math.min(maxDb, db)) / maxDb) * height;

    ctx.lineWidth = 1;
    ctx.font = "8px Open Sans, Arial, sans-serif";
    ctx.textBaseline = "middle";

    for (const db of [0, 2, 4, 6, 8, 10]) {
        const y = yFor(db);
        ctx.strokeStyle = db === 0 ? gridStrong : grid;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + width, y); ctx.stroke();
        ctx.fillStyle = text; ctx.textAlign = "right"; ctx.fillText(db === 0 ? "0" : `+${db}`, left - 7, y);
    }

    for (const freq of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
        const x = loudnessLogX(freq, left, width);
        ctx.strokeStyle = grid;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.stroke();
        ctx.fillStyle = text; ctx.textAlign = "center";
        ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : String(freq), x, rect.height - 11);
    }

    const drawCurve = (low, high, stroke, alpha, dashed = false) => {
        ctx.save();
        ctx.strokeStyle = stroke; ctx.globalAlpha = alpha; ctx.lineWidth = dashed ? 1 : 2;
        ctx.setLineDash(dashed ? [4, 4] : []); ctx.beginPath();
        const points = Math.max(180, Math.round(width));
        for (let i = 0; i <= points; i++) {
            const t = i / points;
            const freq = 20 * Math.pow(1000, t);
            const x = left + t * width;
            const y = yFor(loudnessRelativeGain(freq, low, high));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.restore();
    };

    if (!preset.disabled) {
        drawCurve(preset.lowBoost, preset.highBoost, accent, .28, true);
        drawCurve(current.low, current.high, preset.color || accent, .95, false);
    } else drawCurve(0, 0, preset.color || accent, .82, false);

    ctx.fillStyle = text; ctx.textAlign = "left"; ctx.fillText("LOUDNESS BOOST · dB", left, 8);
}

function loudnessRender() {
    loudnessRenderHeader();
    loudnessRenderPresetButtons();
    loudnessDraw();
}

async function loudnessApplyPreset(key) {
    const preset = ESTACK_LOUDNESS_PRESETS[key];
    if (!preset || !loudnessDSP || loudnessApplying) return;
    loudnessApplying = true;
    loudnessStatus(`Applying ${preset.name}…`, "busy");
    loudnessRenderPresetButtons();

    try {
        await loudnessDSP.downloadConfig();
        const beforeConfig = loudnessDSP.estackConfigSnapshot?.() || JSON.parse(JSON.stringify(loudnessDSP.config));
        if (!loudnessDSP.config.filters) loudnessDSP.config.filters = {};

        if (preset.disabled) {
            loudnessRemoveStage();
        } else {
            loudnessDSP.config.filters[ESTACK_LOUDNESS_FILTER] = {
                type: "Loudness",
                description: `E-Stack loudness · ${preset.name}`,
                parameters: {
                    fader: "Main",
                    reference_level: preset.referenceLevel,
                    high_boost: preset.highBoost,
                    low_boost: preset.lowBoost,
                    attenuate_mid: false
                }
            };
            loudnessEnsureStep();
        }

        if (typeof loudnessDSP.uploadConfigGuarded !== "function") throw new Error("E-Stack config guard is unavailable");
        await loudnessDSP.uploadConfigGuarded(beforeConfig, {
            name: "Loudness",
            allowedFilterNames: [ESTACK_LOUDNESS_FILTER],
            allowedStepDescriptions: [ESTACK_LOUDNESS_STEP]
        });
        await loudnessDSP.downloadConfig();

        if (!preset.disabled) {
            const step = loudnessStep();
            const mixerIndex = loudnessFirstMixerIndex();
            if (!step || loudnessDSP.config.pipeline.indexOf(step) >= mixerIndex) throw new Error("Loudness stage is not before routing");
            const filter = loudnessDSP.config.filters?.[ESTACK_LOUDNESS_FILTER];
            if (filter?.type !== "Loudness" || filter?.parameters?.fader !== "Main" || filter?.parameters?.attenuate_mid !== false) {
                throw new Error("Loudness filter validation failed");
            }
        }

        loudnessActiveKey = key;
        window.localStorage.setItem(ESTACK_LOUDNESS_STORAGE, key);
        loudnessStatus(`${preset.name} · applied · guarded`, "ok");
    } catch (error) {
        console.error("Loudness preset failed", error);
        loudnessStatus(`${preset.name} · ERROR: ${error?.message || error}`, "error");
        try {
            await loudnessDSP.downloadConfig();
            loudnessActiveKey = loudnessPresetFromConfig();
        } catch (_) {}
    } finally {
        loudnessApplying = false;
        loudnessRender();
    }
}

async function loudnessRefreshMaster() {
    try {
        if (!loudnessDSP?.connected) return;
        const volume = Number(await loudnessDSP.sendDSPMessage("GetVolume"));
        if (!Number.isFinite(volume)) return;
        if (Math.abs(volume - loudnessMasterVolume) > .001) {
            loudnessMasterVolume = volume;
            loudnessRenderHeader();
            loudnessDraw();
        }
    } catch (_) {}
}

async function loudnessInit() {
    try {
        loudnessDSP = await loudnessWaitForDSP();
        await loudnessDSP.downloadConfig();
        loudnessActiveKey = loudnessPresetFromConfig();
        try {
            const volume = Number(await loudnessDSP.sendDSPMessage("GetVolume"));
            if (Number.isFinite(volume)) loudnessMasterVolume = volume;
        } catch (_) {}
        loudnessStatus("Connected · native CamillaDSP loudness · guarded boost mode", "ok");
        loudnessRender();
        loudnessTimer = setInterval(loudnessRefreshMaster, 700);

        const canvas = document.getElementById("loudnessCanvas");
        if (canvas && "ResizeObserver" in window) {
            loudnessResizeObserver = new ResizeObserver(() => loudnessDraw());
            loudnessResizeObserver.observe(canvas);
        } else window.addEventListener("resize", loudnessDraw);
    } catch (error) {
        console.error("Loudness init failed", error);
        loudnessStatus(`ERROR: ${error?.message || error}`, "error");
        loudnessRender();
    }
}

window.addEventListener("beforeunload", () => {
    if (loudnessTimer) clearInterval(loudnessTimer);
    loudnessResizeObserver?.disconnect?.();
});

document.addEventListener("DOMContentLoaded", loudnessInit);
