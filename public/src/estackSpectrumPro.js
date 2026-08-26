// Professional spectrum overlay inspired by mastering-EQ analyzers.
// White = smoothed realtime spectrum. Grey = long-term/integrated spectrum.
// The current backend still supplies 30 analyzer bands; this layer interpolates
// them smoothly for display but does not pretend to add new spectral resolution.

const ESTACK_SPECTRUM_FREQS = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];
const ESTACK_SPECTRUM_MIN_DB = -90;
const ESTACK_SPECTRUM_MAX_DB = 0;

let estackSpectrumMode = window.localStorage.getItem("estack.spectrum.speed") === "slow" ? "slow" : "fast";
let estackSpectrumInfiniteEnabled = window.localStorage.getItem("estack.spectrum.infinite") !== "false";
let estackSpectrumRealtime = [];
let estackSpectrumPowerSum = [];
let estackSpectrumInfinite = [];
let estackSpectrumSamples = 0;

function estackSpectrumDbToY(db, top, height) {
    const value = Math.max(ESTACK_SPECTRUM_MIN_DB, Math.min(ESTACK_SPECTRUM_MAX_DB, Number(db)));
    return top + ((ESTACK_SPECTRUM_MAX_DB - value) / (ESTACK_SPECTRUM_MAX_DB - ESTACK_SPECTRUM_MIN_DB)) * height;
}

function estackSpectrumSmoothPath(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) return;

    for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
}

function estackSpectrumPoints(values, margin, innerW, innerH) {
    return ESTACK_SPECTRUM_FREQS.map((freq, index) => ({
        x: margin.left + freqToX(freq, innerW),
        y: estackSpectrumDbToY(values[index] ?? ESTACK_SPECTRUM_MIN_DB, margin.top, innerH)
    }));
}

function estackResetInfiniteSpectrum() {
    estackSpectrumPowerSum = Array(ESTACK_SPECTRUM_FREQS.length).fill(0);
    estackSpectrumInfinite = Array(ESTACK_SPECTRUM_FREQS.length).fill(ESTACK_SPECTRUM_MIN_DB);
    estackSpectrumSamples = 0;
    drawGraph();
}

function estackUpdateSpectrumToolbar() {
    const fast = document.getElementById("estackSpectrumFast");
    const slow = document.getElementById("estackSpectrumSlow");
    const infinite = document.getElementById("estackSpectrumInfinite");
    if (fast) fast.classList.toggle("active", estackSpectrumMode === "fast");
    if (slow) slow.classList.toggle("active", estackSpectrumMode === "slow");
    if (infinite) {
        infinite.classList.toggle("active", estackSpectrumInfiniteEnabled);
        infinite.setAttribute("aria-pressed", String(estackSpectrumInfiniteEnabled));
    }
}

function estackInstallSpectrumToolbar() {
    const wrap = document.querySelector(".venu-graph-wrap");
    if (!wrap || document.getElementById("estackSpectrumToolbar")) return;

    const toolbar = document.createElement("div");
    toolbar.id = "estackSpectrumToolbar";
    toolbar.className = "estack-spectrum-toolbar";
    toolbar.innerHTML = `
        <div class="estack-spectrum-legend">
            <span><i class="realtime"></i>REALTIME</span>
            <span><i class="infinite"></i>INFINITE</span>
        </div>
        <div class="estack-spectrum-buttons">
            <button id="estackSpectrumFast" type="button">FAST</button>
            <button id="estackSpectrumSlow" type="button">SLOW</button>
            <button id="estackSpectrumInfinite" type="button" aria-pressed="true">INFINITE</button>
            <button id="estackSpectrumReset" type="button">RESET</button>
        </div>`;
    wrap.appendChild(toolbar);

    document.getElementById("estackSpectrumFast").onclick = () => {
        estackSpectrumMode = "fast";
        window.localStorage.setItem("estack.spectrum.speed", "fast");
        estackUpdateSpectrumToolbar();
    };
    document.getElementById("estackSpectrumSlow").onclick = () => {
        estackSpectrumMode = "slow";
        window.localStorage.setItem("estack.spectrum.speed", "slow");
        estackUpdateSpectrumToolbar();
    };
    document.getElementById("estackSpectrumInfinite").onclick = () => {
        estackSpectrumInfiniteEnabled = !estackSpectrumInfiniteEnabled;
        window.localStorage.setItem("estack.spectrum.infinite", String(estackSpectrumInfiniteEnabled));
        estackUpdateSpectrumToolbar();
        drawGraph();
    };
    document.getElementById("estackSpectrumReset").onclick = estackResetInfiniteSpectrum;
    estackUpdateSpectrumToolbar();
}

