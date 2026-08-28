// E-Stack Global EQ per-band visualisation layer.
// Draws each active PEQ response as a restrained coloured fill/stroke, then
// delegates to the existing renderer for the total response and numbered nodes.
// Visual only: no DSP/config mutation occurs here.

(() => {
    const originalDrawResponse = window.globalEqDrawResponse;
    if (typeof originalDrawResponse !== 'function') return;

    function selectedSlotFromUi() {
        const selected = document.querySelector('#globalEqBands .global-eq-band.selected');
        if (!selected) return typeof globalEqSelected === 'number' ? globalEqSelected : -1;
        const bands = [...document.querySelectorAll('#globalEqBands .global-eq-band')];
        return bands.indexOf(selected);
    }

    function drawBandShape(ctx, slot, freqs, width, height, margin, selected) {
        const filter = globalEqFilter(slot);
        if (!filter || filter.type !== 'Biquad') return;
        if (globalEqBandState(slot) !== 'active') return;

        const parameters = filter.parameters || {};
        const innerW = width - margin.left - margin.right;
        const zeroY = globalEqResponseY(0, height, margin.top, margin.bottom);
        const colour = globalEqColor(slot);

        const points = freqs.map(freq => ({
            x: margin.left + globalEqFreqToX(freq, innerW),
            y: globalEqResponseY(globalEqRbjDb(parameters, freq), height, margin.top, margin.bottom)
        }));
        if (!points.length) return;

        ctx.save();

        // Fill between this band's response and the 0 dB axis. The selected
        // band is deliberately stronger; the others stay subtle enough that
        // the cyan total response remains dominant.
        ctx.beginPath();
        ctx.moveTo(points[0].x, zeroY);
        for (const point of points) ctx.lineTo(point.x, point.y);
        ctx.lineTo(points[points.length - 1].x, zeroY);
        ctx.closePath();
        ctx.globalAlpha = selected ? 0.17 : 0.065;
        ctx.fillStyle = colour;
        ctx.fill();

        // Individual response outline.
        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.globalAlpha = selected ? 0.88 : 0.34;
        ctx.strokeStyle = colour;
        ctx.lineWidth = selected ? 1.75 : 1.05;
        ctx.stroke();

        ctx.restore();
    }

    window.globalEqDrawResponse = function(ctx, width, height, margin) {
        const freqs = globalEqLogFreqs(260);
        const selectedSlot = selectedSlotFromUi();

        // Draw non-selected bands first, selected band last so its shape is
        // readable when several filters overlap.
        for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
            if (slot === selectedSlot) continue;
            drawBandShape(ctx, slot, freqs, width, height, margin, false);
        }
        if (selectedSlot >= 0 && selectedSlot < GLOBAL_EQ_COUNT) {
            drawBandShape(ctx, selectedSlot, freqs, width, height, margin, true);
        }

        // Preserve the established E-Stack total response and band handles.
        return originalDrawResponse.call(this, ctx, width, height, margin);
    };
})();
