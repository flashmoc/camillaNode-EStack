// Global E-Stack response view.
// All six loudspeaker outputs remain visible at once. Selecting an output only
// changes which channel is highlighted/edited; it does not replace the graph.

const ESTACK_CHANNEL_COLORS = [
    "#ff9f43", // SUB
    "#ffd166", // KICK
    "#29d3c2", // MID L
    "#42a5f5", // MID R
    "#a78bfa", // HIGH L
    "#f472b6"  // HIGH R
];

const ESTACK_GLOBAL_RTA_FREQS = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];

function estackChannelColor(channel) {
    return ESTACK_CHANNEL_COLORS[Number(channel)] || "#d9e1e4";
}

function estackHexToRgba(hex, alpha) {
    const clean = String(hex).replace("#", "");
    const value = parseInt(clean, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

function estackRenderLegend() {
    const root = document.querySelector(".venu-graph-legend");
    if (!root || !DSP) return;
    root.replaceChildren();

    for (const channel of activeChannels()) {
        const item = document.createElement("span");
        item.className = "estack-channel-legend";
        item.classList.toggle("active", channel === selectedChannel);
        item.style.setProperty("--legend-color", estackChannelColor(channel));

        const swatch = document.createElement("i");
        const label = document.createElement("b");
        label.textContent = channelName(channel);
        item.append(swatch, label);
        root.appendChild(item);
    }
}

// Keep the graph global. The tabs below it select the editor module only.
const estackOriginalRenderHeader = renderHeader;
renderHeader = function() {
    estackOriginalRenderHeader();

    const title = document.getElementById("moduleTitle");
    const subtitle = document.getElementById("moduleSubtitle");
    if (title) title.textContent = "System Response";
    if (subtitle) subtitle.textContent = `All outputs · selected: ${channelName()}`;

    estackRenderLegend();
};

function estackDrawRtaOverlay(ctx, margin, innerW, innerH) {
    if (!Array.isArray(lastSpectrum) || !lastSpectrum.length) return;
    if (!window.parent.activeSettings?.enableSpectrum || !window.parent.activeSettings?.showEqualizerSpectrum) return;

    ctx.save();

    const top = margin.top + 8;
    const bottom = margin.top + innerH;
    const usableHeight = innerH - 10;

    for (let i = 0; i < Math.min(lastSpectrum.length, ESTACK_GLOBAL_RTA_FREQS.length); i++) {
        const freq = ESTACK_GLOBAL_RTA_FREQS[i];
        const prev = i === 0 ? 20 : Math.sqrt(ESTACK_GLOBAL_RTA_FREQS[i - 1] * freq);
        const next = i === ESTACK_GLOBAL_RTA_FREQS.length - 1 ? 20000 : Math.sqrt(freq * ESTACK_GLOBAL_RTA_FREQS[i + 1]);
        const x1 = margin.left + freqToX(Math.max(20, prev), innerW);
        const x2 = margin.left + freqToX(Math.min(20000, next), innerW);

        // Analyzer has its own visual scale (-100..0 dBFS). It is deliberately
        // subtle so it cannot be mistaken for the transfer-function dB scale.
        const level = Math.max(-100, Math.min(0, Number(lastSpectrum[i] ?? -100)));
        const norm = Math.pow((level + 100) / 100, 1.45);
        const barHeight = Math.max(0, usableHeight * norm * 0.88);

        const grad = ctx.createLinearGradient(0, bottom - barHeight, 0, bottom);
        grad.addColorStop(0, "rgba(63, 210, 198, .20)");
        grad.addColorStop(1, "rgba(38, 139, 158, .045)");
        ctx.fillStyle = grad;
        ctx.fillRect(x1 + 1, bottom - barHeight, Math.max(1, x2 - x1 - 2), barHeight);
    }

    ctx.fillStyle = "rgba(116, 198, 193, .45)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("LIVE RTA", margin.left + 9, top + 5);
    ctx.restore();
}

function estackDrawResponseCurve(ctx, freqs, values, margin, innerW, innerH, range, channel, selected) {
    const color = estackChannelColor(channel);

    ctx.save();
    ctx.beginPath();
    values.forEach((db, index) => {
        const x = margin.left + freqToX(freqs[index], innerW);
        const clipped = Math.max(range.min - 12, Math.min(range.max + 8, Number(db)));
        const y = margin.top + dbToY(clipped, innerH, range);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = selected ? color : estackHexToRgba(color, .58);
    ctx.lineWidth = selected ? 3.2 : 1.55;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (selected) {
        ctx.shadowColor = estackHexToRgba(color, .72);
        ctx.shadowBlur = 8;
    }

    ctx.stroke();
    ctx.restore();
}

// Override the module-specific graph with a permanent system overview.
drawGraph = function() {
    if (!DSP) return;

    const { ctx, width, height } = canvasSetup();
    const margin = { left: 50, right: 18, top: 18, bottom: 31 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const range = { min: -60, max: 12, step: 10 };

    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#171d22");
    bg.addColorStop(1, "#11171b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    estackDrawRtaOverlay(ctx, margin, innerW, innerH);
    drawGrid(ctx, margin, innerW, innerH, range);

    const freqs = logFrequencies(20, 20000, 520);
    const channels = activeChannels();

    // Draw non-selected outputs first, then the selected output on top.
    const drawOrder = channels.filter(ch => ch !== selectedChannel).concat(
        channels.includes(selectedChannel) ? [selectedChannel] : []
    );

    for (const channel of drawOrder) {
        const entries = filterEntries(channel).filter(([, filter]) =>
            ["BiquadCombo", "Biquad", "Gain"].includes(filter?.type)
        );
        const values = freqs.map(freq => sumDb(entries, freq));
        estackDrawResponseCurve(
            ctx,
            freqs,
            values,
            margin,
            innerW,
            innerH,
            range,
            channel,
            channel === selectedChannel
        );
    }

    // A small baseline makes the 0 dB reference clearer without filling the plot.
    const zeroY = margin.top + dbToY(0, innerH, range);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, zeroY);
    ctx.lineTo(margin.left + innerW, zeroY);
    ctx.stroke();
    ctx.restore();

    estackRenderLegend();
};

// Re-integrate the spectrum into the main response graph. The separate RTA strip
// is hidden by CSS, but the same spectrum CamillaDSP instance on port 6413 is used.
startSpectrum = function() {
    if (spectrumTimer) clearInterval(spectrumTimer);
    spectrumTimer = setInterval(async () => {
        try {
            if (!DSP?.spectrum_connected) return;
            const levels = await DSP.getSpectrumData();
            if (!Array.isArray(levels)) return;

            lastSpectrum = [];
            for (let i = 0; i < ESTACK_GLOBAL_RTA_FREQS.length; i++) {
                lastSpectrum.push(Number(levels[i * 2] ?? -100));
            }
            drawGraph();
        } catch (_) {}
    }, 140);
};

window.addEventListener("resize", () => {
    window.clearTimeout(window.__estackGlobalGraphResizeTimer);
    window.__estackGlobalGraphResizeTimer = window.setTimeout(drawGraph, 120);
});
