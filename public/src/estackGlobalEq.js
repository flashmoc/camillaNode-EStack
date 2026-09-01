const GLOBAL_EQ_COUNT = 10;
const GLOBAL_EQ_DEFAULT_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const GLOBAL_EQ_COLORS = [12, 35, 58, 82, 112, 160, 195, 220, 270, 325];
const GLOBAL_EQ_STEP_DESCRIPTION = "E-Stack global input EQ";
const GLOBAL_EQ_SPECTRUM_FREQS = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];

let globalEqDSP;
let globalEqSelected = 0;
let globalEqSpectrumTimer;
let globalEqSpectrumMode = "fast";
let globalEqInfiniteEnabled = true;
let globalEqRealtime = Array(GLOBAL_EQ_SPECTRUM_FREQS.length).fill(-100);
let globalEqInfinite = Array(GLOBAL_EQ_SPECTRUM_FREQS.length).fill(-100);
let globalEqResizeTimer;

function globalEqWaitForDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

function globalEqClamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
}

function globalEqName(slot) {
    return `GLOBAL_EQ_${String(slot + 1).padStart(2, "0")}`;
}

function globalEqColor(slot) {
    return `hsl(${GLOBAL_EQ_COLORS[slot]}, 68%, 58%)`;
}

function globalEqDisabledKey(slot) {
    return `estack.globalEq.disabled.${slot}`;
}

function globalEqIsExplicitlyDisabled(slot) {
    return window.localStorage.getItem(globalEqDisabledKey(slot)) === "true";
}

function globalEqSetExplicitlyDisabled(slot, disabled) {
    window.localStorage.setItem(globalEqDisabledKey(slot), String(!!disabled));
}

function globalEqChannelsForStep(step) {
    if (Array.isArray(step?.channels)) return step.channels.map(Number);
    if (step?.channel !== undefined && step?.channel !== null) return [Number(step.channel)];
    return [];
}

function globalEqCaptureChannels() {
    const count = Math.max(1, Number(globalEqDSP?.config?.devices?.capture?.channels || 2));
    return Array.from({ length: Math.min(2, count) }, (_, index) => index);
}

function globalEqFirstMixerIndex() {
    return (globalEqDSP?.config?.pipeline || []).findIndex(step => step?.type === "Mixer");
}

function globalEqStep() {
    return (globalEqDSP?.config?.pipeline || []).find(step =>
        step?.type === "Filter" && (
            step?.description === GLOBAL_EQ_STEP_DESCRIPTION ||
            (step.names || []).some(name => String(name).startsWith("GLOBAL_EQ_"))
        )
    );
}

function globalEqFilter(slot) {
    return globalEqDSP?.config?.filters?.[globalEqName(slot)] || null;
}

function globalEqEnsureFilter(slot) {
    if (!globalEqDSP.config.filters) globalEqDSP.config.filters = {};
    const name = globalEqName(slot);
    if (!globalEqDSP.config.filters[name]) {
        globalEqDSP.config.filters[name] = {
            type: "Biquad",
            description: `E-Stack Global EQ band ${slot + 1}`,
            parameters: {
                type: "Peaking",
                freq: GLOBAL_EQ_DEFAULT_FREQS[slot],
                gain: 0,
                q: 0.7
            }
        };
    }
    return globalEqDSP.config.filters[name];
}

function globalEqIsInPipeline(slot) {
    const name = globalEqName(slot);
    return (globalEqDSP?.config?.pipeline || []).some(step =>
        step?.type === "Filter" && Array.isArray(step.names) && step.names.includes(name)
    );
}

function globalEqEnsureStep() {
    let step = globalEqStep();
    if (step) {
        step.channels = globalEqCaptureChannels();
        delete step.channel;
        step.names = Array.isArray(step.names) ? step.names : [];
        step.description = GLOBAL_EQ_STEP_DESCRIPTION;
        step.bypassed = false;
        return step;
    }

    const mixerIndex = globalEqFirstMixerIndex();
    if (mixerIndex < 0) throw new Error("No Mixer stage found; Global EQ cannot be placed safely");
    step = {
        type: "Filter",
        channels: globalEqCaptureChannels(),
        names: [],
        description: GLOBAL_EQ_STEP_DESCRIPTION,
        bypassed: false
    };
    globalEqDSP.config.pipeline.splice(mixerIndex, 0, step);
    return step;
}

