// Canvas color parsers do not reliably resolve CSS var() expressions.
// Repaint the Global EQ response with the actual CamillaNode theme accent.
globalEqDrawResponse = function(ctx, width, height, margin) {
    const innerW = width - margin.left - margin.right;
    const freqs = globalEqLogFreqs();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--geq-accent").trim() || "#62d3bd";

    ctx.beginPath();
    freqs.forEach((freq, index) => {
        const x = margin.left + globalEqFreqToX(freq, innerW);
        const y = globalEqResponseY(globalEqTotalDb(freq), height, margin.top, margin.bottom);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    for (let slot = 0; slot < GLOBAL_EQ_COUNT; slot++) {
        const filter = globalEqFilter(slot);
        const freq = Number(filter?.parameters?.freq || GLOBAL_EQ_DEFAULT_FREQS[slot]);
        const x = margin.left + globalEqFreqToX(freq, innerW);
        const y = globalEqResponseY(globalEqTotalDb(freq), height, margin.top, margin.bottom);
        const selected = slot === globalEqSelected;
        const state = globalEqBandState(slot);
        ctx.beginPath();
        ctx.arc(x, y, selected ? 10 : 8, 0, Math.PI * 2);
        ctx.fillStyle = selected ? "rgba(255,255,255,.96)" : "rgba(32,42,42,.90)";
        ctx.fill();
        ctx.lineWidth = selected ? 2.4 : 1.4;
        ctx.strokeStyle = state === "active" ? globalEqColor(slot) : "rgba(210,220,220,.35)";
        ctx.stroke();
        ctx.fillStyle = selected ? "#182020" : state === "active" ? "#fff" : "rgba(255,255,255,.55)";
        ctx.font = `${selected ? "bold " : ""}11px Abel, Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(slot + 1), x, y + .5);
    }
};
