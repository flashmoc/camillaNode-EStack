// E-Stack EQ v2: two-view workflow, draggable PEQ graph points,
// rotary crossovers and a unified Output / Protection surface.

const ESTACK_V2_OUTPUT_MODULE = "outputProtection";
let estackV2Drag = null;
let estackV2SuppressClick = false;

function estackV2SetLocked(control, locked) {
    if (!control) return control;
    control.classList.toggle("estack-v2-locked", !!locked);
    if (locked) {
        control.querySelectorAll("input, select, button, [tabindex]").forEach(el => {
            if (el.classList.contains("estack-eq8-on")) return;
            el.setAttribute("aria-disabled", "true");
            if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLButtonElement) el.disabled = true;
            else el.tabIndex = -1;
        });
    }
    return control;
}

function estackV2Knob(options, locked = false) {
    const control = estackEq8MakeKnob(options);
    control.classList.add("estack-v2-knob");
    return estackV2SetLocked(control, locked);
}

function estackV2MakeSegmented(values, current, formatter, locked, onChange) {
    const row = document.createElement("div");
    row.className = "estack-v2-segmented";
    for (const value of values) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = formatter(value);
        button.classList.toggle("active", String(value) === String(current));
        button.disabled = locked;
        button.addEventListener("click", async () => {
            await onChange(value);
            row.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
        });
        row.appendChild(button);
    }
    return row;
}

// Crossover is part of EQ now. Frequency is a rotary control; family and slope
// remain compact segmented controls.
estackRenderPeqCrossover = function(kind) {
    const entry = getCrossover(kind);
    const card = document.createElement("section");
    card.className = "estack-peq-xover-card estack-v2-xover";
    const locked = !systemEditEnabled;
    card.classList.toggle("locked", locked);

    const title = document.createElement("div");
    title.className = "estack-peq-xover-title";
    title.innerHTML = `<strong>${kind === "hpf" ? "HIGH PASS" : "LOW PASS"}</strong><span>${locked ? "LOCKED" : "EDIT"}</span>`;
    card.appendChild(title);

    if (!entry) {
        const empty = document.createElement("div");
        empty.className = "estack-peq-xover-empty";
        empty.textContent = "NOT CONFIGURED";
        card.appendChild(empty);
        return card;
    }

    const [name, filter] = entry;
    const p = filter.parameters || {};
    const family = String(p.type || "").startsWith("Butterworth") ? "Butterworth" : "LinkwitzRiley";
    const slope = Math.max(12, Number(p.order || 4) * 6);

    const body = document.createElement("div");
    body.className = "estack-v2-xover-body";

    body.appendChild(estackV2Knob({
        label: "FREQ",
        value: Number(p.freq || 100),
        min: 16,
        max: 20000,
        step: 1,
        logarithmic: true,
        unit: "Hz",
        resetValue: Number(p.freq || 100),
        preview: locked ? null : next => {
            p.freq = Math.round(next * 10) / 10;
            drawGraph();
        },
        commit: locked ? null : async next => {
            p.freq = Math.round(next * 10) / 10;
            await safeUpload(`${channelName()} ${kind.toUpperCase()} frequency`);
            renderAll(false);
        }
    }, locked));

    const familyBlock = document.createElement("div");
    familyBlock.className = "estack-v2-xover-options";
    const familyLabel = document.createElement("span");
    familyLabel.textContent = "TYPE";
    familyBlock.append(familyLabel, estackV2MakeSegmented(
        ["LinkwitzRiley", "Butterworth"],
        family,
        value => value === "LinkwitzRiley" ? "LR" : "BW",
        locked,
        async value => {
            p.type = `${value}${kind === "hpf" ? "Highpass" : "Lowpass"}`;
            await safeUpload(`${channelName()} ${kind.toUpperCase()} type`);
            renderAll(false);
        }
    ));

    const slopeBlock = document.createElement("div");
    slopeBlock.className = "estack-v2-xover-options";
    const slopeLabel = document.createElement("span");
    slopeLabel.textContent = "SLOPE";
    slopeBlock.append(slopeLabel, estackV2MakeSegmented(
        [12, 24, 36, 48],
        slope,
        value => String(value),
        locked,
        async value => {
            p.order = Number(value) / 6;
            await safeUpload(`${channelName()} ${kind.toUpperCase()} slope`);
            renderAll(false);
        }
    ));

    body.append(familyBlock, slopeBlock);
    card.appendChild(body);
    card.title = name;
    return card;
};

