// Layout helper for the integrated meter/fader Control surface.
// It only decorates DOM controls; DSP mutation remains owned by estackBasic.js.

function estackControlV2DecorateFaders() {
    document.querySelectorAll(".estack-vertical-fader").forEach(fader => {
        const min = Number(fader.min);
        const max = Number(fader.max);
        const wrap = fader.closest(".estack-fader-wrap");
        if (!wrap || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return;

        const zeroPosition = ((max - 0) / (max - min)) * 100;
        wrap.style.setProperty("--estack-unity-pos", `${Math.max(0, Math.min(100, zeroPosition))}%`);
        fader.dataset.estackIntegratedMeter = "true";
    });
}

function estackControlV2Init() {
    estackControlV2DecorateFaders();
    const root = document.getElementById("estackMixerStrips") || document.body;
    const observer = new MutationObserver(estackControlV2DecorateFaders);
    observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", estackControlV2Init);
} else {
    estackControlV2Init();
}
