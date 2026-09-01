// E-Stack PEQ pipeline semantics.
//
// UI slots stay visible even when they are not processing audio. USER_CHx_PEQ_xx
// filter definitions are retained so their FREQ/GAIN/Q values survive bypass,
// while the pipeline contains only PEQs that are both enabled and non-neutral.
// Active PEQs are kept in speaker-DSP order:
//   crossover (HPF/LPF) -> PEQ -> output Gain -> Delay -> protection/Limiter.

const ESTACK_PEQ_OUTPUT_GAINS = {
    0: "sub_gain",
    1: "kick_gain",
    2: "mid_l_gain",
    3: "mid_r_gain",
    4: "high_l_gain",
    5: "high_r_gain"
};

function estackPeqStableName(channel, slot) {
    return `USER_CH${Number(channel)}_PEQ_${String(Number(slot) + 1).padStart(2, "0")}`;
}

function estackPeqStepChannels(step) {
    if (Array.isArray(step?.channels)) return step.channels.map(Number);
    if (step?.channel !== undefined && step?.channel !== null) return [Number(step.channel)];
    return [];
}

function estackPeqFilterSteps(channel) {
    return (DSP?.config?.pipeline || []).filter(step =>
        step?.type === "Filter" && estackPeqStepChannels(step).includes(Number(channel))
    );
}

function estackPeqOutputStep(channel) {
    const gainName = ESTACK_PEQ_OUTPUT_GAINS[Number(channel)];
    const steps = estackPeqFilterSteps(channel);

    if (gainName) {
        const exact = steps.find(step => Array.isArray(step.names) && step.names.includes(gainName));
        if (exact) return exact;
    }

    // Fallback for future renamed configs: choose the loudspeaker processing
    // step, not a capture-side/input-only filter step.
    return steps.find(step => (step.names || []).some(name => {
        const type = DSP?.config?.filters?.[name]?.type;
        return type === "Gain" || type === "Delay" || type === "Limiter";
    })) || steps[steps.length - 1] || null;
}

function estackPeqIsInPipeline(name) {
    return (DSP?.config?.pipeline || []).some(step =>
        step?.type === "Filter" && Array.isArray(step.names) && step.names.includes(name)
    );
}

function estackPeqDetach(name) {
    let changed = false;
    for (const step of (DSP?.config?.pipeline || [])) {
        if (step?.type !== "Filter" || !Array.isArray(step.names) || !step.names.includes(name)) continue;
        const next = step.names.filter(value => value !== name);
        if (next.length !== step.names.length) {
            step.names = next;
            changed = true;
        }
    }
    return changed;
}

function estackPeqInsertIndex(step, channel) {
    const names = step?.names || [];
    const gainName = ESTACK_PEQ_OUTPUT_GAINS[Number(channel)];

    if (gainName) {
        const gainIndex = names.indexOf(gainName);
        if (gainIndex >= 0) return gainIndex;
    }

    // Fallback order if a future config renames the gain stage.
    const gainIndex = names.findIndex(name => DSP?.config?.filters?.[name]?.type === "Gain");
    if (gainIndex >= 0) return gainIndex;
    const delayIndex = names.findIndex(name => DSP?.config?.filters?.[name]?.type === "Delay");
    if (delayIndex >= 0) return delayIndex;
    const limiterIndex = names.findIndex(name => DSP?.config?.filters?.[name]?.type === "Limiter");
    if (limiterIndex >= 0) return limiterIndex;
    return names.length;
}

function estackPeqAttachBeforeGain(name, channel) {
    const step = estackPeqOutputStep(channel);
    if (!step) return false;
    if (!Array.isArray(step.names)) step.names = [];

    // Remove stale copies first. This is what migrates PEQs that older E-Stack
    // builds appended after Gain/Delay.
    const wasInTarget = step.names.includes(name);
    estackPeqDetach(name);

    const index = estackPeqInsertIndex(step, channel);
    step.names.splice(index, 0, name);
    return !wasInTarget || step.names.indexOf(name) !== index;
}