function estackV2RenderOutputProtection(root) {
    root.replaceChildren();
    root.classList.remove("estack-peq-rack-mode");
    root.classList.add("estack-v2-output-mode");

    const locked = !systemEditEnabled;
    const consoleEl = document.createElement("div");
    consoleEl.className = "estack-v2-output-console";

    const outputCard = document.createElement("section");
    outputCard.className = "estack-v2-card estack-v2-output-card";
    outputCard.innerHTML = `<header><strong>OUTPUT</strong><span>${channelName()}</span></header>`;
    const outputBody = document.createElement("div");
    outputBody.className = "estack-v2-output-body";

    const gainEntry = getGainEntry();
    if (gainEntry) {
        const [, filter] = gainEntry;
        const p = filter.parameters || {};
        outputBody.appendChild(estackV2Knob({
            label: "GAIN",
            value: Number(p.gain || 0),
            min: -60,
            max: 12,
            step: .1,
            unit: "dB",
            resetValue: 0,
            preview: locked ? null : next => { p.gain = Math.round(next * 10) / 10; drawGraph(); },
            commit: locked ? null : async next => {
                p.gain = Math.round(next * 10) / 10;
                await safeUpload(`${channelName()} output gain`);
                renderAll(false);
            }
        }, locked));

        const switches = document.createElement("div");
        switches.className = "estack-v2-switches";
        const polarity = document.createElement("button");
        polarity.type = "button";
        polarity.disabled = locked;
        polarity.classList.toggle("active", !!p.inverted);
        polarity.innerHTML = `<span>POLARITY</span><strong>${p.inverted ? "INVERTED" : "NORMAL"}</strong>`;
        polarity.onclick = async () => {
            p.inverted = !p.inverted;
            await safeUpload(`${channelName()} polarity`);
            renderAll(false);
        };
        const mute = document.createElement("button");
        mute.type = "button";
        mute.disabled = locked;
        mute.classList.toggle("danger", !!p.mute);
        mute.innerHTML = `<span>OUTPUT</span><strong>${p.mute ? "MUTED" : "ON"}</strong>`;
        mute.onclick = async () => {
            p.mute = !p.mute;
            await safeUpload(`${channelName()} mute`);
            renderAll(false);
        };
        switches.append(polarity, mute);
        outputBody.appendChild(switches);
    }

    const delayEntry = getDelayEntry();
    if (delayEntry) {
        const [, filter] = delayEntry;
        const p = filter.parameters || {};
        const unit = p.unit || "ms";
        outputBody.appendChild(estackV2Knob({
            label: "DELAY",
            value: Number(p.delay || 0),
            min: 0,
            max: unit === "ms" ? 100 : 50000,
            step: unit === "ms" ? .01 : 1,
            unit,
            resetValue: 0,
            preview: null,
            commit: locked ? null : async next => {
                p.delay = Number(next);
                await safeUpload(`${channelName()} alignment delay`);
                renderAll(false);
            }
        }, locked));
    }
    outputCard.appendChild(outputBody);

    const protectionCard = document.createElement("section");
    protectionCard.className = "estack-v2-card estack-v2-protection-card";
    protectionCard.innerHTML = `<header><strong>PROTECTION</strong><span>${locked ? "LOCKED" : "EDIT"}</span></header>`;
    const protectionBody = document.createElement("div");
    protectionBody.className = "estack-v2-protection-body";

    for (const [name, filter] of getLimiterEntries()) {
        const p = filter.parameters || {};
        const block = document.createElement("div");
        block.className = "estack-v2-protection-module";
        const label = document.createElement("strong");
        label.textContent = "HARD LIMIT";
        block.append(label, estackV2Knob({
            label: "CEILING",
            value: Number(p.clip_limit ?? -3),
            min: -60,
            max: 0,
            step: .1,
            unit: "dBFS",
            resetValue: Number(p.clip_limit ?? -3),
            preview: null,
            commit: locked ? null : async next => {
                p.clip_limit = Math.round(next * 10) / 10;
                await safeUpload(`${channelName()} limiter threshold`);
                renderAll(false);
            }
        }, locked));
        block.title = name;
        protectionBody.appendChild(block);
    }

    for (const [name, processor] of getProcessorEntries()) {
        const p = processor?.parameters || {};
        const block = document.createElement("div");
        block.className = "estack-v2-protection-module estack-v2-dynamics";
        const title = document.createElement("strong");
        title.textContent = String(processor?.type || "DYNAMICS").toUpperCase();
        const grid = document.createElement("div");
        grid.className = "estack-v2-dynamics-grid";
        const values = [
            ["THRESH", p.threshold, "dB"],
            ["ATTACK", p.attack, "s"],
            ["RELEASE", p.release, "s"],
            ["RATIO", p.factor, ":1"]
        ];
        for (const [label, value, unit] of values) {
            if (value === undefined) continue;
            const item = document.createElement("div");
            item.innerHTML = `<span>${label}</span><strong>${Number(value).toFixed(label === "THRESH" ? 1 : 3)}${unit}</strong>`;
            grid.appendChild(item);
        }
        block.append(title, grid);
        block.title = name;
        protectionBody.appendChild(block);
    }

    if (!protectionBody.children.length) {
        const empty = document.createElement("div");
        empty.className = "estack-v2-empty";
        empty.textContent = "NO PROTECTION MODULE";
        protectionBody.appendChild(empty);
    }
    protectionCard.appendChild(protectionBody);

    consoleEl.append(outputCard, protectionCard);
    root.appendChild(consoleEl);
}

