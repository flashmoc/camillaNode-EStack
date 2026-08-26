// Wondom-style PEQ editor for E-Stack.
// Keeps the global six-way response graph, but replaces the PEQ module editor
// with HPF/LPF blocks on the left and ten always-visible PEQ strips.

const ESTACK_PEQ_COUNT = 10;
const ESTACK_PEQ_DEFAULT_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const ESTACK_PEQ_DEFAULT_Q = 0.7;
const ESTACK_PEQ_GAIN_MIN = -20;
const ESTACK_PEQ_GAIN_MAX = 20;

function estackPeqDisabledKey(channel, slot) {
    return `estack.peq.disabled.${channel}.${slot}`;
}

function estackPeqStoredGainKey(channel, slot) {
    return `estack.peq.lastgain.${channel}.${slot}`;
}

function estackPeqIsDisabled(channel, slot) {
    return window.localStorage.getItem(estackPeqDisabledKey(channel, slot)) === "true";
}

function estackPeqSetDisabled(channel, slot, disabled) {
    window.localStorage.setItem(estackPeqDisabledKey(channel, slot), String(!!disabled));
}

function estackPeqStoreGain(channel, slot, gain) {
    window.localStorage.setItem(estackPeqStoredGainKey(channel, slot), String(Number(gain) || 0));
}

function estackPeqStoredGain(channel, slot) {
    const value = Number(window.localStorage.getItem(estackPeqStoredGainKey(channel, slot)));
    return Number.isFinite(value) ? value : 0;
}

// Replace the legacy 8-slot mapper with ten stable slots.
mapPeqSlots = function() {
    const slots = Array(ESTACK_PEQ_COUNT).fill(null);
    const entries = getPeqEntries();
    const leftovers = [];

    for (const entry of entries) {
        const match = String(entry[0]).match(/_PEQ_(\d{2})$/);
        if (match) {
            const index = Number(match[1]) - 1;
            if (index >= 0 && index < ESTACK_PEQ_COUNT && !slots[index]) {
                slots[index] = entry;
                continue;
            }
        }
        leftovers.push(entry);
    }

    leftovers.sort((a, b) => Number(a[1]?.parameters?.freq || 0) - Number(b[1]?.parameters?.freq || 0));
    for (const entry of leftovers) {
        const empty = slots.findIndex(value => !value);
        if (empty < 0) break;
        slots[empty] = entry;
    }
    return slots;
};

function estackEnsurePeqEntry(slot) {
    const slots = mapPeqSlots();
    if (slots[slot]) return slots[slot];

    const name = `USER_CH${selectedChannel}_PEQ_${String(slot + 1).padStart(2, "0")}`;
    const filter = {
        type: "Biquad",
        description: `E-Stack PEQ ${slot + 1} - ${channelName()}`,
        parameters: {
            type: "Peaking",
            freq: ESTACK_PEQ_DEFAULT_FREQS[slot],
            gain: 0,
            q: ESTACK_PEQ_DEFAULT_Q
        }
    };
    DSP.addFilter({ [name]: filter }, selectedChannel);
    return [name, filter];
}

createPeqBand = async function(slot) {
    const entry = estackEnsurePeqEntry(slot);
    estackPeqSetDisabled(selectedChannel, slot, false);
    selectedPeqSlot = slot;
    await safeUpload(`${channelName()} PEQ ${slot + 1} enabled`);
    renderAll(false);
    return entry;
};

function estackPeqFamily(parameters) {
    return String(parameters?.type || "").startsWith("Butterworth") ? "Butterworth" : "LinkwitzRiley";
}

function estackPeqSlope(parameters) {
    return Math.max(6, Number(parameters?.order || 4) * 6);
}

function estackPeqMakeSelect(values, current, disabled, onChange, formatter = value => value) {
    const select = document.createElement("select");
    select.disabled = disabled;
    for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = formatter(value);
        select.appendChild(option);
    }
    select.value = current;
    select.addEventListener("change", () => onChange(select.value));
    return select;
}

function estackPeqMakeNumber(value, min, max, step, disabled, onCommit) {
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = step;
    input.disabled = disabled;
    input.addEventListener("change", async () => {
        const next = clamp(Number(input.value), min, max);
        input.value = next;
        await onCommit(next);
    });
    return input;
}

