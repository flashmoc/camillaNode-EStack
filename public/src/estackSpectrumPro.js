// Professional spectrum overlay for E-Stack DSP.
// The analyzer backend currently provides 30 real bands. This layer therefore
// avoids inventing fake FFT detail: RAW mode shows those measurements directly,
// FAST/SLOW only add optional temporal smoothing, and the curve between bands is
// drawn as straight segments instead of the previous heavily rounded spline.

const ESTACK_SPECTRUM_FREQS = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];
const ESTACK_SPECTRUM_MIN_DB = -90;
const ESTACK_SPECTRUM_MAX_DB = 0;
const ESTACK_SPECTRUM_VIEW_RANGES = {
    full: [20, 20000],
    sub: [20, 120],
    low: [60, 400],
    mid: [200, 3000],
    high: [1000, 20000]
};
const ESTACK_SPECTRUM_GRID_FREQS = [20,25,30,40,50,60,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];

const storedSpectrumMode = window.localStorage.getItem("estack.spectrum.speed");
let estackSpectrumMode = ["raw", "fast", "slow"].includes(storedSpectrumMode) ? storedSpectrumMode : "raw";
const storedSpectrumView = window.localStorage.getItem("estack.spectrum.view");
let estackSpectrumView = Object.prototype.hasOwnProperty.call(ESTACK_SPECTRUM_VIEW_RANGES, storedSpectrumView) ? storedSpectrumView : "full";
let estackSpectrumInfiniteEnabled = window.localStorage.getItem("estack.spectrum.infinite") !== "false";
let estackSpectrumRealtime = [];
let estackSpectrumPowerSum = [];
let estackSpectrumInfinite = [];
let estackSpectrumSamples = 0;

function estackSpectrumViewRange() {
    return ESTACK_SPECTRUM_VIEW_RANGES[estackSpectrumView] || ESTACK_SPECTRUM_VIEW_RANGES.full;
}

function estackSpectrumDbToY(db, top, height) {
    const value = Math.max(ESTACK_SPECTRUM_MIN_DB, Math.min(ESTACK_SPECTRUM_MAX_DB, Number(db)));
    return top + ((ESTACK_SPECTRUM_MAX_DB - value) / (ESTACK_SPECTRUM_MAX_DB - ESTACK_SPECTRUM_MIN_DB)) * height;
}

function estackSpectrumFormatFreq(freq) {
    if (freq >= 1000) {
        const value = freq / 1000;
        return `${Number(value.toFixed(value >= 10 ? 0 : value % 1 ? 2 : 0))}k`;
    }
    return String(freq);
}

// Keep the graph's existing freqToX API, but make its range selectable. This
// also zooms the response curves because estackGlobalGraph.js uses the same API.
freqToX = function(freq, width) {
    const [minFreq, maxFreq] = estackSpectrumViewRange();
    return width * Math.log(Number(freq) / minFreq) / Math.log(maxFreq / minFreq);
};

function estackSpectrumXToFreq(x, width) {
    const [minFreq, maxFreq] = estackSpectrumViewRange();
    const t = Math.max(0, Math.min(1, x / Math.max(1, width)));
    return minFreq * Math.pow(maxFreq / minFreq, t);
}

function estackSpectrumLinearPath(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
}

function estackSpectrumPoints(values, margin, innerW, innerH) {
    const [minFreq, maxFreq] = estackSpectrumViewRange();
    const visibleIndices = ESTACK_SPECTRUM_FREQS
        .map((freq, index) => ({ freq, index }))
        .filter(item => item.freq >= minFreq && item.freq <= maxFreq);

    // Include one neighbour on each side so a zoomed trace enters/leaves the
    // plot naturally instead of being cut at the first in-range analyzer band.
    if (visibleIndices.length) {
        const first = visibleIndices[0].index;
        const last = visibleIndices[visibleIndices.length - 1].index;
        if (first > 0) visibleIndices.unshift({ freq: ESTACK_SPECTRUM_FREQS[first - 1], index: first - 1 });
        if (last < ESTACK_SPECTRUM_FREQS.length - 1) visibleIndices.push({ freq: ESTACK_SPECTRUM_FREQS[last + 1], index: last + 1 });
    }

    return visibleIndices.map(({ freq, index }) => ({
        x: margin.left + freqToX(freq, innerW),
        y: estackSpectrumDbToY(values[index] ?? ESTACK_SPECTRUM_MIN_DB, margin.top, innerH),
        freq,
        index
    }));
}

