// Deterministic one-click mute handling for the E-Stack Control page.
// The original button inferred state from its CSS class and reused the fader gain
// while muting. This capture-phase handler instead toggles only the Gain filter's
// real `mute` parameter, then reflects the state confirmed by CamillaDSP.

(function () {
    function channelFromMuteButton(button) {
        const strip = button?.closest?.(".estack-mixer-strip");
        const fader = strip?.querySelector?.(".estack-vertical-fader[id^='outputGain']");
        const match = String(fader?.id || "").match(/^outputGain(\d+)$/);
        return match ? Number(match[1]) : null;
    }

    function applyButtonState(button, muted) {
        button.classList.toggle("active", !!muted);
        button.textContent = muted ? "MUTED" : "MUTE";
        button.setAttribute("aria-pressed", String(!!muted));
    }

    async function setRealMute(channel, desired) {
        const entry = gainEntryForChannel(channel);
        if (!entry) throw new Error("Gain filter not found");

        const [, filter] = entry;
        filter.parameters = filter.parameters || {};
        filter.parameters.mute = !!desired;

        const ok = await DSP.uploadConfig();
        if (!ok) throw new Error("CamillaDSP rejected mute change");
        await DSP.downloadConfig();

        const confirmed = gainEntryForChannel(channel);
        if (!confirmed) throw new Error("Gain filter missing after refresh");
        return !!confirmed[1]?.parameters?.mute;
    }

    document.addEventListener("click", async event => {
        const button = event.target?.closest?.(".estack-mute-button");
        if (!button) return;

        const channel = channelFromMuteButton(button);
        if (!Number.isInteger(channel)) return;

        // Stop the legacy target listener before it can run as well.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (button.dataset.muteBusy === "true") return;
        button.dataset.muteBusy = "true";
        button.disabled = true;

        const entry = gainEntryForChannel(channel);
        const previous = !!entry?.[1]?.parameters?.mute;
        const desired = !previous;

        // Immediate visual response; final state is always replaced by the DSP-confirmed value.
        applyButtonState(button, desired);

        try {
            const actual = await setRealMute(channel, desired);
            applyButtonState(button, actual);
            const name = EStackControlChannels[channel]?.name || `OUT ${channel + 1}`;
            setMixerStatus(`${name}: ${actual ? "MUTED" : "ON"}`, "ok");
        } catch (error) {
            console.error("Mute update failed", error);
            try {
                await DSP.downloadConfig();
                const actual = !!gainEntryForChannel(channel)?.[1]?.parameters?.mute;
                applyButtonState(button, actual);
            } catch (_) {
                applyButtonState(button, previous);
            }
            setMixerStatus(`Mute update failed: ${error?.message || error}`, "error");
        } finally {
            button.disabled = false;
            delete button.dataset.muteBusy;
        }
    }, true);
})();
