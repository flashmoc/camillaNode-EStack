// Compact rotary PEQ workflow for E-Stack.
// Reuses the existing CamillaDSP-safe PEQ mutation functions, changing only the
// editor surface and analyzer presentation.

const ESTACK_EQ8_REFRESH_KEY = "estack.analyzer.refreshHz";
const ESTACK_EQ8_AVERAGE_KEY = "estack.analyzer.averageFrames";
let estackEq8RefreshHz = [10, 15, 20, 30].includes(Number(window.localStorage.getItem(ESTACK_EQ8_REFRESH_KEY)))
    ? Number(window.localStorage.getItem(ESTACK_EQ8_REFRESH_KEY))
    : 20;
let estackEq8AverageFrames = [1, 2, 4, 8, 16].includes(Number(window.localStorage.getItem(ESTACK_EQ8_AVERAGE_KEY)))
    ? Number(window.localStorage.getItem(ESTACK_EQ8_AVERAGE_KEY))
    : 2;
let estackEq8SpectrumBuffer = [];

function estackEq8Clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
}

function estackEq8Norm(value, min, max, logarithmic = false) {
    const v = estackEq8Clamp(value, min, max);
    if (logarithmic) return Math.log(v / min) / Math.log(max / min);
    return (v - min) / (max - min);
}

function estackEq8FromNorm(norm, min, max, logarithmic = false) {
    const t = estackEq8Clamp(norm, 0, 1);
    if (logarithmic) return min * Math.pow(max / min, t);
    return min + (max - min) * t;
}

function estackEq8Round(value, step) {
    const s = Number(step) || 1;
    return Math.round(Number(value) / s) * s;
}

