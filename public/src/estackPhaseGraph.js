// E-Stack theoretical DSP phase display and XO Align mode.
// Loaded last on Output Processing so it can decorate the established V4 graph
// without replacing the existing magnitude/EQ editor.

(function installEStackPhaseGraph() {
    const MODE_KEY = "estack.output.graphMode";
    const PAIR_KEY = "estack.output.xoPair";
    const VALID_MODES = new Set(["magnitude", "phase", "xo"]);
    let graphMode = VALID_MODES.has(localStorage.getItem(MODE_KEY)) ? localStorage.getItem(MODE_KEY) : "magnitude";
    let selectedPairKey = localStorage.getItem(PAIR_KEY) || "sub-kick";

    const baseDrawGraph = typeof drawGraph === "function" ? drawGraph : null;

    const XO_PAIR_DEFS = [
        { key: "sub-kick", lower: 0, upper: 1 },
        { key: "kick-mid-l", lower: 1, upper: 2 },
        { key: "kick-mid-r", lower: 1, upper: 3 },
        { key: "mid-high-l", lower: 2, upper: 4 },
        { key: "mid-high-r", lower: 3, upper: 5 }
    ];

    const TWO_PI = Math.PI * 2;

    function c(re = 0, im = 0) { return { re, im }; }
    function cMul(a, b) { return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
    function cDiv(a, b) {
        const den = b.re * b.re + b.im * b.im || 1e-30;
        return c((a.re * b.re + a.im * b.im) / den, (a.im * b.re - a.re * b.im) / den);
    }
    function cAbs(a) { return Math.hypot(a.re, a.im); }
    function cPhaseDeg(a) { return Math.atan2(a.im, a.re) * 180 / Math.PI; }
    function polar(deg, magnitude = 1) {
        const rad = Number(deg) * Math.PI / 180;
        return c(magnitude * Math.cos(rad), magnitude * Math.sin(rad));
    }
    function wrapPhase(deg) {
        let value = Number(deg) % 360;
        if (value > 180) value -= 360;
        if (value <= -180) value += 360;
        return value;
    }

    function samplerate() {
        return Math.max(8000, Number(DSP?.config?.devices?.samplerate || 48000));
    }

    function normalizeCoeffs(a0, a1, a2, b0, b1, b2) {
        const safe = Math.abs(a0) > 1e-20 ? a0 : 1;
        return { a1: a1 / safe, a2: a2 / safe, b0: b0 / safe, b1: b1 / safe, b2: b2 / safe };
    }

    function responseFromCoeffs(coeffs, freq, fs = samplerate()) {
        const w = TWO_PI * Number(freq) / fs;
        const z1 = c(Math.cos(w), -Math.sin(w));
        const z2 = c(Math.cos(2 * w), -Math.sin(2 * w));
        const num = c(
            coeffs.b0 + coeffs.b1 * z1.re + coeffs.b2 * z2.re,
            coeffs.b1 * z1.im + coeffs.b2 * z2.im
        );
        const den = c(
            1 + coeffs.a1 * z1.re + coeffs.a2 * z2.re,
            coeffs.a1 * z1.im + coeffs.a2 * z2.im
        );
        return cDiv(num, den);
    }

    function secondOrderPassCoeffs(kind, fc, q, fs = samplerate()) {
        const omega = TWO_PI * Number(fc) / fs;
        const sn = Math.sin(omega);
        const cs = Math.cos(omega);
        const alpha = sn / (2 * Math.max(1e-6, Number(q)));
        const a0 = 1 + alpha;
        const a1 = -2 * cs;
        const a2 = 1 - alpha;
        if (kind === "highpass") {
            return normalizeCoeffs(a0, a1, a2, (1 + cs) / 2, -(1 + cs), (1 + cs) / 2);
        }
        return normalizeCoeffs(a0, a1, a2, (1 - cs) / 2, 1 - cs, (1 - cs) / 2);
    }

    function firstOrderPassCoeffs(kind, fc, fs = samplerate()) {
        const omega = TWO_PI * Number(fc) / fs;
        const k = Math.tan(omega / 2);
        const alpha = 1 + k;
        if (kind === "highpass") {
            return { a1: -(1 - k) / alpha, a2: 0, b0: 1 / alpha, b1: -1 / alpha, b2: 0 };
        }
        return { a1: -(1 - k) / alpha, a2: 0, b0: k / alpha, b1: k / alpha, b2: 0 };
    }

    function butterworthQ(order) {
        const n = Math.max(1, Math.round(Number(order) || 1));
        const values = [];
        const secondOrderCount = Math.floor(n / 2);
        for (let i = 0; i < secondOrderCount; i++) {
            values.push(1 / (2 * Math.sin(Math.PI / n * (i + 0.5))));
        }
        if (n % 2) values.push(-1);
        return values;
    }

    function linkwitzRileyQ(order) {
        const n = Math.max(2, Math.round(Number(order) || 4));
        let temp = butterworthQ(n / 2);
        if (n % 4 !== 0) {
            temp = temp.slice(0, -1);
            return temp.concat(temp, [0.5]);
        }
        return temp.concat(temp);
    }

    function comboResponse(parameters, freq) {
        const p = parameters || {};
        const type = String(p.type || "");
        const lower = type.toLowerCase();
        if (!lower.includes("highpass") && !lower.includes("lowpass")) return c(1, 0);
        const kind = lower.includes("highpass") ? "highpass" : "lowpass";
        const order = Math.max(1, Math.round(Number(p.order || 4)));
        const qs = lower.startsWith("linkwitzriley") ? linkwitzRileyQ(order) : butterworthQ(order);
        let total = c(1, 0);
        for (const q of qs) {
            const coeffs = q < 0
                ? firstOrderPassCoeffs(kind, Number(p.freq || 1000))
                : secondOrderPassCoeffs(kind, Number(p.freq || 1000), q);
            total = cMul(total, responseFromCoeffs(coeffs, freq));
        }
        return total;
    }

    function biquadCoeffs(parameters) {
        const p = parameters || {};
        const type = String(p.type || "Peaking");
        const fs = samplerate();
        const f0 = Math.max(1, Math.min(fs / 2 - 1, Number(p.freq || 1000)));
        const omega = TWO_PI * f0 / fs;
        const sn = Math.sin(omega);
        const cs = Math.cos(omega);
        const q = Math.max(0.01, Number(p.q || 1));
        const gain = Number(p.gain || 0);
        const A = Math.pow(10, gain / 40);

        if (type === "Free") {
            return { a1: Number(p.a1 || 0), a2: Number(p.a2 || 0), b0: Number(p.b0 ?? 1), b1: Number(p.b1 || 0), b2: Number(p.b2 || 0) };
        }
        if (type === "Highpass") return secondOrderPassCoeffs("highpass", f0, q, fs);
        if (type === "Lowpass") return secondOrderPassCoeffs("lowpass", f0, q, fs);
        if (type === "HighpassFO") return firstOrderPassCoeffs("highpass", f0, fs);
        if (type === "LowpassFO") return firstOrderPassCoeffs("lowpass", f0, fs);

        if (type === "Peaking") {
            const alpha = sn / (2 * q);
            return normalizeCoeffs(
                1 + alpha / A, -2 * cs, 1 - alpha / A,
                1 + alpha * A, -2 * cs, 1 - alpha * A
            );
        }

        if (type === "Lowshelf" || type === "Highshelf") {
            const beta = sn * Math.sqrt(A) / q;
            if (type === "Lowshelf") {
                return normalizeCoeffs(
                    (A + 1) + (A - 1) * cs + beta,
                    -2 * ((A - 1) + (A + 1) * cs),
                    (A + 1) + (A - 1) * cs - beta,
                    A * ((A + 1) - (A - 1) * cs + beta),
                    2 * A * ((A - 1) - (A + 1) * cs),
                    A * ((A + 1) - (A - 1) * cs - beta)
                );
            }
            return normalizeCoeffs(
                (A + 1) - (A - 1) * cs + beta,
                2 * ((A - 1) - (A + 1) * cs),
                (A + 1) - (A - 1) * cs - beta,
                A * ((A + 1) + (A - 1) * cs + beta),
                -2 * A * ((A - 1) + (A + 1) * cs),
                A * ((A + 1) + (A - 1) * cs - beta)
            );
        }

        if (type === "Allpass") {
            const alpha = sn / (2 * q);
            return normalizeCoeffs(1 + alpha, -2 * cs, 1 - alpha, 1 - alpha, -2 * cs, 1 + alpha);
        }
        return null;
    }

    function allpassFoResponse(fc, freq) {
        const fs = samplerate();
        const design = Math.max(1, Math.min(fs / 2 - 1, Number(fc || 1000)));
        const f = Math.max(0.01, Math.min(fs / 2 - 1, Number(freq)));
        const denominator = Math.tan(Math.PI * design / fs);
        const ratio = Math.tan(Math.PI * f / fs) / Math.max(1e-12, denominator);
        return polar(-2 * Math.atan(ratio) * 180 / Math.PI, 1);
    }

    function delaySeconds(parameters) {
        const p = parameters || {};
        const value = Number(p.delay || 0);
        const unit = String(p.unit || "ms").toLowerCase();
        if (unit.includes("sample")) return value / samplerate();
        if (unit === "us" || unit.includes("micro")) return value / 1e6;
        if (unit === "s" || unit === "sec" || unit.includes("second")) return value;
        return value / 1000;
    }

    function filterResponse(filter, freq) {
        if (!filter) return c(1, 0);
        const p = filter.parameters || {};
        if (filter.type === "Gain") {
            const magnitude = Math.pow(10, Number(p.gain || 0) / 20);
            return p.inverted ? c(-magnitude, 0) : c(magnitude, 0);
        }
        if (filter.type === "Delay") {
            return polar(-360 * Number(freq) * delaySeconds(p), 1);
        }
        if (filter.type === "BiquadCombo") return comboResponse(p, freq);
        if (filter.type === "Biquad") {
            if (String(p.type || "") === "AllpassFO") return allpassFoResponse(p.freq, freq);
            const coeffs = biquadCoeffs(p);
            return coeffs ? responseFromCoeffs(coeffs, freq) : c(1, 0);
        }
        // Limiters and processors are nonlinear/static protection blocks; no
        // fixed small-signal phase contribution is drawn here.
        return c(1, 0);
    }

    function channelResponse(channel, freq) {
        let total = c(1, 0);
        for (const [, filter] of filterEntries(channel)) {
            total = cMul(total, filterResponse(filter, freq));
        }
        return total;
    }

    function responseSummary(channel, freq) {
        const response = channelResponse(channel, freq);
        return {
            phase: wrapPhase(cPhaseDeg(response)),
            magnitudeDb: 20 * Math.log10(Math.max(1e-12, cAbs(response)))
        };
    }

    function phaseFreqToX(freq, minFreq, maxFreq, width) {
        const lo = Math.log10(minFreq);
        const hi = Math.log10(maxFreq);
        return (Math.log10(Math.max(minFreq, Math.min(maxFreq, freq))) - lo) / (hi - lo) * width;
    }

    function phaseToY(phase, top, height) {
        return top + (180 - Number(phase)) / 360 * height;
    }

    function drawPhaseGrid(ctx, margin, innerW, innerH, minFreq, maxFreq) {
        const horizontal = [-180, -135, -90, -45, 0, 45, 90, 135, 180];
        const freqLabels = [20, 30, 40, 50, 63, 80, 100, 130, 200, 300, 500, 1000, 2000, 4000, 8000, 10000, 20000]
            .filter(freq => freq >= minFreq * 0.999 && freq <= maxFreq * 1.001);

        ctx.save();
        ctx.font = "9px Open Sans, Arial";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 1;
        for (const phase of horizontal) {
            const y = phaseToY(phase, margin.top, innerH);
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + innerW, y);
            ctx.strokeStyle = phase === 0 ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.075)";
            ctx.stroke();
            ctx.fillStyle = "rgba(235,240,242,.42)";
            ctx.textAlign = "right";
            ctx.fillText(`${phase}°`, margin.left - 7, y);
        }

        ctx.textBaseline = "top";
        for (const freq of freqLabels) {
            const x = margin.left + phaseFreqToX(freq, minFreq, maxFreq, innerW);
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + innerH);
            ctx.strokeStyle = "rgba(255,255,255,.055)";
            ctx.stroke();
            ctx.fillStyle = "rgba(235,240,242,.36)";
            ctx.textAlign = "center";
            const label = freq >= 1000 ? `${Number((freq / 1000).toFixed(freq % 1000 ? 1 : 0))}k` : String(freq);
            ctx.fillText(label, x, margin.top + innerH + 7);
        }
        ctx.restore();
    }

    function drawWrappedPhaseCurve(ctx, channel, freqs, margin, innerW, innerH, minFreq, maxFreq, selected = false) {
        const color = typeof estackV4ChannelColor === "function" ? estackV4ChannelColor(channel) : "#59d5e3";
        let previous = null;
        let drawing = false;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 2.6 : 1.45;
        ctx.globalAlpha = selected ? 1 : .42;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();

        for (const freq of freqs) {
            const summary = responseSummary(channel, freq);
            const x = margin.left + phaseFreqToX(freq, minFreq, maxFreq, innerW);
            const y = phaseToY(summary.phase, margin.top, innerH);
            const visible = summary.magnitudeDb > -70;
            const wraps = previous !== null && Math.abs(summary.phase - previous) > 170;
            if (!visible || wraps) {
                drawing = false;
                previous = summary.phase;
                continue;
            }
            if (!drawing) {
                ctx.moveTo(x, y);
                drawing = true;
            } else {
                ctx.lineTo(x, y);
            }
            previous = summary.phase;
        }
        ctx.stroke();
        ctx.restore();
    }

    function drawGraphCaption(ctx, width, text) {
        ctx.save();
        ctx.font = "700 8px Open Sans, Arial";
        ctx.fillStyle = "rgba(235,240,242,.42)";
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(text, width - 15, 8);
        ctx.restore();
    }

    function drawPhaseGraph() {
        if (!DSP || typeof canvasSetup !== "function") return;
        const { ctx, width, height } = canvasSetup();
        const margin = { left: 54, right: 18, top: 18, bottom: 31 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const minFreq = 20;
        const maxFreq = 20000;
        const freqs = Array.from({ length: 320 }, (_, index) => minFreq * Math.pow(maxFreq / minFreq, index / 319));

        ctx.clearRect(0, 0, width, height);
        if (typeof estackV4GraphBackground === "function") estackV4GraphBackground(ctx, width, height);
        else { ctx.fillStyle = "#11181a"; ctx.fillRect(0, 0, width, height); }
        drawPhaseGrid(ctx, margin, innerW, innerH, minFreq, maxFreq);

        const channels = activeChannels();
        const order = channels.filter(channel => channel !== selectedChannel).concat(channels.includes(selectedChannel) ? [selectedChannel] : []);
        for (const channel of order) drawWrappedPhaseCurve(ctx, channel, freqs, margin, innerW, innerH, minFreq, maxFreq, channel === selectedChannel);

        drawGraphCaption(ctx, width, "THEORETICAL DSP ELECTRICAL PHASE · WRAPPED ±180°");
        if (typeof estackRenderLegend === "function") estackRenderLegend();
    }

    function availablePairs() {
        const active = new Set(activeChannels());
        return XO_PAIR_DEFS.filter(pair => active.has(pair.lower) && active.has(pair.upper));
    }

    function selectedPair() {
        const pairs = availablePairs();
        if (!pairs.length) return null;
        return pairs.find(pair => pair.key === selectedPairKey) || pairs[0];
    }

    function pairLabel(pair) {
        return `${channelName(pair.lower)} ↔ ${channelName(pair.upper)}`;
    }

    function crossoverFrequency(pair) {
        if (!pair) return null;
        const lowerLpf = getCrossover("lpf", pair.lower);
        const upperHpf = getCrossover("hpf", pair.upper);
        const lower = Number(lowerLpf?.[1]?.parameters?.freq);
        const upper = Number(upperHpf?.[1]?.parameters?.freq);
        if (Number.isFinite(lower) && Number.isFinite(upper)) return Math.sqrt(lower * upper);
        if (Number.isFinite(lower)) return lower;
        if (Number.isFinite(upper)) return upper;
        return null;
    }

    function updateXoReadout(pair, fc) {
        const root = document.getElementById("estackXoReadout");
        if (!root) return;
        if (graphMode !== "xo" || !pair || !Number.isFinite(fc)) {
            root.classList.remove("visible");
            return;
        }
        root.classList.add("visible");

        const lower = responseSummary(pair.lower, fc);
        const upper = responseSummary(pair.upper, fc);
        const delta = wrapPhase(upper.phase - lower.phase);
        const equivalentMs = delta / (360 * fc) * 1000;
        const absDelta = Math.abs(delta);
        const state = absDelta <= 30 ? "good" : absDelta <= 60 ? "warn" : "bad";

        root.innerHTML = "";
        const metrics = [
            ["XO FREQUENCY", `${Math.round(fc)} Hz`, ""],
            [channelName(pair.lower), `${lower.phase.toFixed(1)}°`, ""],
            [channelName(pair.upper), `${upper.phase.toFixed(1)}°`, ""],
            ["Δ PHASE (UPPER − LOWER)", `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}°`, `delta ${state}`],
            ["EQUIV. Δ DELAY", `${equivalentMs >= 0 ? "+" : ""}${equivalentMs.toFixed(3)} ms`, ""]
        ];
        for (const [label, value, cls] of metrics) {
            const item = document.createElement("div");
            item.className = `estack-xo-metric ${cls}`.trim();
            item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
            root.appendChild(item);
        }
    }

    function drawXoAlignGraph() {
        if (!DSP || typeof canvasSetup !== "function") return;
        const pair = selectedPair();
        const fc = crossoverFrequency(pair);
        if (!pair || !Number.isFinite(fc)) {
            if (baseDrawGraph) baseDrawGraph();
            return;
        }

        const { ctx, width, height } = canvasSetup();
        const margin = { left: 54, right: 18, top: 18, bottom: 31 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const minFreq = Math.max(20, fc / 4);
        const maxFreq = Math.min(20000, fc * 4);
        const freqs = Array.from({ length: 300 }, (_, index) => minFreq * Math.pow(maxFreq / minFreq, index / 299));

        ctx.clearRect(0, 0, width, height);
        if (typeof estackV4GraphBackground === "function") estackV4GraphBackground(ctx, width, height);
        else { ctx.fillStyle = "#11181a"; ctx.fillRect(0, 0, width, height); }
        drawPhaseGrid(ctx, margin, innerW, innerH, minFreq, maxFreq);
        drawWrappedPhaseCurve(ctx, pair.lower, freqs, margin, innerW, innerH, minFreq, maxFreq, true);
        drawWrappedPhaseCurve(ctx, pair.upper, freqs, margin, innerW, innerH, minFreq, maxFreq, true);

        const xFc = margin.left + phaseFreqToX(fc, minFreq, maxFreq, innerW);
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "rgba(255,255,255,.58)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(xFc, margin.top);
        ctx.lineTo(xFc, margin.top + innerH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(245,248,249,.78)";
        ctx.font = "700 9px Open Sans, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${Math.round(fc)} Hz`, xFc, margin.top + 4);
        ctx.restore();

        // Pair legend is local to XO Align; the normal six-output legend remains
        // in the top bar for channel selection/editing.
        const lowerColor = typeof estackV4ChannelColor === "function" ? estackV4ChannelColor(pair.lower) : "#59d5e3";
        const upperColor = typeof estackV4ChannelColor === "function" ? estackV4ChannelColor(pair.upper) : "#f2a44b";
        ctx.save();
        ctx.font = "700 8px Open Sans, Arial";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillStyle = lowerColor;
        ctx.fillText(channelName(pair.lower), margin.left + 8, margin.top + 7);
        ctx.fillStyle = upperColor;
        ctx.fillText(channelName(pair.upper), margin.left + 8, margin.top + 20);
        ctx.restore();

        drawGraphCaption(ctx, width, "XO ALIGN · DSP ELECTRICAL PHASE · ±2 OCTAVES");
        updateXoReadout(pair, fc);
        if (typeof estackRenderLegend === "function") estackRenderLegend();
    }

    function redraw() {
        if (graphMode === "phase") drawPhaseGraph();
        else if (graphMode === "xo") drawXoAlignGraph();
        else if (baseDrawGraph) baseDrawGraph();
        updateToolbarState();
    }

    function setMode(mode) {
        if (!VALID_MODES.has(mode)) return;
        graphMode = mode;
        localStorage.setItem(MODE_KEY, mode);
        updateToolbarState();
        redraw();
    }

    function syncPairSelect() {
        const select = document.getElementById("estackXoPair");
        if (!select || !DSP) return;
        const pairs = availablePairs();
        const signature = pairs.map(pair => pair.key).join(",");
        if (select.dataset.signature !== signature) {
            select.replaceChildren();
            for (const pair of pairs) {
                const option = document.createElement("option");
                option.value = pair.key;
                const fc = crossoverFrequency(pair);
                option.textContent = `${pairLabel(pair)}${Number.isFinite(fc) ? ` · ${Math.round(fc)} Hz` : ""}`;
                select.appendChild(option);
            }
            select.dataset.signature = signature;
        }
        if (pairs.some(pair => pair.key === selectedPairKey)) select.value = selectedPairKey;
        else if (pairs.length) {
            selectedPairKey = pairs[0].key;
            select.value = selectedPairKey;
            localStorage.setItem(PAIR_KEY, selectedPairKey);
        }
    }

    function updateToolbarState() {
        document.querySelectorAll(".estack-graph-modes button[data-graph-mode]").forEach(button => {
            button.classList.toggle("active", button.dataset.graphMode === graphMode);
            button.setAttribute("aria-pressed", String(button.dataset.graphMode === graphMode));
        });
        const xoControls = document.getElementById("estackXoControls");
        const readout = document.getElementById("estackXoReadout");
        xoControls?.classList.toggle("visible", graphMode === "xo");
        if (graphMode !== "xo") readout?.classList.remove("visible");
        syncPairSelect();
    }

    function installToolbar() {
        const workspace = document.querySelector(".venu-workspace");
        const graphWrap = document.querySelector(".venu-graph-wrap");
        if (!workspace || !graphWrap || document.getElementById("estackGraphModebar")) return;

        const bar = document.createElement("div");
        bar.id = "estackGraphModebar";
        bar.className = "estack-graph-modebar";

        const modes = document.createElement("div");
        modes.className = "estack-graph-modes";
        for (const [mode, label] of [["magnitude", "MAGNITUDE"], ["phase", "PHASE"], ["xo", "XO ALIGN"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.graphMode = mode;
            button.textContent = label;
            button.addEventListener("click", () => setMode(mode));
            modes.appendChild(button);
        }

        const xo = document.createElement("div");
        xo.id = "estackXoControls";
        xo.className = "estack-xo-controls";
        const xoLabel = document.createElement("span");
        xoLabel.textContent = "PAIR";
        const select = document.createElement("select");
        select.id = "estackXoPair";
        select.className = "estack-xo-pair-select";
        select.addEventListener("change", () => {
            selectedPairKey = select.value;
            localStorage.setItem(PAIR_KEY, selectedPairKey);
            redraw();
        });
        xo.append(xoLabel, select);

        const note = document.createElement("div");
        note.className = "estack-phase-source-note";
        note.textContent = "DSP electrical model · REW remains the acoustic reference";
        bar.append(modes, xo, note);

        const readout = document.createElement("div");
        readout.id = "estackXoReadout";
        readout.className = "estack-xo-readout";

        workspace.insertBefore(bar, graphWrap);
        workspace.insertBefore(readout, graphWrap);
        graphWrap.classList.add("estack-phase-graph");
        updateToolbarState();
    }

    // Replace only the graph dispatcher. All normal magnitude behavior remains
    // the exact V4 implementation captured above.
    drawGraph = redraw;

    // Keep XO pair selection relevant when the edited output changes. We do not
    // forcibly change a user-selected pair unless the current pair does not
    // contain the newly selected output and there is an obvious matching pair.
    if (typeof estackV4SelectChannel === "function") {
        const baseSelectChannel = estackV4SelectChannel;
        estackV4SelectChannel = async function(channel) {
            await baseSelectChannel(channel);
            if (graphMode !== "xo") return;
            const pair = selectedPair();
            const next = Number(channel);
            if (!pair || (pair.lower !== next && pair.upper !== next)) {
                const candidate = availablePairs().find(item => item.lower === next || item.upper === next);
                if (candidate) {
                    selectedPairKey = candidate.key;
                    localStorage.setItem(PAIR_KEY, selectedPairKey);
                }
            }
            syncPairSelect();
            redraw();
        };
    }

    document.addEventListener("DOMContentLoaded", () => {
        installToolbar();
        requestAnimationFrame(() => {
            updateToolbarState();
            redraw();
        });
    });
})();