function estackResetInfiniteSpectrum() {
    estackSpectrumPowerSum = Array(ESTACK_SPECTRUM_FREQS.length).fill(0);
    estackSpectrumInfinite = Array(ESTACK_SPECTRUM_FREQS.length).fill(ESTACK_SPECTRUM_MIN_DB);
    estackSpectrumSamples = 0;
    drawGraph();
}

function estackUpdateSpectrumToolbar() {
    for (const mode of ["Raw", "Fast", "Slow"]) {
        const button = document.getElementById(`estackSpectrum${mode}`);
        if (button) button.classList.toggle("active", estackSpectrumMode === mode.toLowerCase());
    }

    const infinite = document.getElementById("estackSpectrumInfinite");
    if (infinite) {
        infinite.classList.toggle("active", estackSpectrumInfiniteEnabled);
        infinite.setAttribute("aria-pressed", String(estackSpectrumInfiniteEnabled));
    }

    for (const view of Object.keys(ESTACK_SPECTRUM_VIEW_RANGES)) {
        const button = document.getElementById(`estackSpectrumView${view}`);
        if (button) button.classList.toggle("active", estackSpectrumView === view);
    }
}

function estackSetSpectrumMode(mode) {
    estackSpectrumMode = mode;
    window.localStorage.setItem("estack.spectrum.speed", mode);
    estackUpdateSpectrumToolbar();
    startSpectrum();
}

