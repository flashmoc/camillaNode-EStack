// Adds VENU-style variable phase to the existing Output / Protection surface.
// The DSP implementation is a first-order CamillaDSP all-pass (AllpassFO).
// 0 degrees means no E-Stack phase filter exists in the signal path.

(function installEStackOutputPhase() {
    const PREFIX = "ESTACK_PHASE_";

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number(value)));
    }

    function phaseName(channel = selectedChannel) {
        return `${PREFIX}CH${Number(channel)}`;
    }

    function phaseEntry(channel = selectedChannel) {
        const name = phaseName(channel);
        const filter = DSP?.config?.filters?.[name];
        if (filter?.type !== "Biquad" || filter?.parameters?.type !== "AllpassFO") return null;
        return [name, filter];
    }

    function phaseMetadata(channel = selectedChannel) {
        const entry = phaseEntry(channel);
        if (!entry) return null;
        const description = String(entry[1]?.description || "");
        const match = description.match(/\((-?\d+(?:\.\d+)?)\s*deg\s*@\s*(\d+(?:\.\d+)?)\s*Hz(?:;[^)]*)?\)/i);
        if (!match) return null;
        const degrees = Number(match[1]);
        const referenceHz = Number(match[2]);
        if (!Number.isFinite(degrees) || !Number.isFinite(referenceHz) || referenceHz <= 0) return null;
        return {
            degrees: clamp(degrees, -179, 0),
            referenceHz
        };
    }

    function referenceFrequency(channel = selectedChannel) {
        const lpf = getCrossover("lpf", channel);
        if (lpf) return Number(lpf[1]?.parameters?.freq || 1000);
        const hpf = getCrossover("hpf", channel);
        return Number(hpf?.[1]?.parameters?.freq || 1000);
    }

    function activeReferenceFrequency(channel = selectedChannel) {
        return phaseMetadata(channel)?.referenceHz || referenceFrequency(channel);
    }

    // CamillaDSP AllpassFO phase at reference f:
    // phi = -2 atan(tan(pi*f/fs) / tan(pi*fc/fs)).
    function allpassFrequencyForPhase(phaseDeg, referenceHz) {
        const fs = Number(DSP?.config?.devices?.samplerate || 48000);
        const phase = clamp(Math.abs(Number(phaseDeg)), 0.01, 179.5);
        const reference = clamp(referenceHz, 1, fs / 2 - 1);
        const tReference = Math.tan(Math.PI * reference / fs);
        const divisor = Math.tan(phase * Math.PI / 360);
        const tDesign = tReference / Math.max(1e-9, divisor);
        return clamp((fs / Math.PI) * Math.atan(tDesign), 1, fs / 2 - 1);
    }

    function phaseForAllpassFrequency(filterHz, referenceHz) {
        const fs = Number(DSP?.config?.devices?.samplerate || 48000);
        const fc = clamp(filterHz, 1, fs / 2 - 1);
        const reference = clamp(referenceHz, 1, fs / 2 - 1);
        const ratio = Math.tan(Math.PI * reference / fs) / Math.tan(Math.PI * fc / fs);
        return -2 * Math.atan(ratio) * 180 / Math.PI;
    }

    function currentPhase(channel = selectedChannel) {
        const entry = phaseEntry(channel);
        if (!entry) return 0;
        const metadata = phaseMetadata(channel);
        if (metadata) return metadata.degrees;
        return phaseForAllpassFrequency(Number(entry[1]?.parameters?.freq || 1000), referenceFrequency(channel));
    }

    function phaseOutputStep(channel = selectedChannel) {
        const pipeline = DSP?.config?.pipeline || [];
        const mixerIndex = pipeline.findIndex(step => step?.type === "Mixer");
        if (mixerIndex < 0) throw new Error("No mixer found before output processing");

        const candidate = pipeline
            .slice(mixerIndex + 1)
            .find(step => step?.type === "Filter" && stepChannels(step).includes(Number(channel)) &&
                (step.names || []).some(name => ["Gain", "Delay", "BiquadCombo"].includes(DSP?.config?.filters?.[name]?.type)));

        if (!candidate) throw new Error(`No output filter stage found for ${channelName(channel)}`);
        const channels = stepChannels(candidate);
        if (channels.length !== 1 || channels[0] !== Number(channel)) {
            throw new Error("Phase trim requires an independent per-output filter stage");
        }
        return candidate;
    }

    function removePhaseEverywhere(name) {
        for (const step of (DSP?.config?.pipeline || [])) {
            if (step?.type !== "Filter" || !Array.isArray(step.names)) continue;
            step.names = step.names.filter(item => item !== name);
        }
        if (DSP?.config?.filters) delete DSP.config.filters[name];
    }

    function attachPhaseBeforeGain(name, channel = selectedChannel) {
        const step = phaseOutputStep(channel);
        if (!Array.isArray(step.names)) step.names = [];
        step.names = step.names.filter(item => item !== name);

        let index = step.names.findIndex(item => DSP?.config?.filters?.[item]?.type === "Gain");
        if (index < 0) index = step.names.findIndex(item => DSP?.config?.filters?.[item]?.type === "Delay");
        if (index < 0) index = step.names.length;
        step.names.splice(index, 0, name);
    }

    async function commitPhase(nextPhase) {
        const phase = clamp(nextPhase, -179, 0);
        const channel = Number(selectedChannel);
        const name = phaseName(channel);
        const before = typeof DSP.estackConfigSnapshot === "function"
            ? DSP.estackConfigSnapshot()
            : JSON.parse(JSON.stringify(DSP.config));

        try {
            if (Math.abs(phase) < 0.05) {
                removePhaseEverywhere(name);
            } else {
                // If an existing E-Stack phase filter carries an explicit reference
                // (for example a Measurement Batch phase @ MID HPF), keep that
                // reference when the knob is read/edited instead of silently
                // reinterpreting the same all-pass at the band's LPF.
                const reference = activeReferenceFrequency(channel);
                const filterFreq = allpassFrequencyForPhase(phase, reference);
                DSP.config.filters = DSP.config.filters || {};
                DSP.config.filters[name] = {
                    type: "Biquad",
                    description: `E-Stack phase trim ${channelName(channel)} (${phase.toFixed(1)} deg @ ${reference.toFixed(1)} Hz)`,
                    parameters: {
                        type: "AllpassFO",
                        freq: Math.round(filterFreq * 10) / 10
                    }
                };
                attachPhaseBeforeGain(name, channel);
            }

            if (typeof DSP.uploadConfigGuarded !== "function") {
                throw new Error("E-Stack guarded configuration writer is unavailable");
            }
            await DSP.uploadConfigGuarded(before, {
                name: `${channelName(channel)} phase trim`,
                allowedFilterPrefixes: [PREFIX]
            });
            await DSP.downloadConfig();
            setStatus(`${channelName(channel)} phase · applied`, "ok");
            renderAll(false);
        } catch (error) {
            console.error("E-Stack phase update failed", error);
            try { await DSP.downloadConfig(); } catch (_) {}
            setStatus(`Phase · ERROR: ${error?.message || error}`, "error");
            renderAll(false);
        }
    }

    const baseRender = estackV2RenderOutputProtection;
    estackV2RenderOutputProtection = function(root) {
        baseRender(root);

        const outputBody = root.querySelector(".estack-v2-output-body");
        if (!outputBody) return;
        outputBody.classList.add("estack-phase-enabled");

        const reference = activeReferenceFrequency();
        const locked = !systemEditEnabled;
        const phaseKnob = estackV2Knob({
            label: "PHASE",
            value: currentPhase(),
            min: -179,
            max: 0,
            step: .1,
            unit: "°",
            resetValue: 0,
            preview: null,
            commit: locked ? null : commitPhase
        }, locked);
        phaseKnob.classList.add("estack-output-phase");
        phaseKnob.title = `First-order all-pass phase trim referenced at ${Math.round(reference)} Hz. 0° removes the phase filter.`;

        // Existing V2 order is Gain / switches / Delay. Re-order to the more
        // useful speaker-management sequence Gain / Delay / Phase / switches.
        const switches = outputBody.querySelector(".estack-v2-switches");
        outputBody.appendChild(phaseKnob);
        if (switches) outputBody.appendChild(switches);
    };
})();