function estackRenderPeqCrossover(kind) {
    const entry = getCrossover(kind);
    const card = document.createElement("section");
    card.className = "estack-peq-xover-card";

    const title = document.createElement("div");
    title.className = "estack-peq-xover-title";
    title.innerHTML = `<strong>${kind === "hpf" ? "HIGH PASS FILTER" : "LOW PASS FILTER"}</strong><span>${systemEditEnabled ? "EDIT" : "LOCKED"}</span>`;
    card.appendChild(title);

    if (!entry) {
        const empty = document.createElement("div");
        empty.className = "estack-peq-xover-empty";
        empty.textContent = "Not configured on this output";
        card.appendChild(empty);
        return card;
    }

    const [name, filter] = entry;
    const p = filter.parameters || {};
    const rows = document.createElement("div");
    rows.className = "estack-peq-xover-rows";

    const addRow = (label, control) => {
        const row = document.createElement("label");
        row.innerHTML = `<span>${label}</span>`;
        row.appendChild(control);
        rows.appendChild(row);
    };

    addRow("TYPE", estackPeqMakeSelect(["LinkwitzRiley", "Butterworth"], estackPeqFamily(p), !systemEditEnabled, async value => {
        p.type = `${value}${kind === "hpf" ? "Highpass" : "Lowpass"}`;
        await safeUpload(`${channelName()} ${kind.toUpperCase()} type`);
        renderAll(false);
    }, value => value === "LinkwitzRiley" ? "LINKWITZ-RILEY" : "BUTTERWORTH"));

    addRow("FREQ (Hz)", estackPeqMakeNumber(Number(p.freq || 100), 16, 20000, 1, !systemEditEnabled, async value => {
        p.freq = Math.round(value * 10) / 10;
        await safeUpload(`${channelName()} ${kind.toUpperCase()} frequency`);
        renderAll(false);
    }));

    addRow("SLOPE", estackPeqMakeSelect([12, 24, 36, 48], estackPeqSlope(p), !systemEditEnabled, async value => {
        p.order = Number(value) / 6;
        await safeUpload(`${channelName()} ${kind.toUpperCase()} slope`);
        renderAll(false);
    }, value => `${value} dB/Oct`));

    const foot = document.createElement("small");
    foot.textContent = name;
    card.append(rows, foot);
    return card;
}

function estackPeqBandColor(slot) {
    const hue = [12, 35, 58, 82, 112, 160, 195, 220, 270, 325][slot] ?? 165;
    return `hsl(${hue}, 68%, 58%)`;
}

async function estackCommitPeqValue(slot, key, value) {
    const [, filter] = estackEnsurePeqEntry(slot);
    const p = filter.parameters || (filter.parameters = {});
    if (key === "freq") p.freq = Math.round(Number(value) * 10) / 10;
    else if (key === "gain") p.gain = Math.round(Number(value) * 10) / 10;
    else if (key === "q") p.q = Math.round(Number(value) * 100) / 100;
    else if (key === "type") p.type = value;

    estackPeqSetDisabled(selectedChannel, slot, false);
    if (key === "gain") estackPeqStoreGain(selectedChannel, slot, p.gain);
    selectedPeqSlot = slot;
    await safeUpload(`${channelName()} PEQ ${slot + 1} ${key}`);
    renderAll(false);
}

async function estackTogglePeq(slot) {
    const slots = mapPeqSlots();
    const entry = slots[slot];
    const disabled = estackPeqIsDisabled(selectedChannel, slot);

    if (!entry) {
        await createPeqBand(slot);
        return;
    }

    const p = entry[1].parameters || (entry[1].parameters = {});
    if (!disabled) {
        estackPeqStoreGain(selectedChannel, slot, Number(p.gain || 0));
        p.gain = 0;
        estackPeqSetDisabled(selectedChannel, slot, true);
        await safeUpload(`${channelName()} PEQ ${slot + 1} bypassed`);
    } else {
        p.gain = estackPeqStoredGain(selectedChannel, slot);
        estackPeqSetDisabled(selectedChannel, slot, false);
        await safeUpload(`${channelName()} PEQ ${slot + 1} enabled`);
    }
    selectedPeqSlot = slot;
    renderAll(false);
}

async function estackResetPeq(slot) {
    const [, filter] = estackEnsurePeqEntry(slot);
    filter.parameters = {
        type: "Peaking",
        freq: ESTACK_PEQ_DEFAULT_FREQS[slot],
        gain: 0,
        q: ESTACK_PEQ_DEFAULT_Q
    };
    estackPeqStoreGain(selectedChannel, slot, 0);
    estackPeqSetDisabled(selectedChannel, slot, false);
    selectedPeqSlot = slot;
    await safeUpload(`${channelName()} PEQ ${slot + 1} reset`);
    renderAll(false);
}

