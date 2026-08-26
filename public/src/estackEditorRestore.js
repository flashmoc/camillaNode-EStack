// Restore the module editor beneath the global six-output response graph.
// The global graph is presentation-only: it must never prevent Crossover / PEQ /
// Output / Protection controls from rendering.

function estackRenderStep(name, fn) {
    try {
        fn();
        return true;
    } catch (error) {
        console.error(`E-Stack render step failed: ${name}`, error);
        const status = document.getElementById("estackEqStatus");
        if (status) {
            status.textContent = `${name} UI error: ${error?.message || error}`;
            status.dataset.state = "error";
        }
        return false;
    }
}

// Replace renderAll with a fault-isolated version. One presentation component
// failing must not blank the parameter editor.
renderAll = function(download = false) {
    const work = async () => {
        if (!DSP) return;
        if (download) await DSP.downloadConfig();

        estackRenderStep("Output selector", renderChannelTabs);
        estackRenderStep("Module selector", renderModuleTabs);
        estackRenderStep("Graph header", renderHeader);
        estackRenderStep("Band selector", renderBandSelector);
        estackRenderStep("Parameter editor", renderControls);
        estackRenderStep("Filter count", updateCount);
        estackRenderStep("System graph", drawGraph);
    };

    work().catch(error => {
        console.error("E-Stack render failed", error);
        const status = document.getElementById("estackEqStatus");
        if (status) {
            status.textContent = error?.message || String(error);
            status.dataset.state = "error";
        }
    });
};

// Re-render once the async CamillaDSP bootstrap has had time to complete. This
// also repairs a stale page after a hard refresh without touching DSP settings.
document.addEventListener("DOMContentLoaded", () => {
    window.setTimeout(() => {
        if (window.DSP || typeof DSP !== "undefined") renderAll(false);
    }, 350);
});
