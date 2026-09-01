// Global EQ v2 — mirrors the rotary/drag workflow used by the per-output EQ
// while preserving the existing safe pre-mixer Global EQ pipeline logic.

let globalV2Drag = null;
let globalV2SuppressClick = false;

function globalV2Norm(value, min, max, logarithmic = false) {
    const v = globalEqClamp(value, min, max);
    if (logarithmic) return Math.log(v / min) / Math.log(max / min);
    return (v - min) / (max - min);
}

function globalV2FromNorm(norm, min, max, logarithmic = false) {
    const t = globalEqClamp(norm, 0, 1);
    if (logarithmic) return min * Math.pow(max / min, t);
    return min + (max - min) * t;
}

function globalV2SnapGain(value) {
    const n = globalEqClamp(value, -20, 20);
    return Math.abs(n) <= 0.3 ? 0 : n;
}

function globalV2Round(value, step) {
    const s = Number(step) || 1;
    return Math.round(Number(value) / s) * s;
}

function globalV2MakeKnob({ label, value, min, max, step, logarithmic = false, unit = "", resetValue, snapZero = false, preview, commit }) {
    const root = document.createElement("div");
    root.className = "estack-eq8-knob-control";

    const labelEl = document.createElement("span");
    labelEl.className = "estack-eq8-knob-label";
    labelEl.textContent = label;

    const knob = document.createElement("div");
    knob.className = "estack-eq8-knob";
    knob.tabIndex = 0;
    knob.setAttribute("role", "slider");
    knob.setAttribute("aria-label", label);
    knob.setAttribute("aria-valuemin", String(min));
    knob.setAttribute("aria-valuemax", String(max));

    const marker = document.createElement("span");
    marker.className = "estack-eq8-knob-marker";
    knob.appendChild(marker);

    const numberRow = document.createElement("div");
    numberRow.className = "estack-eq8-number-row";
    const number = document.createElement("input");
    number.type = "number";
    number.className = "estack-eq8-number";
    number.min = min;
    number.max = max;
    number.step = step;
    number.inputMode = "decimal";
    const unitEl = document.createElement("span");
    unitEl.className = "estack-eq8-unit";
    unitEl.textContent = unit;
    numberRow.append(number, unitEl);

    let current = globalEqClamp(value, min, max);
    let dragging = false;
    let dragStartY = 0;
    let dragStartNorm = 0;
    let wheelCommitTimer;

    const normalize = next => {
        let result = globalEqClamp(globalV2Round(next, step), min, max);
        if (snapZero && min < 0 && max >= 0 && Math.abs(result) <= 0.3) result = 0;
        return result;
    };

    const render = () => {
        const norm = globalV2Norm(current, min, max, logarithmic);
        knob.style.setProperty("--angle", `${-135 + norm * 270}deg`);
        knob.setAttribute("aria-valuenow", String(current));
        number.value = step < 1 ? Number(current).toFixed(step <= .01 ? 2 : 1) : String(Math.round(current));
    };

    const setCurrent = (next, doPreview = true) => {
        current = normalize(next);
        render();
        if (doPreview && preview) preview(current);
    };

    const commitCurrent = async () => {
        if (commit) await commit(current);
    };

    knob.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging = true;
        dragStartY = event.clientY;
        dragStartNorm = globalV2Norm(current, min, max, logarithmic);
        knob.setPointerCapture(event.pointerId);
    });

    knob.addEventListener("pointermove", event => {
        if (!dragging) return;
        const sensitivity = event.shiftKey ? 520 : 190;
        const nextNorm = dragStartNorm + (dragStartY - event.clientY) / sensitivity;
        setCurrent(globalV2FromNorm(nextNorm, min, max, logarithmic));
    });

    const finish = async event => {
        if (!dragging) return;
        dragging = false;
        try { knob.releasePointerCapture(event.pointerId); } catch (_) {}
        await commitCurrent();
    };
    knob.addEventListener("pointerup", finish);
    knob.addEventListener("pointercancel", finish);

    knob.addEventListener("wheel", event => {
        event.preventDefault();
        const norm = globalV2Norm(current, min, max, logarithmic);
        const amount = event.shiftKey ? .004 : .015;
        setCurrent(globalV2FromNorm(norm + (event.deltaY < 0 ? amount : -amount), min, max, logarithmic));
        clearTimeout(wheelCommitTimer);
        wheelCommitTimer = setTimeout(commitCurrent, 220);
    }, { passive: false });

    knob.addEventListener("keydown", event => {
        if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") setCurrent(min);
        else if (event.key === "End") setCurrent(max);
        else {
            const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1;
            const norm = globalV2Norm(current, min, max, logarithmic);
            setCurrent(globalV2FromNorm(norm + direction * (event.shiftKey ? .004 : .015), min, max, logarithmic));
        }
        commitCurrent();
    });

    knob.addEventListener("dblclick", () => {
        setCurrent(resetValue);
        commitCurrent();
    });

    number.addEventListener("change", () => {
        setCurrent(number.value);
        commitCurrent();
    });
    number.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        setCurrent(number.value);
        commitCurrent();
        number.blur();
    });

    render();
    root.append(labelEl, knob, numberRow);
    return root;
}