function globalEqSortStep(step) {
    step.names = [...new Set(step.names || [])].sort((a, b) => {
        const ai = Number(String(a).match(/(\d+)$/)?.[1] || 999);
        const bi = Number(String(b).match(/(\d+)$/)?.[1] || 999);
        return ai - bi;
    });
}

function globalEqRemoveFromPipeline(slot) {
    const name = globalEqName(slot);
    for (const step of (globalEqDSP.config.pipeline || [])) {
        if (step?.type !== "Filter" || !Array.isArray(step.names)) continue;
        step.names = step.names.filter(item => item !== name);
    }
    globalEqDSP.config.pipeline = globalEqDSP.config.pipeline.filter(step =>
        !(step?.type === "Filter" && step?.description === GLOBAL_EQ_STEP_DESCRIPTION && (step.names || []).length === 0)
    );
}

function globalEqSyncBandPipeline(slot) {
    const filter = globalEqFilter(slot);
    if (!filter) {
        globalEqRemoveFromPipeline(slot);
        return false;
    }
    const gain = Number(filter.parameters?.gain || 0);
    const shouldRun = !globalEqIsExplicitlyDisabled(slot) && Math.abs(gain) >= 0.05;
    if (!shouldRun) {
        globalEqRemoveFromPipeline(slot);
        return false;
    }
    const step = globalEqEnsureStep();
    const name = globalEqName(slot);
    if (!step.names.includes(name)) step.names.push(name);
    globalEqSortStep(step);
    return true;
}

function globalEqCleanupNeutralPipeline() {
    for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
        const filter = globalEqFilter(slot);
        if (!filter) continue;
        if (Math.abs(Number(filter.parameters?.gain || 0)) < 0.05 || globalEqIsExplicitlyDisabled(slot)) {
            globalEqRemoveFromPipeline(slot);
        }
    }
}

function globalEqStatus(message, state = "info") {
    const el = document.getElementById("globalEqStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
}

async function globalEqUpload(reason) {
    try {
        globalEqCleanupNeutralPipeline();
        const mixerBefore = globalEqFirstMixerIndex();
        if (mixerBefore < 0) throw new Error("Mixer stage missing");
        const ok = await globalEqDSP.uploadConfig();
        if (!ok) throw new Error("CamillaDSP rejected the configuration");
        await globalEqDSP.downloadConfig();
        const step = globalEqStep();
        const mixerIndex = globalEqFirstMixerIndex();
        if (step && globalEqDSP.config.pipeline.indexOf(step) >= mixerIndex) {
            throw new Error("Global EQ is not before the mixer");
        }
        globalEqStatus(`${reason} · applied`, "ok");
        globalEqRender();
        return true;
    } catch (error) {
        console.error("Global EQ upload failed", error);
        globalEqStatus(`${reason} · ERROR: ${error?.message || error}`, "error");
        return false;
    }
}

function globalEqBandState(slot) {
    const filter = globalEqFilter(slot);
    if (!filter) return "neutral";
    if (globalEqIsExplicitlyDisabled(slot)) return "off";
    if (Math.abs(Number(filter.parameters?.gain || 0)) < 0.05) return "neutral";
    return globalEqIsInPipeline(slot) ? "active" : "off";
}

async function globalEqCommit(slot, key, value) {
    const filter = globalEqEnsureFilter(slot);
    const p = filter.parameters || (filter.parameters = {});
    if (key === "freq") p.freq = Math.round(globalEqClamp(value, 20, 20000) * 10) / 10;
    if (key === "gain") p.gain = Math.round(globalEqClamp(value, -20, 20) * 10) / 10;
    if (key === "q") p.q = Math.round(globalEqClamp(value, .1, 20) * 100) / 100;
    if (key === "type") p.type = value;
    globalEqSetExplicitlyDisabled(slot, false);
    globalEqSyncBandPipeline(slot);
    globalEqSelected = slot;
    await globalEqUpload(`Global EQ ${slot + 1} ${key}`);
}

async function globalEqToggle(slot) {
    const filter = globalEqEnsureFilter(slot);
    const gain = Number(filter.parameters?.gain || 0);
    const active = globalEqIsInPipeline(slot) && !globalEqIsExplicitlyDisabled(slot);
    if (active) {
        globalEqSetExplicitlyDisabled(slot, true);
        globalEqRemoveFromPipeline(slot);
        await globalEqUpload(`Global EQ ${slot + 1} disabled`);
        return;
    }
    globalEqSetExplicitlyDisabled(slot, false);
    globalEqSyncBandPipeline(slot);
    if (Math.abs(gain) < .05) {
        globalEqStatus(`Global EQ ${slot + 1} is neutral at 0 dB; kept out of the pipeline`, "warn");
        globalEqRender();
    } else {
        await globalEqUpload(`Global EQ ${slot + 1} enabled`);
    }
}

async function globalEqResetBand(slot) {
    const filter = globalEqEnsureFilter(slot);
    filter.parameters = {
        type: "Peaking",
        freq: GLOBAL_EQ_DEFAULT_FREQS[slot],
        gain: 0,
        q: 0.7
    };
    globalEqSetExplicitlyDisabled(slot, false);
    globalEqRemoveFromPipeline(slot);
    globalEqSelected = slot;
    await globalEqUpload(`Global EQ ${slot + 1} reset`);
}

async function globalEqResetAll() {
    if (!confirm("Reset all 10 Global EQ bands to neutral 0 dB?")) return;
    for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
        const filter = globalEqEnsureFilter(slot);
        filter.parameters = {
            type: "Peaking",
            freq: GLOBAL_EQ_DEFAULT_FREQS[slot],
            gain: 0,
            q: 0.7
        };
        globalEqSetExplicitlyDisabled(slot, false);
        globalEqRemoveFromPipeline(slot);
    }
    await globalEqUpload("Global EQ reset");
}