function estackRenderPeqStrip(slot, entry) {
    const enabled = !!entry && !estackPeqIsDisabled(selectedChannel, slot);
    const p = entry?.[1]?.parameters || {};
    const freq = Number(p.freq || ESTACK_PEQ_DEFAULT_FREQS[slot]);
    const gain = Number(p.gain || 0);
    const q = Number(p.q || ESTACK_PEQ_DEFAULT_Q);

    const strip = document.createElement("article");
    strip.className = "estack-peq-strip";
    strip.classList.toggle("selected", slot === selectedPeqSlot);
    strip.classList.toggle("disabled", !enabled);
    strip.style.setProperty("--peq-color", estackPeqBandColor(slot));

    const head = document.createElement("button");
    head.className = "estack-peq-strip-head";
    head.type = "button";
    head.innerHTML = `<strong>${slot + 1}</strong><span>${enabled ? "ON" : "OFF"}</span>`;
    head.addEventListener("click", () => {
        selectedPeqSlot = slot;
        renderAll(false);
    });

    const enable = document.createElement("button");
    enable.type = "button";
    enable.className = "estack-peq-enable";
    enable.classList.toggle("active", enabled);
    enable.textContent = enabled ? "ENABLED" : "ENABLE";
    enable.addEventListener("click", () => estackTogglePeq(slot));

    const faderWrap = document.createElement("div");
    faderWrap.className = "estack-peq-gain-wrap";
    const gainSlider = document.createElement("input");
    gainSlider.type = "range";
    gainSlider.className = "estack-peq-gain-slider";
    gainSlider.min = ESTACK_PEQ_GAIN_MIN;
    gainSlider.max = ESTACK_PEQ_GAIN_MAX;
    gainSlider.step = .1;
    gainSlider.value = gain;
    gainSlider.disabled = !enabled;
    const zero = document.createElement("i");
    zero.className = "estack-peq-zero";
    faderWrap.append(gainSlider, zero);

    const gainReadout = document.createElement("output");
    gainReadout.className = "estack-peq-gain-readout";
    gainReadout.textContent = `${gain.toFixed(1)} dB`;

    gainSlider.addEventListener("input", () => {
        const next = Number(gainSlider.value);
        gainReadout.textContent = `${next.toFixed(1)} dB`;
        if (entry) {
            entry[1].parameters.gain = next;
            drawGraph();
        }
    });
    gainSlider.addEventListener("change", () => estackCommitPeqValue(slot, "gain", Number(gainSlider.value)));

    const fields = document.createElement("div");
    fields.className = "estack-peq-fields";

    const makeField = (labelText, value, min, max, step, key) => {
        const label = document.createElement("label");
        label.innerHTML = `<span>${labelText}</span>`;
        const input = estackPeqMakeNumber(value, min, max, step, false, async next => {
            await estackCommitPeqValue(slot, key, next);
        });
        label.appendChild(input);
        fields.appendChild(label);
    };

    makeField("FREQ", Math.round(freq * 10) / 10, 20, 20000, 1, "freq");
    makeField("GAIN", Math.round(gain * 10) / 10, ESTACK_PEQ_GAIN_MIN, ESTACK_PEQ_GAIN_MAX, .1, "gain");
    makeField("Q", Math.round(q * 100) / 100, .1, 20, .01, "q");

    const typeLabel = document.createElement("label");
    typeLabel.innerHTML = "<span>TYPE</span>";
    const type = estackPeqMakeSelect(["Peaking", "Lowshelf", "Highshelf"], p.type || "Peaking", false, value => estackCommitPeqValue(slot, "type", value), value => value === "Peaking" ? "BELL" : value === "Lowshelf" ? "LOW" : "HIGH");
    typeLabel.appendChild(type);
    fields.appendChild(typeLabel);

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "estack-peq-reset";
    reset.textContent = "RESET";
    reset.addEventListener("click", () => estackResetPeq(slot));

    strip.append(head, enable, faderWrap, gainReadout, fields, reset);
    return strip;
}

function estackRenderPeqRack(root) {
    root.classList.add("estack-peq-rack-mode");

    const console = document.createElement("div");
    console.className = "estack-peq-console";

    const xovers = document.createElement("aside");
    xovers.className = "estack-peq-xovers";
    xovers.append(estackRenderPeqCrossover("hpf"), estackRenderPeqCrossover("lpf"));

    const eq = document.createElement("section");
    eq.className = "estack-peq-equalizer";
    const eqHead = document.createElement("header");
    eqHead.className = "estack-peq-eq-head";
    eqHead.innerHTML = `<div><strong>EQUALIZER</strong><span>${channelName()} · ten parametric bands</span></div><small>Click a number to select · sliders edit gain · values can be typed below</small>`;

    const strips = document.createElement("div");
    strips.className = "estack-peq-strips";
    const slots = mapPeqSlots();
    for (let slot = 0; slot < ESTACK_PEQ_COUNT; slot++) strips.appendChild(estackRenderPeqStrip(slot, slots[slot]));

    eq.append(eqHead, strips);
    console.append(xovers, eq);
    root.appendChild(console);
}

