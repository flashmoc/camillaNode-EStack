// E-Stack Loudness
// CamillaDSP remains the audio engine. A separate Raspberry service tracks the
// external WiiM volume and drives Aux1 with SetFaderExternalVolume. CamillaNode
// only displays bridge telemetry and changes persistent curve/preset settings.

const ESTACK_LOUDNESS_FILTER = "ESTACK_LOUDNESS";
const ESTACK_LOUDNESS_STEP = "E-Stack loudness input stage";
const ESTACK_LOUDNESS_STORAGE = "estack.loudness.preset";
const ESTACK_LOUDNESS_FADER = "Aux1";
const ESTACK_NATIVE_REFERENCE_DB = -10;

const ESTACK_LOUDNESS_PRESETS = {
    reference: { key: "reference", name: "REFERENCE", description: "Flat response for tuning and critical listening.", disabled: true, lowBoost: 0, highBoost: 0, color: "#9aa7aa" },
    home: { key: "home", name: "HOME", description: "Fuller low-volume balance; the Sonos-like starting point.", lowBoost: 6, highBoost: 2.5, color: "#59d5e3", recommended: true },
    punch: { key: "punch", name: "PUNCH", description: "Stronger low-end compensation for a more physical listen.", lowBoost: 8, highBoost: 2.5, color: "#ffd166" },
    night: { key: "night", name: "NIGHT", description: "Moderate compensation for quiet apartment listening.", lowBoost: 4, highBoost: 1.5, color: "#a78bfa" },
    outdoor: { key: "outdoor", name: "OUTDOOR", description: "Lighter bass lift with a little more upper-frequency support.", lowBoost: 3, highBoost: 2.5, color: "#7fd8b2" },
    maxspl: { key: "maxspl", name: "MAX SPL", description: "No loudness compensation; preserve maximum system margin.", disabled: true, lowBoost: 0, highBoost: 0, color: "#df7777" }
};

let loudnessDSP;
let loudnessActiveKey = "reference";
let loudnessTimer;
let loudnessDspTimer;
let loudnessResizeObserver;
let loudnessApplying = false;
let loudnessCurveSaving = false;
let loudnessCurve = { startDb: -10, fullDb: -30, power: 1 };
let loudnessBridge = {
    serviceAlive: false,
    connected: false,
    wiimConnected: false,
    camillaConnected: false,
    wiimVolume: null,
    realAttenuationDb: null,
    compensationFactor: 0,
    aux1Db: null,
    reason: "Waiting for loudness bridge"
};

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
            Math.abs(Number(p.low_boost) - preset.lowBoost) < .05 &&
            Math.abs(Number(p.high_boost) - preset.highBoost) < .05
        ) return preset.key;
    }
    return "home";
}

function loudnessCurrentValues() {
    const preset = ESTACK_LOUDNESS_PRESETS[loudnessActiveKey] || ESTACK_LOUDNESS_PRESETS.reference;
    const factor = preset.disabled ? 0 : Math.max(0, Math.min(1, Number(loudnessBridge.compensationFactor) || 0));
    return { preset, factor, low: preset.lowBoost * factor, high: preset.highBoost * factor };
}

