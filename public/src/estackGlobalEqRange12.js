// E-Stack Global EQ +/-12 dB range layer.
// Keeps the input EQ visually useful and prevents imports/editor writes from
// exceeding the intended system-EQ correction range. Downstream DSP is untouched.

(() => {
    const MIN_GAIN = -12;
    const MAX_GAIN = 12;
    const TICKS = [-12, -8, -4, 0, 4, 8, 12];

    const clamp = value => Math.max(MIN_GAIN, Math.min(MAX_GAIN, Number(value) || 0));

    function clampGlobalEqConfig() {
        const dsp = window.parent?.DSP;
        const filters = dsp?.config?.filters || {};
        for (const [name, filter] of Object.entries(filters)) {
            if (!/^GLOBAL_EQ_\d+$/i.test(name)) continue;
            if (!filter?.parameters) continue;
            filter.parameters.gain = Math.round(clamp(filter.parameters.gain) * 10) / 10;
        }
    }

    function constrainEditor() {
        document.querySelectorAll('#globalEqBands .global-eq-gain').forEach(slider => {
            slider.min = String(MIN_GAIN);
            slider.max = String(MAX_GAIN);
        });

        document.querySelectorAll('#globalEqBands .global-eq-fields label').forEach(label => {
            const title = label.querySelector('span')?.textContent?.trim().toUpperCase();
            if (title !== 'GAIN') return;
            const input = label.querySelector('input[type="number"]');
            if (!input) return;
            input.min = String(MIN_GAIN);
            input.max = String(MAX_GAIN);
        });
    }

    // Clamp every write, including imported EQs and saved presets, before the
    // existing guarded upload reaches CamillaDSP.
    const guardedUpload = window.globalEqUpload;
    if (typeof guardedUpload === 'function') {
        window.globalEqUpload = async function(reason) {
            clampGlobalEqConfig();
            return guardedUpload.call(this, reason);
        };
    }

    // Make direct editor commits obey the same limits before preview/upload.
    const originalCommit = window.globalEqCommit;
    if (typeof originalCommit === 'function') {
        window.globalEqCommit = function(slot, key, value) {
            return originalCommit.call(this, slot, key, key === 'gain' ? clamp(value) : value);
        };
    }

    // Response graph is intentionally +/-12 dB. This gives substantially more
    // visual resolution around the useful correction region than the old +/-18.
    window.globalEqResponseY = function(db, height, top, bottom) {
        const value = Math.max(MIN_GAIN, Math.min(MAX_GAIN, Number(db) || 0));
        return top + (MAX_GAIN - value) / (MAX_GAIN - MIN_GAIN) * (height - top - bottom);
    };

    window.globalEqDrawGrid = function(ctx, width, height, margin) {
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const freqTicks = [20,40,80,160,315,630,1250,2500,5000,10000,20000];
        ctx.font = '11px Abel, Arial';
        ctx.lineWidth = 1;

        for (const freq of freqTicks) {
            const x = margin.left + window.globalEqFreqToX(freq, innerW);
            ctx.strokeStyle = 'rgba(255,255,255,.10)';
            ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + innerH); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,.48)';
            ctx.textAlign = freq === 20 ? 'left' : freq === 20000 ? 'right' : 'center';
            ctx.fillText(freq >= 1000 ? `${Number((freq/1000).toFixed(freq >= 10000 ? 0 : 1))}k` : String(freq), x, height - 10);
        }

        for (const db of TICKS) {
            const y = window.globalEqResponseY(db, height, margin.top, margin.bottom);
            ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,.30)' : 'rgba(255,255,255,.09)';
            ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width - margin.right, y); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,.45)';
            ctx.textAlign = 'right';
            ctx.fillText(`${db > 0 ? '+' : ''}${db}`, margin.left - 7, y + 4);
        }

        const spectrumTicks = [0,-20,-40,-60,-80];
        ctx.textAlign = 'left';
        for (const db of spectrumTicks) {
            const y = window.globalEqSpectrumY(db, height, margin.top, margin.bottom);
            ctx.fillStyle = 'rgba(255,255,255,.32)';
            ctx.fillText(`${db}`, width - margin.right + 6, y + 4);
        }
        ctx.fillStyle = 'rgba(255,255,255,.38)';
        ctx.textAlign = 'left';
        ctx.fillText('EQ dB', 7, 13);
        ctx.textAlign = 'right';
        ctx.fillText('dBFS', width - 7, 13);
    };

    const originalRender = window.globalEqRender;
    if (typeof originalRender === 'function') {
        window.globalEqRender = function(...args) {
            const result = originalRender.apply(this, args);
            requestAnimationFrame(constrainEditor);
            return result;
        };
    }

    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(constrainEditor), { once: true });
})();