function globalEqNumber(value, min, max, step, onCommit) {
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = step;
    input.addEventListener("change", async () => {
        const next = globalEqClamp(input.value, min, max);
        input.value = next;
        await onCommit(next);
    });
    return input;
}

function globalEqSelect(values, current, onCommit, labels = {}) {
    const select = document.createElement("select");
    for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = labels[value] || value;
        select.appendChild(option);
    }
    select.value = current;
    select.addEventListener("change", () => onCommit(select.value));
    return select;
}

function globalEqRenderBand(slot) {
    const filter = globalEqFilter(slot);
    const p = filter?.parameters || {};
    const freq = Number(p.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
    const gain = Number(p.gain || 0);
    const q = Number(p.q || .7);
    const state = globalEqBandState(slot);

    const card = document.createElement("article");
    card.className = "global-eq-band";
    card.classList.toggle("selected", slot === globalEqSelected);
    card.classList.toggle("off", state === "off");
    card.style.setProperty("--band-color", globalEqColor(slot));

    const head = document.createElement("button");
    head.type = "button";
    head.className = "global-eq-band-head";
    head.innerHTML = `<strong>${slot + 1}</strong><span>${state === "active" ? "ACTIVE" : state === "off" ? "OFF" : "NEUTRAL"}</span>`;
    head.addEventListener("click", () => {
        globalEqSelected = slot;
        globalEqRender();
    });

    const enable = document.createElement("button");
    enable.type = "button";
    enable.className = "global-eq-enable";
    enable.classList.toggle("active", state === "active");
    enable.textContent = state === "active" ? "ENABLED" : state === "off" ? "ENABLE" : "0 dB · NEUTRAL";
    enable.addEventListener("click", () => globalEqToggle(slot));

    const gainWrap = document.createElement("div");
    gainWrap.className = "global-eq-gain-wrap";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "global-eq-gain";
    slider.min = -20;
    slider.max = 20;
    slider.step = .1;
    slider.value = gain;
    const readout = document.createElement("output");
    readout.className = "global-eq-gain-value";
    readout.textContent = `${gain.toFixed(1)} dB`;
    gainWrap.appendChild(slider);

    slider.addEventListener("input", () => {
        const preview = globalEqEnsureFilter(slot);
        preview.parameters.gain = Number(slider.value);
        globalEqSelected = slot;
        readout.textContent = `${Number(slider.value).toFixed(1)} dB`;
        globalEqDraw();
    });
    slider.addEventListener("change", () => globalEqCommit(slot, "gain", Number(slider.value)));

    const fields = document.createElement("div");
    fields.className = "global-eq-fields";
    const addField = (labelText, control) => {
        const label = document.createElement("label");
        const span = document.createElement("span");
        span.textContent = labelText;
        label.append(span, control);
        fields.appendChild(label);
    };

    addField("FREQ", globalEqNumber(Math.round(freq * 10) / 10, 20, 20000, 1, value => globalEqCommit(slot, "freq", value)));
    addField("GAIN", globalEqNumber(Math.round(gain * 10) / 10, -20, 20, .1, value => globalEqCommit(slot, "gain", value)));
    addField("Q", globalEqNumber(Math.round(q * 100) / 100, .1, 20, .01, value => globalEqCommit(slot, "q", value)));
    addField("TYPE", globalEqSelect(["Peaking", "Lowshelf", "Highshelf"], p.type || "Peaking", value => globalEqCommit(slot, "type", value), {
        Peaking: "BELL",
        Lowshelf: "LOW",
        Highshelf: "HIGH"
    }));

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "global-eq-reset";
    reset.textContent = "RESET";
    reset.addEventListener("click", () => globalEqResetBand(slot));

    card.append(head, enable, gainWrap, readout, fields, reset);
    return card;
}

function globalEqRender() {
    const root = document.getElementById("globalEqBands");
    if (!root || !globalEqDSP) return;
    root.replaceChildren();
    let active = 0;
    for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
        if (globalEqBandState(slot) === "active") active++;
        root.appendChild(globalEqRenderBand(slot));
    }
    const count = document.getElementById("globalEqActiveCount");
    if (count) count.textContent = `${active} ACTIVE`;
    globalEqDraw();
}