function estackPeqSlotsForChannel(channel) {
    const slots = Array(ESTACK_PEQ_COUNT).fill(null);
    const leftovers = [];

    // Stable E-Stack slots are read from config.filters, not only from the
    // pipeline. This lets a disabled/0 dB band keep its typed values while it
    // consumes no DSP stage.
    for (let slot = 0; slot < ESTACK_PEQ_COUNT; slot++) {
        const name = estackPeqStableName(channel, slot);
        const filter = DSP?.config?.filters?.[name];
        if (filter?.type === "Biquad") slots[slot] = [name, filter];
    }

    // Preserve compatibility with legacy USER_ Biquads that do not yet follow
    // the stable USER_CHx_PEQ_xx naming scheme.
    for (const [name, filter] of filterEntries(channel)) {
        if (!isUserPeq(name, filter)) continue;
        if (slots.some(entry => entry?.[0] === name)) continue;
        leftovers.push([name, filter]);
    }
    leftovers.sort((a, b) => Number(a[1]?.parameters?.freq || 0) - Number(b[1]?.parameters?.freq || 0));
    for (const entry of leftovers) {
        const empty = slots.findIndex(value => !value);
        if (empty < 0) break;
        slots[empty] = entry;
    }
    return slots;
}

mapPeqSlots = function() {
    return estackPeqSlotsForChannel(selectedChannel);
};

estackEnsurePeqEntry = function(slot) {
    const slots = estackPeqSlotsForChannel(selectedChannel);
    if (slots[slot]) return slots[slot];

    const name = estackPeqStableName(selectedChannel, slot);
    const filter = {
        type: "Biquad",
        description: `E-Stack PEQ ${slot + 1} - ${channelName()}`,
        parameters: {
            type: "Peaking",
            freq: ESTACK_PEQ_DEFAULT_FREQS[slot],
            gain: 0,
            q: ESTACK_PEQ_DEFAULT_Q
        }
    };
    DSP.config.filters[name] = filter;
    return [name, filter];
};

function estackPeqShouldProcess(channel, slot, entry) {
    if (!entry) return false;
    if (estackPeqIsDisabled(channel, slot)) return false;
    const gain = Number(entry[1]?.parameters?.gain || 0);
    return Number.isFinite(gain) && Math.abs(gain) >= 0.05;
}

function estackSyncPeqSlot(channel, slot, entry = null) {
    const current = entry || estackPeqSlotsForChannel(channel)[slot];
    if (!current) return false;
    const [name] = current;

    if (!estackPeqShouldProcess(channel, slot, current)) {
        return estackPeqDetach(name);
    }
    return estackPeqAttachBeforeGain(name, channel);
}

function estackNormalizePeqChannel(channel) {
    const before = JSON.stringify((DSP?.config?.pipeline || []).map(step =>
        step?.type === "Filter" ? { channels: estackPeqStepChannels(step), names: [...(step.names || [])] } : null
    ));

    const slots = estackPeqSlotsForChannel(channel);
    // Remove all stable slot references first, then add active slots in numeric
    // order. The resulting processing order is deterministic.
    for (let slot = 0; slot < ESTACK_PEQ_COUNT; slot++) {
        const entry = slots[slot];
        if (entry) estackPeqDetach(entry[0]);
    }
    for (let slot = 0; slot < ESTACK_PEQ_COUNT; slot++) {
        const entry = slots[slot];
        if (entry && estackPeqShouldProcess(channel, slot, entry)) {
            estackPeqAttachBeforeGain(entry[0], channel);
        }
    }

    const after = JSON.stringify((DSP?.config?.pipeline || []).map(step =>
        step?.type === "Filter" ? { channels: estackPeqStepChannels(step), names: [...(step.names || [])] } : null
    ));
    return before !== after;
}