// Replace the four module tabs with the two views that match the actual E-Stack
// workflow. Crossover belongs inside EQ; Output and Protection belong together.
renderModuleTabs = function() {
    const root = document.getElementById("moduleTabs");
    root.replaceChildren();
    const tabs = [
        ["peq", "EQ"],
        [ESTACK_V2_OUTPUT_MODULE, "OUTPUT / PROTECTION"]
    ];
    for (const [module, label] of tabs) {
        const button = document.createElement("button");
        button.dataset.module = module;
        button.textContent = label;
        button.classList.toggle("active", activeModule === module);
        button.onclick = () => {
            activeModule = module;
            renderAll(false);
        };
        root.appendChild(button);
    }
};

renderHeader = function() {
    document.getElementById("selectedChannelTitle").textContent = channelName();
    document.getElementById("selectedChannelMeta").textContent = `OUT ${selectedChannel + 1}`;
    document.getElementById("moduleTitle").textContent = activeModule === "peq" ? "Parametric EQ" : "Output / Protection";
    document.getElementById("moduleSubtitle").textContent = "";
    const edit = document.getElementById("systemEditToggle");
    edit.setAttribute("aria-pressed", String(systemEditEnabled));
    edit.textContent = systemEditEnabled ? "EDITING SYSTEM" : "EDIT SYSTEM";
};

renderBandSelector = function() {
    const root = document.getElementById("bandSelector");
    root.replaceChildren();
    root.classList.add("estack-peq-hidden-selector");
};

renderControls = function() {
    const root = document.getElementById("moduleControls");
    root.classList.remove("estack-peq-rack-mode", "estack-v2-output-mode");
    root.replaceChildren();
    if (activeModule === "peq") estackRenderPeqRack(root);
    else estackV2RenderOutputProtection(root);
};

const estackV2OriginalGraphRange = graphRange;
graphRange = function() {
    if (activeModule === ESTACK_V2_OUTPUT_MODULE) return { min: -60, max: 6, step: 10 };
    return estackV2OriginalGraphRange();
};