function formatDb(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(digits)} dB` : "— dB";
}

function loudnessFilterLinked() {
    const preset = ESTACK_LOUDNESS_PRESETS[loudnessActiveKey] || ESTACK_LOUDNESS_PRESETS.reference;
    if (preset.disabled) return true;
    const filter = loudnessDSP?.config?.filters?.[ESTACK_LOUDNESS_FILTER];
    return filter?.type === "Loudness" && filter?.parameters?.fader === ESTACK_LOUDNESS_FADER;
}

function loudnessRenderBridge() {
    const badge = document.getElementById("loudnessBridgeBadge");
    const text = document.getElementById("loudnessBridgeText");
    if (!badge || !text) return;

    const linked = loudnessFilterLinked();
    const connected = !!loudnessBridge.serviceAlive && !!loudnessBridge.wiimConnected && !!loudnessBridge.camillaConnected && linked;
    badge.dataset.state = connected ? "ok" : "error";

    if (connected) {
        text.textContent = "LOUDNESS LINK CONNECTED";
        badge.title = "WiiM bridge and CamillaDSP Aux1 are connected";
    } else if (!linked) {
        text.textContent = "LOUDNESS LINK MISCONFIGURED";
        badge.title = "Re-apply the active Loudness preset to link it to Aux1";
    } else {
        text.textContent = "LOUDNESS CONNECTION LOST";
        badge.title = loudnessBridge.reason || "WiiM loudness bridge unavailable";
    }
}

function loudnessRenderHeader() {
    const { preset, low, high } = loudnessCurrentValues();
    const title = document.getElementById("loudnessPresetTitle");
    const sub = document.getElementById("loudnessPresetSub");
    const wiim = document.getElementById("loudnessWiim");
    const level = document.getElementById("loudnessLevel");
    const bass = document.getElementById("loudnessBass");
    const highEl = document.getElementById("loudnessHigh");

    if (title) title.textContent = preset.name;
    if (sub) {
        sub.textContent = preset.disabled
            ? "Flat response"
            : `WiiM ${loudnessCurve.startDb.toFixed(1)} → ${loudnessCurve.fullDb.toFixed(1)} dB · shape ${loudnessCurve.power.toFixed(2)}`;
    }
    if (wiim) wiim.textContent = Number.isFinite(Number(loudnessBridge.wiimVolume)) ? `${Number(loudnessBridge.wiimVolume).toFixed(0)} %` : "— %";
    if (level) level.textContent = formatDb(loudnessBridge.realAttenuationDb, 2);
    if (bass) bass.textContent = `+${low.toFixed(1)} dB`;
    if (highEl) highEl.textContent = `+${high.toFixed(1)} dB`;
    loudnessRenderBridge();
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

function loudnessRenderCurveControls() {
    const start = document.getElementById("loudnessStartDb");
    const full = document.getElementById("loudnessFullDb");
    const power = document.getElementById("loudnessCurvePower");
    if (start && document.activeElement !== start) start.value = Number(loudnessCurve.startDb).toFixed(1);
    if (full && document.activeElement !== full) full.value = Number(loudnessCurve.fullDb).toFixed(1);
    if (power && document.activeElement !== power) power.value = Number(loudnessCurve.power).toFixed(2);
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
        ctx.strokeStyle = stroke;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = dashed ? 1 : 2;
        ctx.setLineDash(dashed ? [4, 4] : []);
        ctx.beginPath();
        const points = Math.max(180, Math.round(width));
        for (let i = 0; i <= points; i++) {
            const t = i / points;
            const freq = 20 * Math.pow(1000, t);
            const x = left + t * width;
            const y = yFor(loudnessRelativeGain(freq, low, high));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    };

    if (!preset.disabled) {
        drawCurve(preset.lowBoost, preset.highBoost, accent, .28, true);
        drawCurve(current.low, current.high, preset.color || accent, .95, false);
    } else {
        drawCurve(0, 0, preset.color || accent, .82, false);
    }

    ctx.fillStyle = text;
    ctx.textAlign = "left";
    ctx.fillText("LOUDNESS BOOST · dB", left, 8);
}

function loudnessRender() {
    loudnessRenderHeader();
    loudnessRenderPresetButtons();
    loudnessRenderCurveControls();
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
                    fader: ESTACK_LOUDNESS_FADER,
                    reference_level: ESTACK_NATIVE_REFERENCE_DB,
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
            const filter = loudnessDSP.config.filters?.[ESTACK_LOUDNESS_FILTER];
            if (!step || loudnessDSP.config.pipeline.indexOf(step) >= mixerIndex) throw new Error("Loudness stage is not before routing");
            if (
                filter?.type !== "Loudness" ||
                filter?.parameters?.fader !== ESTACK_LOUDNESS_FADER ||
                filter?.parameters?.attenuate_mid !== false
            ) throw new Error("Loudness Aux1 validation failed");
        }

        loudnessActiveKey = key;
        window.localStorage.setItem(ESTACK_LOUDNESS_STORAGE, key);
        loudnessStatus(`${preset.name} · applied to CamillaDSP · Aux1 linked`, "ok");
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

async function loudnessLoadCurveSettings() {
    const response = await fetch('/api/loudness/settings', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Curve settings HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.status !== 'ok' || !payload.curve) throw new Error(payload.reason || 'Invalid curve settings');
    loudnessCurve = {
        startDb: Number(payload.curve.startDb),
        fullDb: Number(payload.curve.fullDb),
        power: Number(payload.curve.power)
    };
    loudnessRenderCurveControls();
}

async function loudnessSaveCurve() {
    if (loudnessCurveSaving) return;
    const start = Number(document.getElementById("loudnessStartDb")?.value);
    const full = Number(document.getElementById("loudnessFullDb")?.value);
    const power = Number(document.getElementById("loudnessCurvePower")?.value);
    const button = document.getElementById("loudnessCurveSave");

    if (!Number.isFinite(start) || !Number.isFinite(full) || !Number.isFinite(power)) {
        loudnessStatus("Curve · invalid numeric value", "error");
        return;
    }

    loudnessCurveSaving = true;
    if (button) button.disabled = true;
    loudnessStatus("Saving WiiM loudness curve…", "busy");
    try {
        const response = await fetch('/api/loudness/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ curve: { startDb: start, fullDb: full, power } })
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'ok') throw new Error(payload.reason || `HTTP ${response.status}`);
        loudnessCurve = {
            startDb: Number(payload.curve.startDb),
            fullDb: Number(payload.curve.fullDb),
            power: Number(payload.curve.power)
        };
        loudnessStatus("Curve saved · bridge reloads without DSP restart", "ok");
        loudnessRender();
        setTimeout(loudnessRefreshBridge, 250);
    } catch (error) {
        loudnessStatus(`Curve · ERROR: ${error?.message || error}`, "error");
    } finally {
        loudnessCurveSaving = false;
        if (button) button.disabled = false;
    }
}

async function loudnessRefreshBridge() {
    try {
        const response = await fetch('/api/loudness/bridge', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        loudnessBridge = { ...loudnessBridge, ...payload };
    } catch (error) {
        loudnessBridge = {
            ...loudnessBridge,
            serviceAlive: false,
            connected: false,
            wiimConnected: false,
            camillaConnected: false,
            compensationFactor: 0,
            reason: `CamillaNode bridge API unavailable: ${error.message}`
        };
    }
    loudnessRenderHeader();
    loudnessDraw();
}

async function loudnessRefreshDspConfig() {
    try {
        if (!loudnessDSP?.connected) return;
        await loudnessDSP.downloadConfig();
        const active = loudnessPresetFromConfig();
        if (active !== loudnessActiveKey) {
            loudnessActiveKey = active;
            loudnessRender();
        } else {
            loudnessRenderBridge();
        }
    } catch (_) {}
}

async function loudnessInit() {
    try {
        loudnessDSP = await loudnessWaitForDSP();
        await loudnessDSP.downloadConfig();
        loudnessActiveKey = loudnessPresetFromConfig();

        try {
            await loudnessLoadCurveSettings();
        } catch (error) {
            loudnessStatus(`Curve settings unavailable: ${error.message}`, "error");
        }
        await loudnessRefreshBridge();

        const filter = loudnessDSP.config.filters?.[ESTACK_LOUDNESS_FILTER];
        if (filter?.type === "Loudness" && filter?.parameters?.fader !== ESTACK_LOUDNESS_FADER) {
            loudnessStatus("Active Loudness is not Aux1-linked · re-apply the preset", "error");
        } else {
            loudnessStatus("CamillaDSP native loudness · WiiM bridge on Aux1", "ok");
        }

        loudnessRender();
        loudnessTimer = setInterval(loudnessRefreshBridge, 700);
        loudnessDspTimer = setInterval(loudnessRefreshDspConfig, 5000);

        const canvas = document.getElementById("loudnessCanvas");
        if (canvas && "ResizeObserver" in window) {
            loudnessResizeObserver = new ResizeObserver(() => loudnessDraw());
            loudnessResizeObserver.observe(canvas);
        } else {
            window.addEventListener("resize", loudnessDraw);
        }

        document.getElementById("loudnessCurveSave")?.addEventListener("click", loudnessSaveCurve);
    } catch (error) {
        console.error("Loudness init failed", error);
        loudnessStatus(`ERROR: ${error?.message || error}`, "error");
        loudnessRender();
    }
}

window.addEventListener("beforeunload", () => {
    if (loudnessTimer) clearInterval(loudnessTimer);
    if (loudnessDspTimer) clearInterval(loudnessDspTimer);
    loudnessResizeObserver?.disconnect?.();
});

document.addEventListener("DOMContentLoaded", loudnessInit);
