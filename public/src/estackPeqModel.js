// E-Stack per-output PEQ model and mutation layer.
// Rendering is owned by the rotary UI modules; this file only owns stable PEQ
// slots, filter creation/mutation and the PEQ module hook into Output Processing.

const ESTACK_PEQ_COUNT = 10;
const ESTACK_PEQ_DEFAULT_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const ESTACK_PEQ_DEFAULT_Q = 0.7;
const ESTACK_PEQ_GAIN_MIN = -20;
const ESTACK_PEQ_GAIN_MAX = 20;

function estackPeqDisabledKey(channel, slot) {
    return `estack.peq.disabled.${channel}.${slot}`;
}

function estackPeqStoredGainKey(channel, slot) {
    return `estack.peq.lastgain.${channel}.${slot}`;
}

function estackPeqIsDisabled(channel, slot) {
    return window.localStorage.getItem(estackPeqDisabledKey(channel, slot)) === 'true';
}

function estackPeqSetDisabled(channel, slot, disabled) {
    window.localStorage.setItem(estackPeqDisabledKey(channel, slot), String(Boolean(disabled)));
}

function estackPeqStoreGain(channel, slot, gain) {
    window.localStorage.setItem(estackPeqStoredGainKey(channel, slot), String(Number(gain) || 0));
}

function estackPeqStoredGain(channel, slot) {
    const value = Number(window.localStorage.getItem(estackPeqStoredGainKey(channel, slot)));
    return Number.isFinite(value) ? value : 0;
}

// Replace the legacy 8-slot mapper from the original CamillaNode editor with
// ten stable E-Stack user slots. Existing USER_* filters keep their slot number.
mapPeqSlots = function() {
    const slots = Array(ESTACK_PEQ_COUNT).fill(null);
    const entries = getPeqEntries();
    const leftovers = [];

    for (const entry of entries) {
        const match = String(entry[0]).match(/_PEQ_(\d{2})$/);
        if (match) {
            const index = Number(match[1]) - 1;
            if (index >= 0 && index < ESTACK_PEQ_COUNT && !slots[index]) {
                slots[index] = entry;
                continue;
            }
        }
        leftovers.push(entry);
    }

    leftovers.sort((a, b) => Number(a[1]?.parameters?.freq || 0) - Number(b[1]?.parameters?.freq || 0));
    for (const entry of leftovers) {
        const empty = slots.findIndex(value => !value);
        if (empty < 0) break;
        slots[empty] = entry;
    }
    return slots;
};

function estackEnsurePeqEntry(slot) {
    const index = Number(slot);
    if (!Number.isInteger(index) || index < 0 || index >= ESTACK_PEQ_COUNT) {
        throw new Error(`Invalid PEQ slot ${slot}`);
    }

    const slots = mapPeqSlots();
    if (slots[index]) return slots[index];

    const name = `USER_CH${selectedChannel}_PEQ_${String(index + 1).padStart(2, '0')}`;
    const filter = {
        type: 'Biquad',
        description: `E-Stack PEQ ${index + 1} - ${channelName()}`,
        parameters: {
            type: 'Peaking',
            freq: ESTACK_PEQ_DEFAULT_FREQS[index],
            gain: 0,
            q: ESTACK_PEQ_DEFAULT_Q
        }
    };
    DSP.addFilter({ [name]: filter }, selectedChannel);
    return [name, filter];
}

createPeqBand = async function(slot) {
    const entry = estackEnsurePeqEntry(slot);
    estackPeqSetDisabled(selectedChannel, slot, false);
    selectedPeqSlot = Number(slot);
    await safeUpload(`${channelName()} PEQ ${Number(slot) + 1} enabled`);
    renderAll(false);
    return entry;
};

function estackPeqBandColor(slot) {
    const hue = [12, 35, 58, 82, 112, 160, 195, 220, 270, 325][slot] ?? 165;
    return `hsl(${hue}, 68%, 58%)`;
}

async function estackCommitPeqValue(slot, key, value) {
    const [, filter] = estackEnsurePeqEntry(slot);
    const p = filter.parameters || (filter.parameters = {});

    if (key === 'freq') p.freq = Math.round(Number(value) * 10) / 10;
    else if (key === 'gain') p.gain = Math.round(Number(value) * 10) / 10;
    else if (key === 'q') p.q = Math.round(Number(value) * 100) / 100;
    else if (key === 'type') p.type = value;
    else throw new Error(`Unsupported PEQ parameter ${key}`);

    estackPeqSetDisabled(selectedChannel, slot, false);
    if (key === 'gain') estackPeqStoreGain(selectedChannel, slot, p.gain);
    selectedPeqSlot = Number(slot);
    await safeUpload(`${channelName()} PEQ ${Number(slot) + 1} ${key}`);
    renderAll(false);
}

async function estackTogglePeq(slot) {
    const entry = mapPeqSlots()[slot];
    const disabled = estackPeqIsDisabled(selectedChannel, slot);

    if (!entry) {
        await createPeqBand(slot);
        return;
    }

    const p = entry[1].parameters || (entry[1].parameters = {});
    if (!disabled) {
        estackPeqStoreGain(selectedChannel, slot, Number(p.gain || 0));
        p.gain = 0;
        estackPeqSetDisabled(selectedChannel, slot, true);
        await safeUpload(`${channelName()} PEQ ${Number(slot) + 1} bypassed`);
    } else {
        p.gain = estackPeqStoredGain(selectedChannel, slot);
        estackPeqSetDisabled(selectedChannel, slot, false);
        await safeUpload(`${channelName()} PEQ ${Number(slot) + 1} enabled`);
    }
    selectedPeqSlot = Number(slot);
    renderAll(false);
}

async function estackResetPeq(slot) {
    const [, filter] = estackEnsurePeqEntry(slot);
    filter.parameters = {
        type: 'Peaking',
        freq: ESTACK_PEQ_DEFAULT_FREQS[slot],
        gain: 0,
        q: ESTACK_PEQ_DEFAULT_Q
    };
    estackPeqStoreGain(selectedChannel, slot, 0);
    estackPeqSetDisabled(selectedChannel, slot, false);
    selectedPeqSlot = Number(slot);
    await safeUpload(`${channelName()} PEQ ${Number(slot) + 1} reset`);
    renderAll(false);
}

// PEQ uses its own full-width rack instead of the legacy band selector.
const estackPeqBaseBandSelector = renderBandSelector;
renderBandSelector = function() {
    const root = document.getElementById('bandSelector');
    if (activeModule === 'peq') {
        root.replaceChildren();
        root.classList.add('estack-peq-hidden-selector');
        return;
    }
    root.classList.remove('estack-peq-hidden-selector');
    estackPeqBaseBandSelector();
};

const estackPeqBaseRenderControls = renderControls;
renderControls = function() {
    const root = document.getElementById('moduleControls');
    root.classList.remove('estack-peq-rack-mode', 'estack-peq-dynamic-mode');
    if (activeModule === 'peq') {
        root.replaceChildren();
        estackRenderPeqRack(root);
        return;
    }
    estackPeqBaseRenderControls();
};

const estackPeqBaseRenderHeader = renderHeader;
renderHeader = function() {
    estackPeqBaseRenderHeader();
    if (activeModule === 'peq') {
        const subtitle = document.getElementById('moduleSubtitle');
        if (subtitle) subtitle.textContent = `${channelName()} · user PEQ`;
    }
};
