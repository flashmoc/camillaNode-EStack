// E-Stack VENU-style presentation layer.
// Keep the live RTA visually separate from the DSP transfer-function graph.

const ESTACK_RTA_FREQS = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];

// The previous screen intentionally overlaid RTA bars behind the filter curve.
// For speaker-management work that makes measured signal content look like part
// of the transfer function, so the response graph is now DSP-only.
drawRta = function() {};

// The original crossover view used a large opaque orange fill. Keep the module
// curve readable, but make the graph behave more like a technical DSP display.
drawFilledCurve = function(ctx, freqs, values, margin, innerW, innerH, range, fill, stroke, lineWidth) {
    const zeroY = margin.top + dbToY(0, innerH, range);
    ctx.save();
    ctx.beginPath();
    values.forEach((db, index) => {
        const x = margin.left + freqToX(freqs[index], innerW);
        const y = margin.top + dbToY(clamp(db, range.min - 10, range.max + 10), innerH, range);
        if (index === 0) ctx.moveTo(x, zeroY);
        ctx.lineTo(x, y);
    });
    ctx.lineTo(margin.left + innerW, zeroY);
    ctx.closePath();
    ctx.globalAlpha = activeModule === "crossover" ? .22 : .48;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    drawCurve(ctx, freqs, values, margin, innerW, innerH, range, stroke, lineWidth);
};

function estackRtaX(freq, width) {
    const min = 20;
    const max = 20000;
    return width * Math.log(freq / min) / Math.log(max / min);
}

function drawDedicatedRta() {
    const canvas = document.getElementById("rtaCanvas");
    if (!canvas) return;

    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(500, Math.round(rect.width));
    const height = Math.max(76, Math.round(canvas.getBoundingClientRect().height || 88));

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(83, 223, 214, .92)");
    gradient.addColorStop(.6, "rgba(48, 170, 184, .72)");
    gradient.addColorStop(1, "rgba(31, 105, 125, .28)");

    ctx.lineWidth = 1;
    for (const db of [-90, -60, -30, 0]) {
        const y = height - ((db + 100) / 100) * (height - 8) - 4;
        ctx.strokeStyle = db === 0 ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.055)";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    if (!Array.isArray(lastSpectrum) || !lastSpectrum.length) return;

    for (let i = 0; i < Math.min(lastSpectrum.length, ESTACK_RTA_FREQS.length); i++) {
        const freq = ESTACK_RTA_FREQS[i];
        const prev = i === 0 ? 20 : Math.sqrt(ESTACK_RTA_FREQS[i - 1] * freq);
        const next = i === ESTACK_RTA_FREQS.length - 1 ? 20000 : Math.sqrt(freq * ESTACK_RTA_FREQS[i + 1]);
        const x1 = estackRtaX(Math.max(20, prev), width);
        const x2 = estackRtaX(Math.min(20000, next), width);
        const level = Math.max(-100, Math.min(0, Number(lastSpectrum[i] ?? -100)));
        const normalized = (level + 100) / 100;
        const barHeight = Math.max(1, normalized * (height - 9));
        ctx.fillStyle = gradient;
        ctx.fillRect(x1 + 1, height - barHeight - 3, Math.max(1, x2 - x1 - 2), barHeight);
    }
}

// Replace the previous analyzer loop. The DSP response graph no longer needs to
// redraw at 8 Hz because spectrum data is rendered in its own canvas.
startSpectrum = function() {
    if (spectrumTimer) clearInterval(spectrumTimer);
    spectrumTimer = setInterval(async () => {
        try {
            if (!DSP?.spectrum_connected) return;
            const levels = await DSP.getSpectrumData();
            if (!Array.isArray(levels)) return;
            lastSpectrum = [];
            for (let i = 0; i < ESTACK_RTA_FREQS.length; i++) {
                lastSpectrum.push(Number(levels[i * 2] ?? -100));
            }
            drawDedicatedRta();
        } catch (_) {}
    }, 120);
};

window.addEventListener("resize", () => {
    window.clearTimeout(window.__estackRtaResizeTimer);
    window.__estackRtaResizeTimer = window.setTimeout(drawDedicatedRta, 120);
});