// PEQ points now represent the parameters the user edits: X = band frequency,
// Y = band gain. This makes the graph directly manipulable like a DAW EQ.
estackDrawPeqMarkers = function() {
    if (activeModule !== "peq" || !DSP) return;
    const canvas = document.getElementById("responseCanvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const margin = { left: 50, right: 18, top: 18, bottom: 31 };
    const innerW = rect.width - margin.left - margin.right;
    const innerH = rect.height - margin.top - margin.bottom;
    const range = graphRange();
    const slots = mapPeqSlots();

    for (let slot = 0; slot < ESTACK_PEQ_COUNT; slot++) {
        const entry = slots[slot];
        const p = entry?.[1]?.parameters || {};
        const freq = Number(p.freq || ESTACK_PEQ_DEFAULT_FREQS[slot]);
        const gain = Number(p.gain || 0);
        const x = margin.left + freqToX(clamp(freq, 20, 20000), innerW);
        const y = margin.top + dbToY(clamp(gain, range.min, range.max), innerH, range);
        const selected = slot === selectedPeqSlot;
        const enabled = !!entry && !estackPeqIsDisabled(selectedChannel, slot);

        ctx.beginPath();
        ctx.arc(x, y, selected ? 11 : 8.5, 0, Math.PI * 2);
        ctx.fillStyle = selected ? estackPeqBandColor(slot) : enabled ? "rgba(18,22,24,.96)" : "rgba(24,27,28,.78)";
        ctx.fill();
        ctx.lineWidth = selected ? 2.4 : 1.6;
        ctx.strokeStyle = enabled ? estackPeqBandColor(slot) : "rgba(220,225,228,.30)";
        ctx.stroke();
        if (selected) {
            ctx.shadowColor = estackPeqBandColor(slot);
            ctx.shadowBlur = 10;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        ctx.fillStyle = selected ? "#0d1112" : "rgba(248,250,250,.92)";
        ctx.font = `${selected ? "bold " : ""}11px Abel, Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(slot + 1), x, y + .5);
    }
    ctx.restore();
};

function estackV2PointPositions() {
    const canvas = document.getElementById("responseCanvas");
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 50, right: 18, top: 18, bottom: 31 };
    const innerW = rect.width - margin.left - margin.right;
    const innerH = rect.height - margin.top - margin.bottom;
    const range = graphRange();
    return mapPeqSlots().map((entry, slot) => {
        if (!entry) return null;
        const p = entry[1]?.parameters || {};
        const freq = Number(p.freq || ESTACK_PEQ_DEFAULT_FREQS[slot]);
        const gain = Number(p.gain || 0);
        return {
            slot,
            entry,
            x: margin.left + freqToX(clamp(freq, 20, 20000), innerW),
            y: margin.top + dbToY(clamp(gain, range.min, range.max), innerH, range)
        };
    }).filter(Boolean);
}

function estackV2PointerToParams(event) {
    const canvas = document.getElementById("responseCanvas");
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 50, right: 18, top: 18, bottom: 31 };
    const innerW = rect.width - margin.left - margin.right;
    const innerH = rect.height - margin.top - margin.bottom;
    const range = graphRange();
    const localX = clamp(event.clientX - rect.left - margin.left, 0, innerW);
    const localY = clamp(event.clientY - rect.top - margin.top, 0, innerH);
    const freq = typeof estackSpectrumXToFreq === "function"
        ? estackSpectrumXToFreq(localX, innerW)
        : 20 * Math.pow(1000, localX / Math.max(1, innerW));
    const gain = range.max - (localY / Math.max(1, innerH)) * (range.max - range.min);
    return {
        freq: Math.round(clamp(freq, 20, 20000)),
        gain: Math.round(clamp(gain, ESTACK_PEQ_GAIN_MIN, ESTACK_PEQ_GAIN_MAX) * 10) / 10
    };
}

function estackV2InstallGraphDrag() {
    const canvas = document.getElementById("responseCanvas");
    if (!canvas || canvas.dataset.estackV2Drag === "true") return;
    canvas.dataset.estackV2Drag = "true";

    canvas.addEventListener("pointerdown", event => {
        if (activeModule !== "peq" || event.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let best = null;
        for (const point of estackV2PointPositions()) {
            const distance = Math.hypot(x - point.x, y - point.y);
            if (!best || distance < best.distance) best = { ...point, distance };
        }
        if (!best || best.distance > 18) return;

        event.preventDefault();
        selectedPeqSlot = best.slot;
        estackV2Drag = { slot: best.slot, entry: best.entry, startX: x, startY: y, moved: false };
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add("estack-v2-dragging");
        drawGraph();
    });

    canvas.addEventListener("pointermove", event => {
        if (!estackV2Drag || activeModule !== "peq") return;
        const params = estackV2PointerToParams(event);
        const p = estackV2Drag.entry[1].parameters || (estackV2Drag.entry[1].parameters = {});
        p.freq = params.freq;
        p.gain = params.gain;
        estackV2Drag.moved = true;
        estackPeqSetDisabled(selectedChannel, estackV2Drag.slot, false);
        estackPeqStoreGain(selectedChannel, estackV2Drag.slot, params.gain);
        drawGraph();
    });

    const finish = async event => {
        if (!estackV2Drag) return;
        const drag = estackV2Drag;
        estackV2Drag = null;
        canvas.classList.remove("estack-v2-dragging");
        try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
        if (drag.moved) {
            estackV2SuppressClick = true;
            await safeUpload(`${channelName()} PEQ ${drag.slot + 1} graph move`);
            renderAll(false);
        }
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);

    canvas.addEventListener("click", event => {
        if (!estackV2SuppressClick) return;
        estackV2SuppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
}

// Higher-contrast grid while retaining the selectable frequency zoom provided by
// the spectrum layer.
drawGrid = function(ctx, margin, innerW, innerH, range) {
    ctx.save();
    ctx.font = "10px Abel, Arial, sans-serif";
    ctx.lineWidth = 1;
    const [minFreq, maxFreq] = typeof estackSpectrumViewRange === "function" ? estackSpectrumViewRange() : [20, 20000];
    const ticks = (typeof ESTACK_SPECTRUM_GRID_FREQS !== "undefined" ? ESTACK_SPECTRUM_GRID_FREQS : [20,40,80,160,315,630,1250,2500,5000,10000,20000])
        .filter(freq => freq >= minFreq && freq <= maxFreq);
    let lastLabelX = -Infinity;

    for (const freq of ticks) {
        const x = margin.left + freqToX(freq, innerW);
        const major = [20,40,80,160,315,630,1250,2500,5000,10000,20000].includes(freq);
        ctx.strokeStyle = major ? "rgba(225,232,235,.22)" : "rgba(225,232,235,.09)";
        ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + innerH); ctx.stroke();
        if (x - lastLabelX >= 42 || freq === ticks[0] || freq === ticks[ticks.length - 1]) {
            ctx.fillStyle = major ? "rgba(242,246,247,.72)" : "rgba(228,234,236,.48)";
            ctx.textAlign = freq === ticks[0] ? "left" : freq === ticks[ticks.length - 1] ? "right" : "center";
            ctx.fillText(typeof estackSpectrumFormatFreq === "function" ? estackSpectrumFormatFreq(freq) : String(freq), x, margin.top + innerH + 18);
            lastLabelX = x;
        }
    }

    for (let db = Math.ceil(range.min / range.step) * range.step; db <= range.max; db += range.step) {
        const y = margin.top + dbToY(db, innerH, range);
        ctx.strokeStyle = db === 0 ? "rgba(245,248,249,.44)" : "rgba(225,232,235,.14)";
        ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + innerW, y); ctx.stroke();
        ctx.fillStyle = db === 0 ? "rgba(250,252,252,.78)" : "rgba(235,240,241,.52)";
        ctx.textAlign = "right";
        ctx.fillText(`${db}`, margin.left - 7, y + 4);
    }
    ctx.restore();
};

// Start directly on EQ; legacy saved/module state is normalized to the two-view
// model before the page's DOMContentLoaded render runs.
if (activeModule === "crossover" || activeModule === "output" || activeModule === "protection") activeModule = "peq";
document.addEventListener("DOMContentLoaded", estackV2InstallGraphDrag);