function globalV2MakeQ(slot, filter, q) {
    const root = document.createElement("div");
    root.className = "estack-eq8-q-control";

    const head = document.createElement("div");
    head.className = "estack-eq8-q-head";
    const label = document.createElement("span");
    label.className = "estack-eq8-q-label";
    label.textContent = "Q";
    const readout = document.createElement("output");
    readout.className = "estack-eq8-q-value";
    readout.textContent = Number(q).toFixed(2);
    head.append(label, readout);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "estack-eq8-q";
    slider.min = 0;
    slider.max = 1000;
    slider.step = 1;
    slider.value = Math.round(globalV2Norm(q, .1, 20, true) * 1000);

    const qValue = () => Math.round(globalV2FromNorm(Number(slider.value) / 1000, .1, 20, true) * 100) / 100;
    slider.addEventListener("input", () => {
        const next = qValue();
        readout.textContent = next.toFixed(2);
        filter.parameters.q = next;
        globalEqSelected = slot;
        globalEqDraw();
    });
    slider.addEventListener("change", () => globalEqCommit(slot, "q", qValue()));

    root.append(head, slider);
    return root;
}

function globalV2MakeType(slot, current) {
    const root = document.createElement("div");
    root.className = "estack-eq8-type";
    for (const [value, label] of [["Peaking", "BELL"], ["Lowshelf", "LOW"], ["Highshelf", "HIGH"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.classList.toggle("active", String(current || "Peaking") === value);
        button.addEventListener("click", () => globalEqCommit(slot, "type", value));
        root.appendChild(button);
    }
    return root;
}

const globalV2BaseCommit = globalEqCommit;
globalEqCommit = async function(slot, key, value) {
    if (key === "gain") value = globalV2SnapGain(value);
    return globalV2BaseCommit(slot, key, value);
};

globalEqRenderBand = function(slot) {
    const filter = globalEqEnsureFilter(slot);
    const p = filter.parameters || (filter.parameters = {});
    const freq = Number(p.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
    const gain = Number(p.gain || 0);
    const q = Number(p.q || .7);
    const state = globalEqBandState(slot);
    const color = globalEqColor(slot);

    const strip = document.createElement("article");
    strip.className = "estack-peq-strip estack-eq8-strip global-v2-band";
    strip.classList.toggle("selected", slot === globalEqSelected);
    strip.classList.toggle("off", state === "off");
    strip.classList.toggle("neutral", state === "neutral");
    strip.style.setProperty("--peq-color", color);
    strip.style.setProperty("--band-color", color);

    const head = document.createElement("button");
    head.type = "button";
    head.className = "estack-peq-strip-head";
    head.innerHTML = `<strong>${slot + 1}</strong>`;
    head.addEventListener("click", () => {
        globalEqSelected = slot;
        globalEqRender();
    });

    const power = document.createElement("button");
    power.type = "button";
    power.className = "global-v2-power";
    power.classList.toggle("active", state === "active");
    power.classList.toggle("neutral", state === "neutral");
    power.title = state === "active" ? "Disable band" : state === "neutral" ? "Neutral at 0 dB" : "Enable band";
    power.addEventListener("click", event => {
        event.stopPropagation();
        globalEqToggle(slot);
    });
    head.appendChild(power);

    const controls = document.createElement("div");
    controls.className = "estack-eq8-controls";

    controls.appendChild(globalV2MakeKnob({
        label: "FREQ",
        value: freq,
        min: 20,
        max: 20000,
        step: 1,
        logarithmic: true,
        unit: "Hz",
        resetValue: GLOBAL_EQ_DEFAULT_FREQS[slot],
        preview: next => {
            p.freq = Math.round(next * 10) / 10;
            globalEqSelected = slot;
            globalEqDraw();
        },
        commit: next => globalEqCommit(slot, "freq", next)
    }));

    controls.appendChild(globalV2MakeKnob({
        label: "GAIN",
        value: gain,
        min: -20,
        max: 20,
        step: .1,
        unit: "dB",
        resetValue: 0,
        snapZero: true,
        preview: next => {
            p.gain = globalV2SnapGain(next);
            globalEqSelected = slot;
            globalEqDraw();
        },
        commit: next => globalEqCommit(slot, "gain", next)
    }));

    controls.appendChild(globalV2MakeQ(slot, filter, q));
    controls.appendChild(globalV2MakeType(slot, p.type || "Peaking"));

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "estack-eq8-reset";
    reset.textContent = "RESET";
    reset.addEventListener("click", () => globalEqResetBand(slot));

    strip.append(head, controls, reset);
    return strip;
};

// During manipulation, preview every non-disabled non-neutral Global EQ band,
// even before the pipeline has been uploaded. The resulting curve is therefore
// immediate and still matches the post-commit DSP state.
function globalV2TotalDb(freq) {
    let total = 0;
    for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
        if (globalEqIsExplicitlyDisabled(slot)) continue;
        const filter = globalEqFilter(slot);
        if (filter?.type !== "Biquad") continue;
        if (Math.abs(Number(filter.parameters?.gain || 0)) < .05) continue;
        total += globalEqRbjDb(filter.parameters || {}, freq);
    }
    return total;
}

globalEqResponseY = function(db, height, top, bottom) {
    const max = 20;
    const min = -20;
    return top + (max - globalEqClamp(db, min, max)) / (max - min) * (height - top - bottom);
};

globalEqDrawGrid = function(ctx, width, height, margin) {
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const freqTicks = [20,40,80,160,315,630,1250,2500,5000,10000,20000];
    ctx.save();
    ctx.font = "10px Abel, Arial";
    ctx.lineWidth = 1;
    for (const freq of freqTicks) {
        const x = margin.left + globalEqFreqToX(freq, innerW);
        ctx.strokeStyle = "rgba(225,232,235,.16)";
        ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + innerH); ctx.stroke();
        ctx.fillStyle = "rgba(240,244,245,.60)";
        ctx.textAlign = freq === 20 ? "left" : freq === 20000 ? "right" : "center";
        ctx.fillText(freq >= 1000 ? `${Number((freq/1000).toFixed(freq >= 10000 ? 0 : 1))}k` : String(freq), x, height - 10);
    }
    for (let db = -20; db <= 20; db += 5) {
        const y = globalEqResponseY(db, height, margin.top, margin.bottom);
        ctx.strokeStyle = db === 0 ? "rgba(245,248,249,.42)" : "rgba(225,232,235,.11)";
        ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width - margin.right, y); ctx.stroke();
        ctx.fillStyle = db === 0 ? "rgba(250,252,252,.78)" : "rgba(235,240,241,.50)";
        ctx.textAlign = "right";
        ctx.fillText(`${db > 0 ? "+" : ""}${db}`, margin.left - 7, y + 4);
    }
    for (const db of [0,-20,-40,-60,-80]) {
        const y = globalEqSpectrumY(db, height, margin.top, margin.bottom);
        ctx.fillStyle = "rgba(230,235,237,.30)";
        ctx.textAlign = "left";
        ctx.fillText(`${db}`, width - margin.right + 6, y + 4);
    }
    ctx.restore();
};

