// Guard the existing Global EQ engine without changing its UI/editor logic.
// globalEqCommit mutates DSP.config locally before calling globalEqUpload, so the
// wrapper fetches a fresh live baseline directly from CamillaDSP immediately
// before the guarded SetConfigJson.

(function installGlobalEqGuard() {
    const GLOBAL_EQ_STEP = "E-Stack global input EQ";

    window.globalEqUpload = async function(reason) {
        const dsp = window.parent?.DSP;
        try {
            if (!dsp) throw new Error("CamillaDSP is unavailable");
            if (typeof dsp.uploadConfigGuarded !== "function") throw new Error("E-Stack config guard is unavailable");

            if (typeof window.globalEqCleanupNeutralPipeline === "function") {
                window.globalEqCleanupNeutralPipeline();
            }

            // GetConfigJson returns the live DSP graph without overwriting the
            // locally edited dsp.config object.
            const beforeConfig = await dsp.sendDSPMessage("GetConfigJson");
            const mixerBefore = (dsp.config?.pipeline || []).findIndex(step => step?.type === "Mixer");
            if (mixerBefore < 0) throw new Error("Mixer stage missing");

            await dsp.uploadConfigGuarded(beforeConfig, {
                name: "Global EQ",
                allowedFilterPrefixes: ["GLOBAL_EQ_"],
                allowedStepDescriptions: [GLOBAL_EQ_STEP]
            });
            await dsp.downloadConfig();

            const pipeline = dsp.config?.pipeline || [];
            const step = pipeline.find(item =>
                item?.type === "Filter" && (
                    item?.description === GLOBAL_EQ_STEP ||
                    (item.names || []).some(name => String(name).startsWith("GLOBAL_EQ_"))
                )
            );
            const mixerIndex = pipeline.findIndex(item => item?.type === "Mixer");
            if (step && pipeline.indexOf(step) >= mixerIndex) throw new Error("Global EQ is not before the mixer");

            if (typeof window.globalEqStatus === "function") window.globalEqStatus(`${reason} · applied · guarded`, "ok");
            if (typeof window.globalEqRender === "function") window.globalEqRender();
            return true;
        } catch (error) {
            console.error("Guarded Global EQ upload failed", error);
            if (typeof window.globalEqStatus === "function") {
                window.globalEqStatus(`${reason} · ERROR: ${error?.message || error}`, "error");
            }
            try { await dsp?.downloadConfig?.(); } catch (_) {}
            if (typeof window.globalEqRender === "function") window.globalEqRender();
            return false;
        }
    };
})();