function estackSetSpectrumView(view) {
    if (!ESTACK_SPECTRUM_VIEW_RANGES[view]) return;
    estackSpectrumView = view;
    window.localStorage.setItem("estack.spectrum.view", view);
    estackUpdateSpectrumToolbar();
    drawGraph();
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
        <div class="estack-spectrum-buttons" style="flex-wrap:wrap;justify-content:flex-end">
            <button id="estackSpectrumRaw" type="button">RAW</button>
            <button id="estackSpectrumFast" type="button">FAST</button>
            <button id="estackSpectrumSlow" type="button">SLOW</button>
            <button id="estackSpectrumInfinite" type="button" aria-pressed="true">INFINITE</button>
            <button id="estackSpectrumReset" type="button">RESET</button>
            <button id="estackSpectrumViewfull" type="button">FULL</button>
            <button id="estackSpectrumViewsub" type="button">SUB</button>
            <button id="estackSpectrumViewlow" type="button">LOW</button>
            <button id="estackSpectrumViewmid" type="button">MID</button>
            <button id="estackSpectrumViewhigh" type="button">HIGH</button>
        </div>`;
    wrap.appendChild(toolbar);

    document.getElementById("estackSpectrumRaw").onclick = () => estackSetSpectrumMode("raw");
    document.getElementById("estackSpectrumFast").onclick = () => estackSetSpectrumMode("fast");
    document.getElementById("estackSpectrumSlow").onclick = () => estackSetSpectrumMode("slow");
    document.getElementById("estackSpectrumInfinite").onclick = () => {
        estackSpectrumInfiniteEnabled = !estackSpectrumInfiniteEnabled;
        window.localStorage.setItem("estack.spectrum.infinite", String(estackSpectrumInfiniteEnabled));
        estackUpdateSpectrumToolbar();
        drawGraph();
    };
    document.getElementById("estackSpectrumReset").onclick = estackResetInfiniteSpectrum;
    for (const view of Object.keys(ESTACK_SPECTRUM_VIEW_RANGES)) {
        document.getElementById(`estackSpectrumView${view}`).onclick = () => estackSetSpectrumView(view);
    }
    estackUpdateSpectrumToolbar();
}

// Override the coarse original grid with a denser log-frequency grid. Labels
// are collision-aware, so zoomed views gain detail without turning into clutter.
drawGrid = function(ctx, margin, innerW, innerH, range) {
    ctx.save();
    ctx.font = "10px Arial";
    ctx.lineWidth = 1;

    const [minFreq, maxFreq] = estackSpectrumViewRange();
    const ticks = ESTACK_SPECTRUM_GRID_FREQS.filter(freq => freq >= minFreq && freq <= maxFreq);
    let lastLabelX = -Infinity;

    for (const freq of ticks) {
        const x = margin.left + freqToX(freq, innerW);
        const decadeLike = [20,40,80,160,315,630,1250,2500,5000,10000,20000].includes(freq);
        ctx.strokeStyle = decadeLike ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.065)";
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + innerH);
        ctx.stroke();

        const mustLabel = freq === ticks[0] || freq === ticks[ticks.length - 1];
        if (mustLabel || x - lastLabelX >= 38) {
            ctx.fillStyle = decadeLike ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.40)";
            ctx.textAlign = freq === ticks[0] ? "left" : freq === ticks[ticks.length - 1] ? "right" : "center";
            ctx.fillText(estackSpectrumFormatFreq(freq), x, margin.top + innerH + 18);
            lastLabelX = x;
        }
    }

    for (let db = Math.ceil(range.min / range.step) * range.step; db <= range.max; db += range.step) {
        const y = margin.top + dbToY(db, innerH, range);
        ctx.strokeStyle = db === 0 ? "rgba(255,255,255,.32)" : "rgba(255,255,255,.10)";
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + innerW, y);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.48)";
        ctx.textAlign = "right";
        ctx.fillText(`${db}`, margin.left - 7, y + 4);
    }
    ctx.restore();
};

// Override the simple translucent bars from estackGlobalGraph.js.
estackDrawRtaOverlay = function(ctx, margin, innerW, innerH) {
    if (!Array.isArray(estackSpectrumRealtime) || !estackSpectrumRealtime.length) return;
    if (!window.parent.activeSettings?.enableSpectrum || !window.parent.activeSettings?.showEqualizerSpectrum) return;

    ctx.save();

    if (estackSpectrumInfiniteEnabled && estackSpectrumInfinite.length) {
        const infinitePoints = estackSpectrumPoints(estackSpectrumInfinite, margin, innerW, innerH);
        const bottom = margin.top + innerH;

        if (infinitePoints.length) {
            estackSpectrumLinearPath(ctx, infinitePoints);
            ctx.lineTo(infinitePoints[infinitePoints.length - 1].x, bottom);
            ctx.lineTo(infinitePoints[0].x, bottom);
            ctx.closePath();
            const fill = ctx.createLinearGradient(0, margin.top, 0, bottom);
            fill.addColorStop(0, "rgba(210,215,218,.22)");
            fill.addColorStop(1, "rgba(150,157,162,.045)");
            ctx.fillStyle = fill;
            ctx.fill();

            estackSpectrumLinearPath(ctx, infinitePoints);
            ctx.strokeStyle = "rgba(205,210,214,.34)";
            ctx.lineWidth = 1.0;
            ctx.stroke();
        }
    }

    const livePoints = estackSpectrumPoints(estackSpectrumRealtime, margin, innerW, innerH);
    if (livePoints.length) {
        estackSpectrumLinearPath(ctx, livePoints);
        ctx.strokeStyle = "rgba(245,247,248,.92)";
        ctx.lineWidth = estackSpectrumMode === "raw" ? 1.25 : 1.45;
        ctx.lineJoin = "miter";
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(255,255,255,.18)";
        ctx.shadowBlur = 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    // Analyzer scale remains independent from the transfer-function dB scale.
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

function estackSpectrumNearestIndex(freq) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    ESTACK_SPECTRUM_FREQS.forEach((candidate, index) => {
        const distance = Math.abs(Math.log(candidate / freq));
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    });
    return bestIndex;
}

function estackInstallSpectrumTooltip() {
    const wrap = document.querySelector(".venu-graph-wrap");
    const canvas = document.getElementById("responseCanvas");
    if (!wrap || !canvas || document.getElementById("estackSpectrumTooltip")) return;

    const tooltip = document.createElement("div");
    tooltip.id = "estackSpectrumTooltip";
    tooltip.style.cssText = [
        "position:absolute",
        "z-index:8",
        "display:none",
        "pointer-events:none",
        "padding:6px 8px",
        "border:1px solid hsla(0,0%,100%,.14)",
        "border-radius:5px",
        "background:rgba(8,12,14,.90)",
        "color:rgba(245,248,248,.88)",
        "font:10px Abel,sans-serif",
        "font-variant-numeric:tabular-nums",
        "line-height:1.35",
        "box-shadow:0 4px 14px rgba(0,0,0,.32)"
    ].join(";");
    wrap.appendChild(tooltip);

    canvas.addEventListener("mousemove", event => {
        const rect = canvas.getBoundingClientRect();
        const margin = { left: 50, right: 18, top: 18, bottom: 31 };
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const innerW = rect.width - margin.left - margin.right;
        const innerH = rect.height - margin.top - margin.bottom;

        if (x < margin.left || x > margin.left + innerW || y < margin.top || y > margin.top + innerH) {
            tooltip.style.display = "none";
            return;
        }

        const freq = estackSpectrumXToFreq(x - margin.left, innerW);
        const nearest = estackSpectrumNearestIndex(freq);
        const rta = Number(estackSpectrumRealtime[nearest]);
        let response = 0;
        try {
            const entries = filterEntries(selectedChannel).filter(([, filter]) => ["BiquadCombo", "Biquad", "Gain"].includes(filter?.type));
            response = sumDb(entries, freq);
        } catch (_) {}

        tooltip.innerHTML = `<strong>${estackSpectrumFormatFreq(Math.round(freq))} Hz</strong><br>` +
            `RTA ${Number.isFinite(rta) ? rta.toFixed(1) : "—"} dBFS · ${channelName(selectedChannel)} ${Number(response).toFixed(1)} dB`;
        tooltip.style.display = "block";

        const wrapRect = wrap.getBoundingClientRect();
        const localX = event.clientX - wrapRect.left;
        const localY = event.clientY - wrapRect.top;
        const tooltipWidth = tooltip.offsetWidth || 150;
        const left = Math.min(wrap.clientWidth - tooltipWidth - 8, localX + 14);
        tooltip.style.left = `${Math.max(8, left)}px`;
        tooltip.style.top = `${Math.max(8, localY - 34)}px`;
    });

    canvas.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
    });
}

// Replace the original polling with three explicit time-domain behaviours.
// RAW = no temporal smoothing, FAST = light smoothing, SLOW = visual averaging.
startSpectrum = function() {
    if (spectrumTimer) clearInterval(spectrumTimer);
    const interval = estackSpectrumMode === "raw" ? 75 : estackSpectrumMode === "fast" ? 95 : 160;

    spectrumTimer = setInterval(async () => {
        try {
            if (!DSP?.spectrum_connected) return;
            const levels = await DSP.getSpectrumData();
            if (!Array.isArray(levels)) return;

            const raw = ESTACK_SPECTRUM_FREQS.map((_, index) =>
                Math.max(ESTACK_SPECTRUM_MIN_DB, Math.min(ESTACK_SPECTRUM_MAX_DB, Number(levels[index * 2] ?? ESTACK_SPECTRUM_MIN_DB)))
            );

            const alpha = estackSpectrumMode === "raw" ? 1 : estackSpectrumMode === "fast" ? 0.82 : 0.24;
            if (estackSpectrumRealtime.length !== raw.length) {
                estackSpectrumRealtime = raw.slice();
            } else if (alpha >= 1) {
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
    }, interval);
};

document.addEventListener("DOMContentLoaded", () => {
    estackInstallSpectrumToolbar();
    estackInstallSpectrumTooltip();
    estackResetInfiniteSpectrum();
});