function globalEqFreqToX(freq, width) {
    return width * Math.log(freq / 20) / Math.log(20000 / 20);
}

function globalEqResponseY(db, height, top, bottom) {
    const max = 18;
    const min = -18;
    return top + (max - globalEqClamp(db, min, max)) / (max - min) * (height - top - bottom);
}

function globalEqSpectrumY(db, height, top, bottom) {
    const max = 0;
    const min = -80;
    return top + (max - globalEqClamp(db, min, max)) / (max - min) * (height - top - bottom);
}

function globalEqLogFreqs(count = 320) {
    return Array.from({ length: count }, (_, i) => 20 * Math.pow(1000, i / (count - 1)));
}

function globalEqRbjDb(parameters, freq) {
    const type = String(parameters?.type || "Peaking");
    const f0 = globalEqClamp(parameters?.freq || 1000, 5, 23000);
    const gain = Number(parameters?.gain || 0);
    const Q = Math.max(.05, Number(parameters?.q || 1));
    const fs = Number(globalEqDSP?.config?.devices?.samplerate || 48000);
    const w0 = 2 * Math.PI * f0 / fs;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    const A = Math.pow(10, gain / 40);
    let b0=1,b1=0,b2=0,a0=1,a1=0,a2=0;

    if (type === "Peaking") {
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else if (type === "Lowshelf" || type === "Highshelf") {
        const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
        if (type === "Lowshelf") {
            b0 = A*((A+1)-(A-1)*cw+twoSqrtAAlpha);
            b1 = 2*A*((A-1)-(A+1)*cw);
            b2 = A*((A+1)-(A-1)*cw-twoSqrtAAlpha);
            a0 = (A+1)+(A-1)*cw+twoSqrtAAlpha;
            a1 = -2*((A-1)+(A+1)*cw);
            a2 = (A+1)+(A-1)*cw-twoSqrtAAlpha;
        } else {
            b0 = A*((A+1)+(A-1)*cw+twoSqrtAAlpha);
            b1 = -2*A*((A-1)+(A+1)*cw);
            b2 = A*((A+1)+(A-1)*cw-twoSqrtAAlpha);
            a0 = (A+1)-(A-1)*cw+twoSqrtAAlpha;
            a1 = 2*((A-1)-(A+1)*cw);
            a2 = (A+1)-(A-1)*cw-twoSqrtAAlpha;
        }
    } else {
        return 0;
    }

    b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
    const w = 2 * Math.PI * freq / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2*w), s2 = Math.sin(2*w);
    const nr = b0 + b1*c1 + b2*c2;
    const ni = -b1*s1 - b2*s2;
    const dr = 1 + a1*c1 + a2*c2;
    const di = -a1*s1 - a2*s2;
    const mag = Math.sqrt((nr*nr + ni*ni) / Math.max(1e-20, dr*dr + di*di));
    return 20 * Math.log10(Math.max(1e-8, mag));
}

function globalEqTotalDb(freq) {
    let total = 0;
    for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
        if (!globalEqIsInPipeline(slot)) continue;
        const filter = globalEqFilter(slot);
        if (filter?.type === "Biquad") total += globalEqRbjDb(filter.parameters || {}, freq);
    }
    return total;
}