globalEqDrawResponse = function(ctx, width, height, margin) {
    const innerW = width - margin.left - margin.right;
    const freqs = globalEqLogFreqs(420);
    const zeroY = globalEqResponseY(0, height, margin.top, margin.bottom);

    // Selected band's own contribution, subtle fill like the channel EQ.
    const selectedFilter = globalEqFilter(globalEqSelected);
    if (selectedFilter?.type === "Biquad" && !globalEqIsExplicitlyDisabled(globalEqSelected)) {
        const color = globalEqColor(globalEqSelected);
        ctx.beginPath();
        freqs.forEach((freq, index) => {
            const x = margin.left + globalEqFreqToX(freq, innerW);
            const y = globalEqResponseY(globalEqRbjDb(selectedFilter.parameters || {}, freq), height, margin.top, margin.bottom);
            if (index === 0) ctx.moveTo(x, zeroY);
            ctx.lineTo(x, y);
        });
        ctx.lineTo(margin.left + innerW, zeroY);
        ctx.closePath();
        ctx.fillStyle = color.replace("hsl(", "hsla(").replace(")", ", .10)");
        ctx.fill();
    }

    ctx.beginPath();
    freqs.forEach((freq, index) => {
        const x = margin.left + globalEqFreqToX(freq, innerW);
        const y = globalEqResponseY(globalV2TotalDb(freq), height, margin.top, margin.bottom);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(238,244,245,.96)";
    ctx.lineWidth = 2.1;
    ctx.stroke();

    for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
        const filter = globalEqFilter(slot);
        const p = filter?.parameters || {};
        const freq = Number(p.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
        const gain = Number(p.gain || 0);
        const x = margin.left + globalEqFreqToX(freq, innerW);
        const y = globalEqResponseY(gain, height, margin.top, margin.bottom);
        const selected = slot === globalEqSelected;
        const state = globalEqBandState(slot);
        const color = globalEqColor(slot);

        ctx.beginPath();
        ctx.arc(x, y, selected ? 11 : 8.5, 0, Math.PI * 2);
        ctx.fillStyle = selected ? color : state === "off" ? "rgba(20,24,25,.72)" : "rgba(14,18,19,.96)";
        ctx.fill();
        ctx.lineWidth = selected ? 2.5 : 1.6;
        ctx.strokeStyle = state === "off" ? "rgba(215,222,224,.28)" : color;
        ctx.stroke();
        if (selected) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        ctx.fillStyle = selected ? "#071011" : "rgba(248,250,250,.92)";
        ctx.font = `${selected ? "bold " : ""}11px Abel, Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(slot + 1), x, y + .5);
    }
};

function globalV2PointPositions() {
    const canvas = document.getElementById("globalEqCanvas");
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 50, right: 42, top: 20, bottom: 32 };
    const innerW = rect.width - margin.left - margin.right;
    return Array.from({ length: GLOBAL_EQ_COUNT }, (_, slot) => {
        const filter = globalEqFilter(slot);
        const p = filter?.parameters || {};
        const freq = Number(p.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
        const gain = Number(p.gain || 0);
        return {
            slot,
            filter: globalEqEnsureFilter(slot),
            x: margin.left + globalEqFreqToX(freq, innerW),
            y: globalEqResponseY(gain, rect.height, margin.top, margin.bottom)
        };
    });
}

function globalV2PointerParams(event) {
    const canvas = document.getElementById("globalEqCanvas");
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 50, right: 42, top: 20, bottom: 32 };
    const innerW = rect.width - margin.left - margin.right;
    const innerH = rect.height - margin.top - margin.bottom;
    const localX = globalEqClamp(event.clientX - rect.left - margin.left, 0, innerW);
    const localY = globalEqClamp(event.clientY - rect.top - margin.top, 0, innerH);
    const freq = 20 * Math.pow(1000, localX / Math.max(1, innerW));
    let gain = 20 - (localY / Math.max(1, innerH)) * 40;
    gain = Math.round(globalEqClamp(gain, -20, 20) * 10) / 10;
    gain = globalV2SnapGain(gain);
    return { freq: Math.round(globalEqClamp(freq, 20, 20000)), gain };
}

function globalV2InstallGraphDrag() {
    const canvas = document.getElementById("globalEqCanvas");
    if (!canvas || canvas.dataset.globalV2Drag === "true") return;
    canvas.dataset.globalV2Drag = "true";

    canvas.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let best = null;
        for (const point of globalV2PointPositions()) {
            const distance = Math.hypot(x - point.x, y - point.y);
            if (!best || distance < best.distance) best = { ...point, distance };
        }
        if (!best || best.distance > 18) return;
        event.preventDefault();
        globalEqSelected = best.slot;
        globalV2Drag = { slot: best.slot, filter: best.filter, moved: false };
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add("global-v2-dragging");
        globalEqDraw();
    });

    canvas.addEventListener("pointermove", event => {
        if (!globalV2Drag) return;
        const params = globalV2PointerParams(event);
        const p = globalV2Drag.filter.parameters || (globalV2Drag.filter.parameters = {});
        p.freq = params.freq;
        p.gain = params.gain;
        globalEqSetExplicitlyDisabled(globalV2Drag.slot, false);
        globalV2Drag.moved = true;
        globalEqDraw();
    });

    const finish = async event => {
        if (!globalV2Drag) return;
        const drag = globalV2Drag;
        globalV2Drag = null;
        canvas.classList.remove("global-v2-dragging");
        try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
        if (!drag.moved) return;
        globalV2SuppressClick = true;
        globalEqSyncBandPipeline(drag.slot);
        await globalEqUpload(`Global EQ ${drag.slot + 1} graph move`);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);

    // Capture all clicks so the old point-location handler (which used total
    // response Y) cannot fight the new frequency/gain point geometry.
    canvas.addEventListener("click", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (globalV2SuppressClick) {
            globalV2SuppressClick = false;
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let best = null;
        for (const point of globalV2PointPositions()) {
            const distance = Math.hypot(x - point.x, y - point.y);
            if (!best || distance < best.distance) best = { ...point, distance };
        }
        if (best && best.distance <= 18) {
            globalEqSelected = best.slot;
            globalEqRender();
        }
    }, true);
}

const globalV2BaseBindControls = globalEqBindControls;
globalEqBindControls = function() {
    globalV2BaseBindControls();
    globalV2InstallGraphDrag();
};
