// E-Stack graphite EQ palette.
// Loaded after the existing EQ scripts so it can replace only visual helpers,
// leaving all CamillaDSP routing/edit behaviour intact.

const ESTACK_DAW_ACCENT = "#72dce5";
const ESTACK_DAW_GRAPH_BG_TOP = "#3a3c3d";
const ESTACK_DAW_GRAPH_BG_BOTTOM = "#303233";
const ESTACK_DAW_INACTIVE_CURVES = ["#8b8f91", "#9a9ea0", "#777c7e", "#a5a8aa", "#858a8c", "#969a9c"];

// One restrained accent for all PEQ bands. Selection is expressed by fill,
// size and border instead of ten unrelated colours.
if (typeof estackPeqBandColor === "function") {
    estackPeqBandColor = function() { return ESTACK_DAW_ACCENT; };
}

if (typeof globalEqColor === "function") {
    globalEqColor = function() { return ESTACK_DAW_ACCENT; };
}

if (typeof estackChannelColor === "function") {
    estackChannelColor = function(channel) {
        return ESTACK_DAW_INACTIVE_CURVES[Number(channel)] || "#929698";
    };
}

// Channel response graph: selected output is cyan; other outputs are neutral
// greys. This keeps the all-output overview useful without the rainbow effect.
if (typeof estackDrawResponseCurve === "function") {
    estackDrawResponseCurve = function(ctx, freqs, values, margin, innerW, innerH, range, channel, selected) {
        const muted = ESTACK_DAW_INACTIVE_CURVES[Number(channel)] || "#8f9395";
        const color = selected ? ESTACK_DAW_ACCENT : muted;

        ctx.save();
        ctx.beginPath();
        values.forEach((db, index) => {
            const x = margin.left + freqToX(freqs[index], innerW);
            const clipped = Math.max(range.min - 12, Math.min(range.max + 8, Number(db)));
            const y = margin.top + dbToY(clipped, innerH, range);
            if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.globalAlpha = selected ? 1 : .48;
        ctx.lineWidth = selected ? 2.5 : 1.25;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();
    };
}

// Graph legend mirrors the same hierarchy: cyan only for the channel being
// edited, neutral grey for context channels.
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
            item.style.setProperty("--legend-color", selected ? ESTACK_DAW_ACCENT : "#929698");

            const swatch = document.createElement("i");
            const label = document.createElement("b");
            label.textContent = channelName(channel);
            item.append(swatch, label);
            root.appendChild(item);
        }
    };
}

// Repaint the system response graph in neutral graphite while preserving the
// existing RTA, frequency zoom, all-output curves and draggable PEQ markers.
if (typeof canvasSetup === "function" && typeof activeChannels === "function" && typeof filterEntries === "function") {
    drawGraph = function() {
        if (!window.DSP) return;

        const { ctx, width, height } = canvasSetup();
        const margin = { left: 50, right: 18, top: 18, bottom: 31 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const range = { min: -60, max: 12, step: 10 };

        ctx.clearRect(0, 0, width, height);
        const bg = ctx.createLinearGradient(0, 0, 0, height);
        bg.addColorStop(0, ESTACK_DAW_GRAPH_BG_TOP);
        bg.addColorStop(1, ESTACK_DAW_GRAPH_BG_BOTTOM);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);

        if (typeof estackDrawRtaOverlay === "function") estackDrawRtaOverlay(ctx, margin, innerW, innerH);
        drawGrid(ctx, margin, innerW, innerH, range);

        const freqs = logFrequencies(20, 20000, 520);
        const channels = activeChannels();
        const drawOrder = channels.filter(ch => ch !== selectedChannel).concat(
            channels.includes(selectedChannel) ? [selectedChannel] : []
        );

        for (const channel of drawOrder) {
            const entries = filterEntries(channel).filter(([, filter]) =>
                ["BiquadCombo", "Biquad", "Gain"].includes(filter?.type)
            );
            const values = freqs.map(freq => sumDb(entries, freq));
            estackDrawResponseCurve(ctx, freqs, values, margin, innerW, innerH, range, channel, channel === selectedChannel);
        }

        const zeroY = margin.top + dbToY(0, innerH, range);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.25)";
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

// Global EQ canvas points/curve already use globalEqColor(), so changing the
// colour helper above is enough. Ask for one redraw after all deferred scripts
// have completed their initial render.
document.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(() => {
        try {
            if (document.body.classList.contains("global-v2-page") && typeof globalEqDraw === "function") globalEqDraw();
            if (document.body.classList.contains("estack-dsp-page") && typeof drawGraph === "function") drawGraph();
        } catch (_) {}
    });
});