function globalEqDrawGrid(ctx, width, height, margin) {
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const freqTicks = [20,40,80,160,315,630,1250,2500,5000,10000,20000];
    ctx.font = "11px Abel, Arial";
    ctx.lineWidth = 1;
    for (const freq of freqTicks) {
        const x = margin.left + globalEqFreqToX(freq, innerW);
        ctx.strokeStyle = "rgba(255,255,255,.10)";
        ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + innerH); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.48)";
        ctx.textAlign = freq === 20 ? "left" : freq === 20000 ? "right" : "center";
        ctx.fillText(freq >= 1000 ? `${Number((freq/1000).toFixed(freq >= 10000 ? 0 : 1))}k` : String(freq), x, height - 10);
    }
    for (let db = -15; db <= 15; db += 5) {
        const y = globalEqResponseY(db, height, margin.top, margin.bottom);
        ctx.strokeStyle = db === 0 ? "rgba(255,255,255,.30)" : "rgba(255,255,255,.09)";
        ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width - margin.right, y); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.45)";
        ctx.textAlign = "right";
        ctx.fillText(`${db > 0 ? "+" : ""}${db}`, margin.left - 7, y + 4);
    }
    const spectrumTicks = [0,-20,-40,-60,-80];
    ctx.textAlign = "left";
    for (const db of spectrumTicks) {
        const y = globalEqSpectrumY(db, height, margin.top, margin.bottom);
        ctx.fillStyle = "rgba(255,255,255,.32)";
        ctx.fillText(`${db}`, width - margin.right + 6, y + 4);
    }
    ctx.fillStyle = "rgba(255,255,255,.38)";
    ctx.textAlign = "left";
    ctx.fillText("EQ dB", 7, 13);
    ctx.textAlign = "right";
    ctx.fillText("dBFS", width - 7, 13);
}

