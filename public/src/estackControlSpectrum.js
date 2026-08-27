// 30-band segmented analyzer for the Control / Inputs section.
// Visual language intentionally follows the original CamillaNode spectrum:
// dark columns, stacked luminous segments and frequency labels above the bars.
const ESTACK_CONTROL_SPECTRUM_FREQS = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];
const ESTACK_CONTROL_SPECTRUM_MIN_DB = -80;
const ESTACK_CONTROL_SPECTRUM_MAX_DB = 0;

let estackControlSpectrumTimer = null;
let estackControlSpectrumBusy = false;
let estackControlSpectrumLastLevels = ESTACK_CONTROL_SPECTRUM_FREQS.map(() => ESTACK_CONTROL_SPECTRUM_MIN_DB);

function estackControlSpectrumWaitForDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

function estackControlSpectrumResize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
}

function estackControlSpectrumColor(segment, segmentCount) {
    const t = segmentCount <= 1 ? 0 : segment / (segmentCount - 1);
    // Blue at the bottom -> cyan -> green -> yellow towards the top.
    const hue = 214 - (164 * t);
    const saturation = 58 + (24 * t);
    const lightness = 55 + (5 * t);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function estackControlSpectrumLabel(freq) {
    if (freq >= 1000) {
        const value = freq / 1000;
        return `${Number(value.toFixed(value % 1 ? 1 : 0))}k`;
    }
    return String(freq);
}

function estackControlSpectrumDraw(canvas, levels) {
    estackControlSpectrumResize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const count = ESTACK_CONTROL_SPECTRUM_FREQS.length;
    const topPad = 18;
    const bottomPad = 4;
    const sidePad = 2;
    const innerH = Math.max(1, height - topPad - bottomPad);
    const gap = Math.max(2, Math.min(4, width / 360));
    const barW = Math.max(4, (width - sidePad * 2 - gap * (count - 1)) / count);

    const segmentGap = 2;
    const segmentH = Math.max(3, Math.min(5, innerH / 26));
    const segmentCount = Math.max(8, Math.floor((innerH + segmentGap) / (segmentH + segmentGap)));
    const actualStackH = segmentCount * segmentH + (segmentCount - 1) * segmentGap;
    const stackTop = topPad + Math.max(0, (innerH - actualStackH) / 2);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(6, Math.min(8, barW * .32))}px Abel, sans-serif`;

    for (let index = 0; index < count; index++) {
        const x = sidePad + index * (barW + gap);
        const db = Math.max(
            ESTACK_CONTROL_SPECTRUM_MIN_DB,
            Math.min(ESTACK_CONTROL_SPECTRUM_MAX_DB, Number(levels[index] ?? ESTACK_CONTROL_SPECTRUM_MIN_DB))
        );
        const norm = (db - ESTACK_CONTROL_SPECTRUM_MIN_DB) /
            (ESTACK_CONTROL_SPECTRUM_MAX_DB - ESTACK_CONTROL_SPECTRUM_MIN_DB);
        const activeSegments = Math.max(0, Math.min(segmentCount, Math.round(norm * segmentCount)));

        // Frequency label above each column, as in the original CamillaNode view.
        if (barW >= 13 || index % 2 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,.30)';
            ctx.fillText(estackControlSpectrumLabel(ESTACK_CONTROL_SPECTRUM_FREQS[index]), x + barW / 2, 7);
        }

        // Dark inactive segment stack.
        for (let segment = 0; segment < segmentCount; segment++) {
            const y = stackTop + actualStackH - segmentH - segment * (segmentH + segmentGap);
            ctx.fillStyle = 'rgba(8,18,26,.78)';
            ctx.fillRect(x, y, barW, segmentH);
        }

        // Active luminous segments grow from bottom to top.
        for (let segment = 0; segment < activeSegments; segment++) {
            const y = stackTop + actualStackH - segmentH - segment * (segmentH + segmentGap);
            ctx.fillStyle = estackControlSpectrumColor(segment, segmentCount);
            ctx.fillRect(x, y, barW, segmentH);
        }
    }
}

async function estackControlSpectrumStart() {
    const canvas = document.getElementById('estackInputSpectrumCanvas');
    const status = document.getElementById('estackInputSpectrumStatus');
    if (!canvas) return;

    const DSP = await estackControlSpectrumWaitForDSP();
    if (status) status.textContent = 'SPECTRUM';

    const redraw = () => estackControlSpectrumDraw(canvas, estackControlSpectrumLastLevels);
    redraw();

    if (window.ResizeObserver) {
        new ResizeObserver(redraw).observe(canvas);
    }

    if (estackControlSpectrumTimer) clearInterval(estackControlSpectrumTimer);
    estackControlSpectrumTimer = setInterval(async () => {
        if (estackControlSpectrumBusy) return;
        estackControlSpectrumBusy = true;
        try {
            if (!DSP?.spectrum_connected) {
                if (status) status.textContent = 'SPECTRUM OFF';
                return;
            }
            const raw = await DSP.getSpectrumData();
            if (!Array.isArray(raw)) return;
            estackControlSpectrumLastLevels = ESTACK_CONTROL_SPECTRUM_FREQS.map((_, index) => {
                const a = Number(raw[index * 2] ?? ESTACK_CONTROL_SPECTRUM_MIN_DB);
                const b = Number(raw[index * 2 + 1] ?? a);
                return Math.max(a, b);
            });
            redraw();
            if (status) status.textContent = 'SPECTRUM';
        } catch (_) {
            if (status) status.textContent = 'SPECTRUM WAIT';
        } finally {
            estackControlSpectrumBusy = false;
        }
    }, 80);
}

document.addEventListener('DOMContentLoaded', estackControlSpectrumStart);
window.addEventListener('beforeunload', () => {
    if (estackControlSpectrumTimer) clearInterval(estackControlSpectrumTimer);
});