function estackEq8MakeKnob({ label, value, min, max, step, logarithmic = false, unit = "", resetValue, preview, commit }) {
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

    let current = estackEq8Clamp(value, min, max);
    let dragStartY = 0;
    let dragStartNorm = 0;
    let dragging = false;
    let wheelCommitTimer;

    const render = () => {
        const norm = estackEq8Norm(current, min, max, logarithmic);
        const angle = -135 + norm * 270;
        knob.style.setProperty("--angle", `${angle}deg`);
        knob.setAttribute("aria-valuenow", String(current));
        number.value = step < 1 ? Number(current).toFixed(step <= .01 ? 2 : 1) : String(Math.round(current));
    };

    const setCurrent = (next, doPreview = true) => {
        current = estackEq8Clamp(estackEq8Round(next, step), min, max);
        render();
        if (doPreview && preview) preview(current);
    };

    const commitCurrent = async () => {
        if (commit) await commit(current);
    };

    knob.addEventListener("pointerdown", event => {
        event.preventDefault();
        dragging = true;
        dragStartY = event.clientY;
        dragStartNorm = estackEq8Norm(current, min, max, logarithmic);
        knob.setPointerCapture(event.pointerId);
    });

    knob.addEventListener("pointermove", event => {
        if (!dragging) return;
        const sensitivity = event.shiftKey ? 520 : 190;
        const nextNorm = dragStartNorm + (dragStartY - event.clientY) / sensitivity;
        setCurrent(estackEq8FromNorm(nextNorm, min, max, logarithmic));
    });

    const finishDrag = async event => {
        if (!dragging) return;
        dragging = false;
        try { knob.releasePointerCapture(event.pointerId); } catch (_) {}
        await commitCurrent();
    };
    knob.addEventListener("pointerup", finishDrag);
    knob.addEventListener("pointercancel", finishDrag);

    knob.addEventListener("wheel", event => {
        event.preventDefault();
        const norm = estackEq8Norm(current, min, max, logarithmic);
        const amount = event.shiftKey ? .004 : .015;
        setCurrent(estackEq8FromNorm(norm + (event.deltaY < 0 ? amount : -amount), min, max, logarithmic));
        clearTimeout(wheelCommitTimer);
        wheelCommitTimer = setTimeout(commitCurrent, 220);
    }, { passive: false });

    knob.addEventListener("keydown", event => {
        if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") setCurrent(min);
        else if (event.key === "End") setCurrent(max);
        else {
            const norm = estackEq8Norm(current, min, max, logarithmic);
            const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1;
            setCurrent(estackEq8FromNorm(norm + direction * (event.shiftKey ? .004 : .015), min, max, logarithmic));
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

function estackEq8QControl(slot, entry, q) {
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
    slider.value = Math.round(estackEq8Norm(q, .1, 20, true) * 1000);

    const qFromSlider = () => {
        const next = estackEq8FromNorm(Number(slider.value) / 1000, .1, 20, true);
        return Math.round(next * 100) / 100;
    };

    slider.addEventListener("input", () => {
        const next = qFromSlider();
        readout.textContent = next.toFixed(2);
        if (entry) {
            entry[1].parameters.q = next;
            drawGraph();
        }
    });
    slider.addEventListener("change", () => estackCommitPeqValue(slot, "q", qFromSlider()));

    root.append(head, slider);
    return root;
}

function estackEq8TypeControl(slot, current) {
    const root = document.createElement("div");
    root.className = "estack-eq8-type";
    const types = [
        ["Peaking", "BELL"],
        ["Lowshelf", "LOW"],
        ["Highshelf", "HIGH"]
    ];
    for (const [value, label] of types) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.classList.toggle("active", (current || "Peaking") === value);
        button.addEventListener("click", () => estackCommitPeqValue(slot, "type", value));
        root.appendChild(button);
    }
    return root;
}

// Replace the tall fader editor with a compact rotary strip.
estackRenderPeqStrip = function(slot, entry) {
    const enabled = !!entry && !estackPeqIsDisabled(selectedChannel, slot);
    const p = entry?.[1]?.parameters || {};
    const freq = Number(p.freq || ESTACK_PEQ_DEFAULT_FREQS[slot]);
    const gain = Number(p.gain || 0);
    const q = Number(p.q || ESTACK_PEQ_DEFAULT_Q);

    const strip = document.createElement("article");
    strip.className = "estack-peq-strip estack-eq8-strip";
    strip.classList.toggle("selected", slot === selectedPeqSlot);
    strip.classList.toggle("disabled", !enabled);
    strip.style.setProperty("--peq-color", estackPeqBandColor(slot));

    const head = document.createElement("button");
    head.className = "estack-peq-strip-head";
    head.type = "button";
    head.innerHTML = `<strong>${slot + 1}</strong>`;
    head.addEventListener("click", () => {
        selectedPeqSlot = slot;
        renderAll(false);
    });

    const power = document.createElement("button");
    power.type = "button";
    power.className = "estack-eq8-on";
    power.classList.toggle("active", enabled);
    power.title = enabled ? "Disable band" : "Enable band";
    power.setAttribute("aria-label", power.title);
    power.addEventListener("click", event => {
        event.stopPropagation();
        estackTogglePeq(slot);
    });
    head.appendChild(power);

    const controls = document.createElement("div");
    controls.className = "estack-eq8-controls";

    controls.appendChild(estackEq8MakeKnob({
        label: "FREQ",
        value: freq,
        min: 20,
        max: 20000,
        step: 1,
        logarithmic: true,
        unit: "Hz",
        resetValue: ESTACK_PEQ_DEFAULT_FREQS[slot],
        preview: next => {
            if (!entry) return;
            entry[1].parameters.freq = next;
            drawGraph();
        },
        commit: next => estackCommitPeqValue(slot, "freq", next)
    }));

    controls.appendChild(estackEq8MakeKnob({
        label: "GAIN",
        value: gain,
        min: ESTACK_PEQ_GAIN_MIN,
        max: ESTACK_PEQ_GAIN_MAX,
        step: .1,
        unit: "dB",
        resetValue: 0,
        preview: next => {
            if (!entry) return;
            entry[1].parameters.gain = next;
            drawGraph();
        },
        commit: next => estackCommitPeqValue(slot, "gain", next)
    }));

    controls.appendChild(estackEq8QControl(slot, entry, q));
    controls.appendChild(estackEq8TypeControl(slot, p.type || "Peaking"));

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "estack-eq8-reset";
    reset.textContent = "RESET";
    reset.addEventListener("click", () => estackResetPeq(slot));

    strip.append(head, controls, reset);
    return strip;
};

function estackEq8MakeSelect(values, current, onChange, formatter = value => value) {
    const select = document.createElement("select");
    for (const value of values) {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = formatter(value);
        select.appendChild(option);
    }
    select.value = String(current);
    select.addEventListener("change", () => onChange(select.value));
    return select;
}

function estackEq8AnalyzerPanel() {
    const panel = document.createElement("aside");
    panel.className = "estack-eq8-analyzer";

    const head = document.createElement("div");
    head.className = "estack-eq8-analyzer-head";
    head.innerHTML = `<strong>ANALYZER</strong><i class="estack-eq8-analyzer-led"></i>`;

    const refreshRow = document.createElement("label");
    refreshRow.className = "estack-eq8-analyzer-row";
    refreshRow.innerHTML = "<span>REFRESH</span>";
    refreshRow.appendChild(estackEq8MakeSelect([10, 15, 20, 30], estackEq8RefreshHz, value => {
        estackEq8RefreshHz = Number(value);
        window.localStorage.setItem(ESTACK_EQ8_REFRESH_KEY, String(estackEq8RefreshHz));
        startSpectrum();
    }, value => `${value} Hz`));

    const averageRow = document.createElement("label");
    averageRow.className = "estack-eq8-analyzer-row";
    averageRow.innerHTML = "<span>AVERAGE</span>";
    averageRow.appendChild(estackEq8MakeSelect([1, 2, 4, 8, 16], estackEq8AverageFrames, value => {
        estackEq8AverageFrames = Number(value);
        window.localStorage.setItem(ESTACK_EQ8_AVERAGE_KEY, String(estackEq8AverageFrames));
        estackEq8SpectrumBuffer = [];
        startSpectrum();
    }, value => `${value} frame${Number(value) === 1 ? "" : "s"}`));

    const zoomRow = document.createElement("label");
    zoomRow.className = "estack-eq8-analyzer-row";
    zoomRow.innerHTML = "<span>VIEW</span>";
    zoomRow.appendChild(estackEq8MakeSelect(["full", "sub", "low", "mid", "high"], estackSpectrumView, value => {
        estackSetSpectrumView(value);
    }, value => String(value).toUpperCase()));

    const modes = document.createElement("div");
    modes.className = "estack-eq8-analyzer-modes";
    for (const mode of ["raw", "fast", "slow"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = mode.toUpperCase();
        button.classList.toggle("active", estackSpectrumMode === mode);
        button.addEventListener("click", () => {
            estackSetSpectrumMode(mode);
            modes.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
        });
        modes.appendChild(button);
    }

    const resolution = document.createElement("div");
    resolution.className = "estack-eq8-resolution";
    resolution.innerHTML = `<strong>30 REAL BANDS</strong><br>Temporal detail is adjustable here; spectral resolution comes from the dedicated CamillaDSP analyzer on port 6413.`;

    panel.append(head, refreshRow, averageRow, zoomRow, modes, resolution);
    return panel;
}

estackRenderPeqRack = function(root) {
    root.classList.add("estack-peq-rack-mode");

    const consoleEl = document.createElement("div");
    consoleEl.className = "estack-peq-console estack-eq8-console";

    const xovers = document.createElement("aside");
    xovers.className = "estack-peq-xovers";
    xovers.append(estackRenderPeqCrossover("hpf"), estackRenderPeqCrossover("lpf"));

    const eq = document.createElement("section");
    eq.className = "estack-peq-equalizer";
    const eqHead = document.createElement("header");
    eqHead.className = "estack-peq-eq-head";
    eqHead.innerHTML = `<div><strong>PARAMETRIC EQ</strong><span>${channelName()} · 10 bands</span></div>`;

    const strips = document.createElement("div");
    strips.className = "estack-peq-strips";
    const slots = mapPeqSlots();
    for (let slot = 0; slot < ESTACK_PEQ_COUNT; slot++) {
        strips.appendChild(estackRenderPeqStrip(slot, slots[slot]));
    }

    eq.append(eqHead, strips);
    consoleEl.append(xovers, eq, estackEq8AnalyzerPanel());
    root.appendChild(consoleEl);
};

function estackEq8AverageSpectrumFrames(frames) {
    if (!frames.length) return [];
    return ESTACK_SPECTRUM_FREQS.map((_, index) => {
        let sum = 0;
        for (const frame of frames) sum += Math.pow(10, Number(frame[index] ?? ESTACK_SPECTRUM_MIN_DB) / 10);
        return 10 * Math.log10(Math.max(1e-12, sum / frames.length));
    });
}

// Analyzer refresh/averaging are real temporal sampling controls. Spatial
// resolution remains the 30 physical analyzer bands produced by the dedicated
// CamillaDSP spectrum instance.
startSpectrum = function() {
    if (spectrumTimer) clearInterval(spectrumTimer);
    estackEq8SpectrumBuffer = [];
    const interval = Math.max(30, Math.round(1000 / estackEq8RefreshHz));
    let busy = false;

    spectrumTimer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
            if (!DSP?.spectrum_connected) return;
            const levels = await DSP.getSpectrumData();
            if (!Array.isArray(levels)) return;

            const raw = ESTACK_SPECTRUM_FREQS.map((_, index) =>
                Math.max(ESTACK_SPECTRUM_MIN_DB, Math.min(ESTACK_SPECTRUM_MAX_DB, Number(levels[index * 2] ?? ESTACK_SPECTRUM_MIN_DB)))
            );

            estackEq8SpectrumBuffer.push(raw);
            while (estackEq8SpectrumBuffer.length > estackEq8AverageFrames) estackEq8SpectrumBuffer.shift();
            const averaged = estackEq8AverageSpectrumFrames(estackEq8SpectrumBuffer);

            const alpha = estackSpectrumMode === "raw" ? 1 : estackSpectrumMode === "fast" ? 0.82 : 0.24;
            if (estackSpectrumRealtime.length !== averaged.length || alpha >= 1) {
                estackSpectrumRealtime = averaged.slice();
            } else {
                estackSpectrumRealtime = averaged.map((value, index) =>
                    alpha * value + (1 - alpha) * estackSpectrumRealtime[index]
                );
            }

            if (estackSpectrumPowerSum.length !== raw.length) {
                estackSpectrumPowerSum = Array(raw.length).fill(0);
                estackSpectrumInfinite = Array(raw.length).fill(ESTACK_SPECTRUM_MIN_DB);
                estackSpectrumSamples = 0;
            }

            estackSpectrumSamples += 1;
            raw.forEach((value, index) => {
                estackSpectrumPowerSum[index] += Math.pow(10, value / 10);
                const meanPower = estackSpectrumPowerSum[index] / estackSpectrumSamples;
                estackSpectrumInfinite[index] = 10 * Math.log10(Math.max(1e-12, meanPower));
            });

            lastSpectrum = estackSpectrumRealtime.slice();
            drawGraph();
        } catch (_) {
        } finally {
            busy = false;
        }
    }, interval);
};
