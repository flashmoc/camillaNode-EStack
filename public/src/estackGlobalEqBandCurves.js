// E-Stack Global EQ per-band visualisation layer.
// Gives every active PEQ band a clearly distinct Venu-style colour while
// preserving the E-Stack cyan total response above the individual shapes.
// Visual only: no DSP/config mutation occurs here.

(() => {
    const originalDrawResponse = window.globalEqDrawResponse;
    if (typeof originalDrawResponse !== 'function') return;

    // Deliberately separated hues, inspired by the quick-read colour coding of
    // dedicated loudspeaker processors while keeping saturation controlled.
    const BAND_PALETTE = [
        '#e34fc7', // 1 magenta
        '#43c978', // 2 green
        '#4f78e8', // 3 blue
        '#f08a45', // 4 orange
        '#35b9d3', // 5 cyan
        '#e4545d', // 6 red
        '#d5ad39', // 7 amber/yellow
        '#7bcf52', // 8 lime
        '#9568df', // 9 violet
        '#f06e9d'  // 10 pink
    ];

    function bandColour(slot) {
        return BAND_PALETTE[((Number(slot) || 0) % BAND_PALETTE.length + BAND_PALETTE.length) % BAND_PALETTE.length];
    }

    // Keep cards, nodes and graph shapes on the exact same per-band palette.
    // The established total-response stroke remains untouched because it uses
    // the E-Stack theme colour directly rather than globalEqColor().
    window.globalEqColor = bandColour;

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
        const colour = bandColour(slot);

        const points = freqs.map(freq => ({
            x: margin.left + globalEqFreqToX(freq, innerW),
            y: globalEqResponseY(globalEqRbjDb(parameters, freq), height, margin.top, margin.bottom)
        }));
        if (!points.length) return;

        ctx.save();

        // Venu-like translucent body. Non-selected bands stay readable instead
        // of collapsing into one cyan mass; selected band gets stronger focus.
        ctx.beginPath();
        ctx.moveTo(points[0].x, zeroY);
        for (const point of points) ctx.lineTo(point.x, point.y);
        ctx.lineTo(points[points.length - 1].x, zeroY);
        ctx.closePath();
        ctx.globalAlpha = selected ? 0.29 : 0.14;
        ctx.fillStyle = colour;
        ctx.fill();

        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.globalAlpha = selected ? 0.98 : 0.70;
        ctx.strokeStyle = colour;
        ctx.lineWidth = selected ? 2.05 : 1.25;
        ctx.stroke();

        ctx.restore();
    }

    window.globalEqDrawResponse = function(ctx, width, height, margin) {
        const freqs = globalEqLogFreqs(260);
        const selectedSlot = selectedSlotFromUi();

        // Draw non-selected bands first, selected band last so overlap remains
        // legible without changing the actual summed response.
        for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
            if (slot === selectedSlot) continue;
            drawBandShape(ctx, slot, freqs, width, height, margin, false);
        }
        if (selectedSlot >= 0 && selectedSlot < GLOBAL_EQ_COUNT) {
            drawBandShape(ctx, selectedSlot, freqs, width, height, margin, true);
        }

        // Preserve the established E-Stack total response and numbered nodes.
        return originalDrawResponse.call(this, ctx, width, height, margin);
    };
})();
