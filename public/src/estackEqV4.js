// E-Stack EQ V4 adapter.
// Keeps the existing CamillaDSP editing engine while owning the V4 visual
// hierarchy, channel identity and response-graph navigation.

const ESTACK_V4_CHANNEL_COLORS = [
    "#59d5e3", // SUB — cyan
    "#f2a44b", // KICK — amber
    "#66cf9b", // MID L — green
    "#5d9fea", // MID R — blue
    "#a586ee", // HIGH L — violet
    "#e574ac"  // HIGH R — pink
];
const ESTACK_V4_GLOBAL_ACCENT = "#68d4de";

function estackV4Hue() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--bck-hue").trim();
    const value = Number(raw);
    return Number.isFinite(value) ? value : 180;
}

function estackV4ChannelColor(channel) {
    return ESTACK_V4_CHANNEL_COLORS[Number(channel)] || ESTACK_V4_GLOBAL_ACCENT;
}

function estackV4SelectedColor() {
    return typeof selectedChannel !== "undefined"
        ? estackV4ChannelColor(selectedChannel)
        : ESTACK_V4_GLOBAL_ACCENT;
}

function estackV4HexToRgba(hex, alpha) {
    const clean = String(hex).replace("#", "");
    const value = Number.parseInt(clean, 16);
    if (!Number.isFinite(value)) return `rgba(104,212,222,${alpha})`;
    return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function estackV4ApplyChannelAccent(channel = (typeof selectedChannel !== "undefined" ? selectedChannel : 0)) {
    const color = estackV4ChannelColor(channel);
    document.documentElement.style.setProperty("--eq-accent", color);
    document.documentElement.style.setProperty("--eq-accent-soft", estackV4HexToRgba(color, .14));
    document.body?.style.setProperty("--eq-accent", color);
    document.body?.style.setProperty("--eq-accent-soft", estackV4HexToRgba(color, .14));
}

function estackV4GraphBackground(ctx, width, height) {
    const hue = estackV4Hue();
    ctx.fillStyle = `hsl(${hue}, 24%, 8%)`;
    ctx.fillRect(0, 0, width, height);
}

// PEQ controls/markers inherit the identity colour of the output currently in focus.
if (typeof estackPeqBandColor === "function") {
    estackPeqBandColor = function() { return estackV4SelectedColor(); };
}

if (typeof globalEqColor === "function") {
    globalEqColor = function() { return ESTACK_V4_GLOBAL_ACCENT; };
}

if (typeof estackChannelColor === "function") {
    estackChannelColor = function(channel) { return estackV4ChannelColor(channel); };
}

// The graph legend is now the only visible output selector. It is deliberately
// compact and uses one stable colour per physical output.
if (typeof estackRenderLegend === "function") {
    estackRenderLegend = function() {
        const root = document.querySelector(".venu-graph-legend");
        if (!root || !window.DSP) return;
        root.replaceChildren();

        for (const channel of activeChannels()) {
            const selected = channel === selectedChannel;
            const color = estackV4ChannelColor(channel);
            const item = document.createElement("button");
            item.type = "button";
            item.className = "estack-channel-legend";
            item.classList.toggle("active", selected);
            item.style.setProperty("--channel-color", color);
            item.setAttribute("aria-pressed", String(selected));
            item.title = `Edit ${channelName(channel)}`;

            const swatch = document.createElement("i");
            const label = document.createElement("b");
            label.textContent = channelName(channel);
            item.append(swatch, label);

            item.addEventListener("click", async () => {
                if (channel === selectedChannel || item.dataset.busy === "true") return;
                item.dataset.busy = "true";
                item.disabled = true;
                try {
                    selectedChannel = channel;
                    selectedCrossover = getCrossover("hpf") ? "hpf" : "lpf";
                    selectedPeqSlot = 0;
                    estackV4ApplyChannelAccent(channel);
                    await DSP.downloadConfig();
                    renderAll(false);
                } catch (error) {
                    console.error("E-Stack output selection failed", error);
                    if (typeof setStatus === "function") setStatus(`Output selection failed: ${error?.message || error}`, "error");
                } finally {
                    item.disabled = false;
                    delete item.dataset.busy;
                }
            });

            root.appendChild(item);
        }
    };
}

// Keep the title compact; the active output is already explicit in the coloured legend.
if (typeof renderHeader === "function") {
    const estackV4BaseRenderHeader = renderHeader;
    renderHeader = function() {
        estackV4BaseRenderHeader();
        if (typeof selectedChannel !== "undefined") estackV4ApplyChannelAccent(selectedChannel);
        const title = document.getElementById("moduleTitle");
        if (title) title.textContent = activeModule === "peq" ? "PARAMETRIC EQ" : "OUTPUT / PROTECTION";
    };
}

if (typeof estackDrawResponseCurve === "function") {
    estackDrawResponseCurve = function(ctx, freqs, values, margin, innerW, innerH, range, channel, selected) {
        const color = estackV4ChannelColor(channel);
        ctx.save();
        ctx.beginPath();
        values.forEach((db, index) => {
            const x = margin.left + freqToX(freqs[index], innerW);
            const clipped = Math.max(range.min - 12, Math.min(range.max + 8, Number(db)));
            const y = margin.top + dbToY(clipped, innerH, range);
            if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.globalAlpha = selected ? 1 : .34;
        ctx.lineWidth = selected ? 2.8 : 1.35;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();
    };
}

// System response graph: every output keeps its own colour, while the selected
// output is stronger and always drawn last. PEQ points inherit that same colour.
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
        ctx.strokeStyle = "rgba(255,255,255,.22)";
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

// Global EQ remains global, so it uses the shared cyan accent rather than a
// loudspeaker-output colour.
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
        ctx.strokeStyle = ESTACK_V4_GLOBAL_ACCENT;
        ctx.lineWidth = 2.25;
        ctx.stroke();

        for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
            const filter = globalEqFilter(slot);
            const freq = Number(filter?.parameters?.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
            const x = margin.left + globalEqFreqToX(freq, innerW);
            const y = globalEqResponseY(globalEqTotalDb(freq), height, margin.top, margin.bottom);
            const selected = slot === globalEqSelected;
            const active = globalEqBandState(slot) === "active";

            ctx.beginPath();
            ctx.arc(x, y, selected ? 9.5 : 7.5, 0, Math.PI * 2);
            ctx.fillStyle = selected ? ESTACK_V4_GLOBAL_ACCENT : "#172022";
            ctx.fill();
            ctx.lineWidth = selected ? 2 : 1.25;
            ctx.strokeStyle = active ? ESTACK_V4_GLOBAL_ACCENT : "rgba(220,228,230,.28)";
            ctx.stroke();
            ctx.fillStyle = selected ? "#102124" : active ? "#eef4f5" : "rgba(235,240,241,.48)";
            ctx.font = `${selected ? "700 " : ""}10px Open Sans, Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(slot + 1), x, y + .25);
        }
    };
}

document.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(() => {
        try {
            if (document.body.classList.contains("estack-eq-v4")) {
                estackV4ApplyChannelAccent(typeof selectedChannel !== "undefined" ? selectedChannel : 0);
                if (typeof drawGraph === "function") drawGraph();
            }
            if (document.body.classList.contains("global-eq-v4") && typeof globalEqDraw === "function") globalEqDraw();
        } catch (_) {}
    });
});