const estackPeqOriginalBandSelector = renderBandSelector;
renderBandSelector = function() {
    const root = document.getElementById("bandSelector");
    if (activeModule === "peq") {
        root.replaceChildren();
        root.classList.add("estack-peq-hidden-selector");
        return;
    }
    root.classList.remove("estack-peq-hidden-selector");
    estackPeqOriginalBandSelector();
};

const estackPeqOriginalRenderControls = renderControls;
renderControls = function() {
    const root = document.getElementById("moduleControls");
    root.classList.remove("estack-peq-rack-mode");
    if (activeModule === "peq") {
        root.replaceChildren();
        estackRenderPeqRack(root);
        return;
    }
    estackPeqOriginalRenderControls();
};

const estackPeqOriginalRenderHeader = renderHeader;
renderHeader = function() {
    estackPeqOriginalRenderHeader();
    if (activeModule === "peq") {
        const subtitle = document.getElementById("moduleSubtitle");
        if (subtitle) subtitle.textContent = `All outputs · selected: ${channelName()} · PEQ 1–10`;
    }
};

function estackPeqResponseAt(freq) {
    const entries = filterEntries(selectedChannel).filter(([, filter]) => ["BiquadCombo", "Biquad", "Gain"].includes(filter?.type));
    return sumDb(entries, freq);
}

function estackDrawPeqMarkers() {
    if (activeModule !== "peq" || !DSP) return;
    const canvas = document.getElementById("responseCanvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;
    const margin = { left: 50, right: 18, top: 18, bottom: 31 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const range = { min: -60, max: 12, step: 10 };
    const slots = mapPeqSlots();

    for (let slot = 0; slot < ESTACK_PEQ_COUNT; slot++) {
        const entry = slots[slot];
        const freq = Number(entry?.[1]?.parameters?.freq || ESTACK_PEQ_DEFAULT_FREQS[slot]);
        const response = estackPeqResponseAt(freq);
        const x = margin.left + freqToX(clamp(freq, 20, 20000), innerW);
        const y = margin.top + dbToY(clamp(response, range.min, range.max), innerH, range);
        const selected = slot === selectedPeqSlot;
        const enabled = !!entry && !estackPeqIsDisabled(selectedChannel, slot);

        ctx.beginPath();
        ctx.arc(x, y, selected ? 10 : 8, 0, Math.PI * 2);
        ctx.fillStyle = selected ? "rgba(255,145,40,.96)" : enabled ? "rgba(52,62,68,.95)" : "rgba(43,49,52,.72)";
        ctx.fill();
        ctx.lineWidth = selected ? 2.5 : 1.4;
        ctx.strokeStyle = selected ? "#ffd0a0" : enabled ? estackPeqBandColor(slot) : "rgba(210,220,220,.32)";
        ctx.stroke();

        ctx.fillStyle = selected ? "#16191a" : enabled ? "#f2f4f4" : "rgba(235,240,240,.55)";
        ctx.font = `${selected ? "bold " : ""}11px Abel, Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(slot + 1), x, y + .5);
    }
    ctx.restore();
}

const estackPeqOriginalDrawGraph = drawGraph;
drawGraph = function() {
    estackPeqOriginalDrawGraph();
    estackDrawPeqMarkers();
};

// Clicking a numbered marker selects the same PEQ strip below.
document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("responseCanvas");
    if (!canvas) return;
    canvas.addEventListener("click", event => {
        if (activeModule !== "peq") return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const margin = { left: 50, right: 18, top: 18, bottom: 31 };
        const innerW = rect.width - margin.left - margin.right;
        const innerH = rect.height - margin.top - margin.bottom;
        const range = { min: -60, max: 12, step: 10 };
        const slots = mapPeqSlots();
        let best = null;

        for (let slot = 0; slot < ESTACK_PEQ_COUNT; slot++) {
            const freq = Number(slots[slot]?.[1]?.parameters?.freq || ESTACK_PEQ_DEFAULT_FREQS[slot]);
            const x = margin.left + freqToX(clamp(freq, 20, 20000), innerW);
            const y = margin.top + dbToY(clamp(estackPeqResponseAt(freq), range.min, range.max), innerH, range);
            const distance = Math.hypot(mouseX - x, mouseY - y);
            if (!best || distance < best.distance) best = { slot, distance };
        }

        if (best && best.distance <= 16) {
            selectedPeqSlot = best.slot;
            renderAll(false);
        }
    });
});