function globalEqDrawSpectrum(ctx, width, height, margin) {
    const innerW = width - margin.left - margin.right;
    const baseline = height - margin.bottom;
    if (globalEqInfiniteEnabled && globalEqInfinite.length) {
        ctx.beginPath();
        for (let i = 0; i < GLOBAL_EQ_SPECTRUM_FREQS.length; i++) {
            const x = margin.left + globalEqFreqToX(GLOBAL_EQ_SPECTRUM_FREQS[i], innerW);
            const y = globalEqSpectrumY(globalEqInfinite[i], height, margin.top, margin.bottom);
            if (i === 0) ctx.moveTo(x, baseline); else ctx.lineTo(x, y);
        }
        const lastX = margin.left + globalEqFreqToX(GLOBAL_EQ_SPECTRUM_FREQS.at(-1), innerW);
        ctx.lineTo(lastX, baseline);
        ctx.closePath();
        ctx.fillStyle = "rgba(205,210,210,.18)";
        ctx.fill();
    }

    ctx.beginPath();
    for (let i = 0; i < GLOBAL_EQ_SPECTRUM_FREQS.length; i++) {
        const x = margin.left + globalEqFreqToX(GLOBAL_EQ_SPECTRUM_FREQS[i], innerW);
        const y = globalEqSpectrumY(globalEqRealtime[i], height, margin.top, margin.bottom);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(245,248,248,.78)";
    ctx.lineWidth = 1.35;
    ctx.stroke();
}

function globalEqDrawResponse(ctx, width, height, margin) {
    const innerW = width - margin.left - margin.right;
    const freqs = globalEqLogFreqs();
    ctx.beginPath();
    freqs.forEach((freq, index) => {
        const x = margin.left + globalEqFreqToX(freq, innerW);
        const y = globalEqResponseY(globalEqTotalDb(freq), height, margin.top, margin.bottom);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "hsl(var(--bck-hue), 72%, 67%)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
        const filter = globalEqFilter(slot);
        const freq = Number(filter?.parameters?.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
        const x = margin.left + globalEqFreqToX(freq, innerW);
        const y = globalEqResponseY(globalEqTotalDb(freq), height, margin.top, margin.bottom);
        const selected = slot === globalEqSelected;
        const state = globalEqBandState(slot);
        ctx.beginPath();
        ctx.arc(x, y, selected ? 10 : 8, 0, Math.PI * 2);
        ctx.fillStyle = selected ? "rgba(255,255,255,.96)" : "rgba(32,42,42,.90)";
        ctx.fill();
        ctx.lineWidth = selected ? 2.4 : 1.4;
        ctx.strokeStyle = state === "active" ? globalEqColor(slot) : "rgba(210,220,220,.35)";
        ctx.stroke();
        ctx.fillStyle = selected ? "#182020" : state === "active" ? "#fff" : "rgba(255,255,255,.55)";
        ctx.font = `${selected ? "bold " : ""}11px Abel, Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(slot + 1), x, y + .5);
    }
}

function globalEqDraw() {
    const canvas = document.getElementById("globalEqCanvas");
    if (!canvas || !globalEqDSP) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const margin = { left: 50, right: 42, top: 20, bottom: 32 };
    globalEqDrawGrid(ctx, rect.width, rect.height, margin);
    globalEqDrawSpectrum(ctx, rect.width, rect.height, margin);
    globalEqDrawResponse(ctx, rect.width, rect.height, margin);
}

function globalEqResetInfiniteSpectrum() {
    globalEqInfinite = Array(GLOBAL_EQ_SPECTRUM_FREQS.length).fill(-100);
    globalEqDraw();
}

function globalEqStartSpectrum() {
    if (globalEqSpectrumTimer) clearInterval(globalEqSpectrumTimer);
    globalEqSpectrumTimer = setInterval(async () => {
        try {
            if (!globalEqDSP?.spectrum_connected) return;
            const levels = await globalEqDSP.getSpectrumData();
            if (!Array.isArray(levels)) return;
            const alpha = globalEqSpectrumMode === "fast" ? .58 : .16;
            for (let i = 0; i < GLOBAL_EQ_SPECTRUM_FREQS.length; i++) {
                const next = Number(levels[i * 2] ?? -100);
                globalEqRealtime[i] = alpha * next + (1 - alpha) * globalEqRealtime[i];
                if (globalEqInfiniteEnabled) {
                    const current = globalEqInfinite[i];
                    globalEqInfinite[i] = Math.max(next, current - .015);
                }
            }
            globalEqDraw();
        } catch (_) {}
    }, 120);
}

function globalEqBindControls() {
    const fast = document.getElementById("globalEqFast");
    const slow = document.getElementById("globalEqSlow");
    const infinite = document.getElementById("globalEqInfinite");
    const resetInfinite = document.getElementById("globalEqResetInfinite");
    const resetAll = document.getElementById("globalEqResetAll");

    fast.addEventListener("click", () => {
        globalEqSpectrumMode = "fast";
        fast.classList.add("active");
        slow.classList.remove("active");
    });
    slow.addEventListener("click", () => {
        globalEqSpectrumMode = "slow";
        slow.classList.add("active");
        fast.classList.remove("active");
    });
    infinite.addEventListener("click", () => {
        globalEqInfiniteEnabled = !globalEqInfiniteEnabled;
        infinite.classList.toggle("active", globalEqInfiniteEnabled);
        globalEqDraw();
    });
    resetInfinite.addEventListener("click", globalEqResetInfiniteSpectrum);
    resetAll.addEventListener("click", globalEqResetAll);

    const canvas = document.getElementById("globalEqCanvas");
    canvas.addEventListener("click", event => {
        const rect = canvas.getBoundingClientRect();
        const margin = { left: 50, right: 42, top: 20, bottom: 32 };
        const innerW = rect.width - margin.left - margin.right;
        let best = null;
        for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
            const filter = globalEqFilter(slot);
            const freq = Number(filter?.parameters?.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
            const x = margin.left + globalEqFreqToX(freq, innerW);
            const y = globalEqResponseY(globalEqTotalDb(freq), rect.height, margin.top, margin.bottom);
            const distance = Math.hypot(event.clientX - rect.left - x, event.clientY - rect.top - y);
            if (!best || distance < best.distance) best = { slot, distance };
        }
        if (best && best.distance <= 17) {
            globalEqSelected = best.slot;
            globalEqRender();
        }
    });
}

async function globalEqOnLoad() {
    globalEqDSP = await globalEqWaitForDSP();
    await globalEqDSP.downloadConfig();
    globalEqCleanupNeutralPipeline();
    globalEqBindControls();
    globalEqRender();
    globalEqStartSpectrum();
    globalEqStatus("Global EQ ready · shared L/R before routing", "ok");

    window.addEventListener("resize", () => {
        clearTimeout(globalEqResizeTimer);
        globalEqResizeTimer = setTimeout(globalEqDraw, 120);
    });
}

window.addEventListener("beforeunload", () => {
    if (globalEqSpectrumTimer) clearInterval(globalEqSpectrumTimer);
});

document.addEventListener("DOMContentLoaded", globalEqOnLoad);
