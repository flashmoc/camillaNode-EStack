// Compact 30-band analyzer for the Control / Inputs section.
const ESTACK_CONTROL_SPECTRUM_FREQS = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];
const ESTACK_CONTROL_SPECTRUM_MIN_DB = -80;
const ESTACK_CONTROL_SPECTRUM_MAX_DB = 0;

let estackControlSpectrumTimer = null;
let estackControlSpectrumBusy = false;

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

function estackControlSpectrumDraw(canvas, levels) {
    estackControlSpectrumResize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const hueRaw = getComputedStyle(document.documentElement).getPropertyValue('--bck-hue').trim();
    const hue = Number.isFinite(Number(hueRaw)) ? Number(hueRaw) : 180;
    const topPad = 3;
    const bottomPad = 14;
    const innerH = Math.max(1, height - topPad - bottomPad);
    const count = ESTACK_CONTROL_SPECTRUM_FREQS.length;
    const gap = Math.max(1, Math.min(3, width / 600));
    const barW = Math.max(2, (width - gap * (count - 1)) / count);

    // Subtle horizontal references.
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    for (const db of [-20, -40, -60]) {
        const y = topPad + ((ESTACK_CONTROL_SPECTRUM_MAX_DB - db) / (ESTACK_CONTROL_SPECTRUM_MAX_DB - ESTACK_CONTROL_SPECTRUM_MIN_DB)) * innerH;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + .5);
        ctx.lineTo(width, Math.round(y) + .5);
        ctx.stroke();
    }

    levels.forEach((db, index) => {
        const clamped = Math.max(ESTACK_CONTROL_SPECTRUM_MIN_DB, Math.min(ESTACK_CONTROL_SPECTRUM_MAX_DB, Number(db)));
        const norm = (clamped - ESTACK_CONTROL_SPECTRUM_MIN_DB) / (ESTACK_CONTROL_SPECTRUM_MAX_DB - ESTACK_CONTROL_SPECTRUM_MIN_DB);
        const h = Math.max(1, norm * innerH);
        const x = index * (barW + gap);
        const y = topPad + innerH - h;

        const alpha = .35 + norm * .55;
        ctx.fillStyle = `hsla(${hue}, 62%, ${48 + norm * 18}%, ${alpha})`;
        ctx.fillRect(x, y, barW, h);
    });

    const labelIndices = [0, 4, 7, 11, 16, 20, 24, 26, 29];
    ctx.fillStyle = 'rgba(255,255,255,.30)';
    ctx.font = '7px Abel, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const index of labelIndices) {
        const freq = ESTACK_CONTROL_SPECTRUM_FREQS[index];
        const label = freq >= 1000 ? `${Number((freq / 1000).toFixed(freq % 1000 ? 1 : 0))}k` : String(freq);
        const x = index * (barW + gap) + barW / 2;
        ctx.fillText(label, x, height - 1);
    }
}

async function estackControlSpectrumStart() {
    const canvas = document.getElementById('estackInputSpectrumCanvas');
    const status = document.getElementById('estackInputSpectrumStatus');
    if (!canvas) return;

    const DSP = await estackControlSpectrumWaitForDSP();
    if (status) status.textContent = 'SPECTRUM';

    const drawSilence = () => estackControlSpectrumDraw(canvas, ESTACK_CONTROL_SPECTRUM_FREQS.map(() => ESTACK_CONTROL_SPECTRUM_MIN_DB));
    drawSilence();

    if (window.ResizeObserver) {
        new ResizeObserver(() => drawSilence()).observe(canvas);
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
            const levels = ESTACK_CONTROL_SPECTRUM_FREQS.map((_, index) => {
                const a = Number(raw[index * 2] ?? ESTACK_CONTROL_SPECTRUM_MIN_DB);
                const b = Number(raw[index * 2 + 1] ?? a);
                return Math.max(a, b);
            });
            estackControlSpectrumDraw(canvas, levels);
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