createPeqBand = async function(slot) {
    const entry = estackEnsurePeqEntry(slot);
    estackPeqSetDisabled(selectedChannel, slot, false);
    selectedPeqSlot = slot;
    estackSyncPeqSlot(selectedChannel, slot, entry); // 0 dB stays out of pipeline.
    await safeUpload(`${channelName()} PEQ ${slot + 1} ready`);
    renderAll(false);
    return entry;
};

estackCommitPeqValue = async function(slot, key, value) {
    const entry = estackEnsurePeqEntry(slot);
    const [, filter] = entry;
    const p = filter.parameters || (filter.parameters = {});
    if (key === "freq") p.freq = Math.round(Number(value) * 10) / 10;
    else if (key === "gain") p.gain = Math.round(Number(value) * 10) / 10;
    else if (key === "q") p.q = Math.round(Number(value) * 100) / 100;
    else if (key === "type") p.type = value;

    // Typing/editing a band enables that slot. If gain is exactly neutral the
    // filter definition is retained but deliberately not executed.
    estackPeqSetDisabled(selectedChannel, slot, false);
    if (key === "gain") estackPeqStoreGain(selectedChannel, slot, p.gain);
    estackSyncPeqSlot(selectedChannel, slot, entry);
    selectedPeqSlot = slot;
    await safeUpload(`${channelName()} PEQ ${slot + 1} ${key}`);
    renderAll(false);
};

estackTogglePeq = async function(slot) {
    const entry = estackPeqSlotsForChannel(selectedChannel)[slot];
    const disabled = estackPeqIsDisabled(selectedChannel, slot);

    if (!entry) {
        await createPeqBand(slot);
        return;
    }

    const gain = Number(entry[1]?.parameters?.gain || 0);
    if (!disabled) {
        estackPeqStoreGain(selectedChannel, slot, gain);
        estackPeqSetDisabled(selectedChannel, slot, true);
        estackPeqDetach(entry[0]);
        await safeUpload(`${channelName()} PEQ ${slot + 1} disabled`);
    } else {
        estackPeqSetDisabled(selectedChannel, slot, false);
        // Do not rewrite the stored gain. Re-enable with the exact previous
        // FREQ/GAIN/Q values; a 0 dB band remains intentionally absent.
        estackSyncPeqSlot(selectedChannel, slot, entry);
        await safeUpload(`${channelName()} PEQ ${slot + 1} enabled`);
    }
    selectedPeqSlot = slot;
    renderAll(false);
};

estackResetPeq = async function(slot) {
    const entry = estackEnsurePeqEntry(slot);
    entry[1].parameters = {
        type: "Peaking",
        freq: ESTACK_PEQ_DEFAULT_FREQS[slot],
        gain: 0,
        q: ESTACK_PEQ_DEFAULT_Q
    };
    estackPeqStoreGain(selectedChannel, slot, 0);
    estackPeqSetDisabled(selectedChannel, slot, false);
    estackPeqDetach(entry[0]);
    selectedPeqSlot = slot;
    await safeUpload(`${channelName()} PEQ ${slot + 1} reset`);
    renderAll(false);
};

// One-time migration on page load: move legacy active PEQs that were appended
// after Delay back before the per-output Gain, and strip neutral/disabled PEQs
// from the processing pipeline while retaining their filter definitions.
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const dsp = await waitForDSP();
        await dsp.downloadConfig();
        let changed = false;
        for (const channel of activeChannels()) changed = estackNormalizePeqChannel(channel) || changed;
        if (changed) {
            await safeUpload("PEQ pipeline normalized: XO → PEQ → Gain → Delay → protection");
            renderAll(false);
        }
    } catch (error) {
        console.error("E-Stack PEQ pipeline normalization failed", error);
        setStatus(`PEQ normalization failed: ${error?.message || error}`, "error");
    }
});
