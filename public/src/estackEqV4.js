// E-Stack EQ V4 visual adapter.
// Keeps the existing CamillaDSP editing engine and replaces only presentation
// helpers shared by the per-output and Global EQ pages.

const ESTACK_V4_ACCENT = "#73dce4";
const ESTACK_V4_MUTED_CURVES = ["#758084", "#697478", "#7b8589", "#606b6f", "#818b8e", "#6c777a"];

function estackV4Hue() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--bck-hue").trim();
    const value = Number(raw);
    return Number.isFinite(value) ? value : 180;
}

function estackV4GraphBackground(ctx, width, height) {
    const hue = estackV4Hue();
    ctx.fillStyle = `hsl(${hue}, 24%, 8%)`;
    ctx.fillRect(0, 0, width, height);
}

if (typeof estackPeqBandColor === "function") {
    estackPeqBandColor = function() { return ESTACK_V4_ACCENT; };
}

if (typeof globalEqColor === "function") {
    globalEqColor = function() { return ESTACK_V4_ACCENT; };
}

if (typeof estackChannelColor === "function") {
    estackChannelColor = function(channel) {
        return ESTACK_V4_MUTED_CURVES[Number(channel)] || "#737d80";
    };
}

if (typeof estackRenderLegend === "function") {
    estackRenderLegend = function() {
        const root = document.querySelector(".venu-graph-legend");
        if (!root || !window.DSP) return;
        root.replaceChildren();
        for (const channel of activeChannels()) {
            const selected = channel === selectedChannel;
            const item = document.createElement("span");
            item.className = "estack-channel-legend";
            item.classList.toggle("active", selected);
            const swatch = document.createElement("i");
            const label = document.createElement("b");
            label.textContent = channelName(channel);
            item.append(swatch, label);
            root.appendChild(item);
        }
    };
}

if (typeof estackDrawResponseCurve === "function") {
    estackDrawResponseCurve = function(ctx, freqs, values, margin, innerW, innerH, range, channel, selected) {
        ctx.save();
        ctx.beginPath();
        values.forEach((db, index) => {
            const x = margin.left + freqToX(freqs[index], innerW);
            const clipped = Math.max(range.min - 12, Math.min(range.max + 8, Number(db)));
            const y = margin.top + dbToY(clipped, innerH, range);
            if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = selected ? ESTACK_V4_ACCENT : (ESTACK_V4_MUTED_CURVES[Number(channel)] || "#717b7e");
        ctx.globalAlpha = selected ? 1 : .50;
        ctx.lineWidth = selected ? 2.5 : 1.25;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();
    };
}

// System response canvas: theme background, neutral context curves, cyan selected
// output and cyan PEQ points. No gradients/glow/shadows.
if (typeof canvasSetup === "function" && typeof activeChannels === "function") {
    drawGraph = function() {
        if (!window.DSP) return;
        const { ctx, width, height } = canvasSetup();
        const margin = { left: 50, right: 18, top: 18, bottom: 31 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const range = { min: -60, max: 12, step: 10 };

        ctx.clearRect(0, 0, width, height);
        estackV4GraphBackground(ctx, width, height);
        if (typeof estackDrawRtaOverlay === "function") estackDrawRtaOverlay(ctx, margin, innerW, innerH);
        if (typeof drawGrid === "function") drawGrid(ctx, margin, innerW, innerH, range);

        const freqs = logFrequencies(20, 20000, 520);
        const channels = activeChannels();
        const order = channels.filter(ch => ch !== selectedChannel).concat(
            channels.includes(selectedChannel) ? [selectedChannel] : []
        );

        for (const channel of order) {
            const entries = filterEntries(channel).filter(([, filter]) =>
                ["BiquadCombo", "Biquad", "Gain"].includes(filter?.type)
            );
            const values = freqs.map(freq => sumDb(entries, freq));
            estackDrawResponseCurve(ctx, freqs, values, margin, innerW, innerH, range, channel, channel === selectedChannel);
        }

        const zeroY = margin.top + dbToY(0, innerH, range);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.24)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, zeroY);
        ctx.lineTo(margin.left + innerW, zeroY);
        ctx.stroke();
        ctx.restore();

        if (typeof estackRenderLegend === "function") estackRenderLegend();
        if (typeof estackDrawPeqMarkers === "function") estackDrawPeqMarkers();
    };
}

// Global EQ curve/points use the same hierarchy as the per-output editor.
if (typeof globalEqDrawResponse === "function") {
    globalEqDrawResponse = function(ctx, width, height, margin) {
        const innerW = width - margin.left - margin.right;
        const freqs = globalEqLogFreqs(420);

        ctx.beginPath();
        freqs.forEach((freq, index) => {
            const x = margin.left + globalEqFreqToX(freq, innerW);
            const y = globalEqResponseY(globalEqTotalDb(freq), height, margin.top, margin.bottom);
            if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = ESTACK_V4_ACCENT;
        ctx.lineWidth = 2.25;
        ctx.stroke();

        for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
            const filter = globalEqFilter(slot);
            const freq = Number(filter?.parameters?.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
            const x = margin.left + globalEqFreqToX(freq, innerW);
            const y = globalEqResponseY(globalEqTotalDb(freq), height, margin.top, margin.bottom);
            const selected = slot === globalEqSelected;
            const state = globalEqBandState(slot);
            const active = state === "active";

            ctx.beginPath();
            ctx.arc(x, y, selected ? 9.5 : 7.5, 0, Math.PI * 2);
            ctx.fillStyle = selected ? ESTACK_V4_ACCENT : "#172022";
            ctx.fill();
            ctx.lineWidth = selected ? 2 : 1.25;
            ctx.strokeStyle = active ? ESTACK_V4_ACCENT : "rgba(220,228,230,.28)";
            ctx.stroke();
            ctx.fillStyle = selected ? "#102124" : active ? "#eef4f5" : "rgba(235,240,241,.48)";
            ctx.font = `${selected ? "700 " : ""}10px Open Sans, Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(slot + 1), x, y + .25);
        }
    };
}

if (typeof globalEqDraw === "function") {
    const estackV4BaseGlobalDraw = globalEqDraw;
    globalEqDraw = function() {
        estackV4BaseGlobalDraw();
        // Base renderer is transparent; CSS provides the theme background.
    };
}

// After the old functional modules have completed their first render, redraw
// once with the V4 palette.
document.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(() => {
        try {
            if (document.body.classList.contains("estack-eq-v4") && typeof drawGraph === "function") drawGraph();
            if (document.body.classList.contains("global-eq-v4") && typeof globalEqDraw === "function") globalEqDraw();
        } catch (_) {}
    });
});