// Override the simple translucent bars from estackGlobalGraph.js.
estackDrawRtaOverlay = function(ctx, margin, innerW, innerH) {
    if (!Array.isArray(estackSpectrumRealtime) || !estackSpectrumRealtime.length) return;
    if (!window.parent.activeSettings?.enableSpectrum || !window.parent.activeSettings?.showEqualizerSpectrum) return;

    ctx.save();

    if (estackSpectrumInfiniteEnabled && estackSpectrumInfinite.length) {
        const infinitePoints = estackSpectrumPoints(estackSpectrumInfinite, margin, innerW, innerH);
        const bottom = margin.top + innerH;

        estackSpectrumSmoothPath(ctx, infinitePoints);
        ctx.lineTo(infinitePoints[infinitePoints.length - 1].x, bottom);
        ctx.lineTo(infinitePoints[0].x, bottom);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, margin.top, 0, bottom);
        fill.addColorStop(0, "rgba(210,215,218,.24)");
        fill.addColorStop(1, "rgba(150,157,162,.055)");
        ctx.fillStyle = fill;
        ctx.fill();

        estackSpectrumSmoothPath(ctx, infinitePoints);
        ctx.strokeStyle = "rgba(205,210,214,.38)";
        ctx.lineWidth = 1.0;
        ctx.stroke();
    }

    const livePoints = estackSpectrumPoints(estackSpectrumRealtime, margin, innerW, innerH);
    estackSpectrumSmoothPath(ctx, livePoints);
    ctx.strokeStyle = "rgba(245,247,248,.88)";
    ctx.lineWidth = 1.45;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255,255,255,.22)";
    ctx.shadowBlur = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Separate analyzer scale on the right, because the EQ-response dB scale on
    // the left is a different quantity.
    ctx.font = "9px Abel, sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(230,235,237,.36)";
    [-20, -40, -60, -80].forEach(db => {
        const y = estackSpectrumDbToY(db, margin.top, innerH);
        ctx.fillText(`${db}`, margin.left + innerW - 4, y - 2);
    });
    ctx.fillText("dBFS", margin.left + innerW - 4, margin.top + 10);

    ctx.restore();
};

// Replace the original 30-band polling with realtime smoothing plus an
// integrated power-domain average (Infinite Spectrum).
startSpectrum = function() {
    if (spectrumTimer) clearInterval(spectrumTimer);
    spectrumTimer = setInterval(async () => {
        try {
            if (!DSP?.spectrum_connected) return;
            const levels = await DSP.getSpectrumData();
            if (!Array.isArray(levels)) return;

            const raw = ESTACK_SPECTRUM_FREQS.map((_, index) =>
                Math.max(ESTACK_SPECTRUM_MIN_DB, Math.min(ESTACK_SPECTRUM_MAX_DB, Number(levels[index * 2] ?? ESTACK_SPECTRUM_MIN_DB)))
            );

            const alpha = estackSpectrumMode === "slow" ? 0.13 : 0.48;
            if (estackSpectrumRealtime.length !== raw.length) {
                estackSpectrumRealtime = raw.slice();
            } else {
                estackSpectrumRealtime = raw.map((value, index) =>
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

            // Keep compatibility with the rest of CamillaNode code.
            lastSpectrum = estackSpectrumRealtime.slice();
            drawGraph();
        } catch (_) {}
    }, estackSpectrumMode === "slow" ? 180 : 110);
};

document.addEventListener("DOMContentLoaded", () => {
    estackInstallSpectrumToolbar();
    estackResetInfiniteSpectrum();
});
