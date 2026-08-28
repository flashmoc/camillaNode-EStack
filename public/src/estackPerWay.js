const ESTACK_WAYS = {
    0: { name: 'SUB', out: 1 },
    1: { name: 'KICK', out: 2 },
    2: { name: 'MID L', out: 3 },
    3: { name: 'MID R', out: 4 },
    4: { name: 'HIGH L', out: 5 },
    5: { name: 'HIGH R', out: 6 }
};
const ESTACK_CHANNELS = [0, 1, 2, 3, 4, 5];
const PEQ_SLOTS = 8;
const PEQ_DEFAULT_FREQ = [40, 80, 160, 315, 630, 1250, 4000, 10000];
const PHASE_PREFIX = 'ESTACK_PHASE_';
const USER_PREFIX = 'USER_';

let DSP;
let selectedChannel = 0;
let systemEditEnabled = false;
let testStatus = { active: false, targets: [] };
let statusTimer = null;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

function wayName(channel = selectedChannel) {
    return ESTACK_WAYS[channel]?.name || `OUT ${Number(channel) + 1}`;
}

function setStatus(message, state = 'info') {
    const el = document.getElementById('perWayStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
}

function waitForDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

function stepChannels(step) {
    if (Array.isArray(step?.channels)) return step.channels.map(Number);
    if (step?.channel !== undefined && step?.channel !== null) return [Number(step.channel)];
    return [];
}

function firstMixerIndex() {
    return (DSP.config?.pipeline || []).findIndex(step => step?.type === 'Mixer');
}

function postMixerFilterSteps(channel = selectedChannel) {
    const mixerIndex = firstMixerIndex();
    if (mixerIndex < 0) return [];
    return (DSP.config?.pipeline || [])
        .map((step, index) => ({ step, index }))
        .filter(item => item.index > mixerIndex && item.step?.type === 'Filter' && stepChannels(item.step).includes(Number(channel)));
}

function channelFilterNames(channel = selectedChannel) {
    const names = [];
    for (const { step } of postMixerFilterSteps(channel)) {
        for (const name of (step.names || [])) if (!names.includes(name)) names.push(name);
    }
    return names;
}

function channelFilterEntries(channel = selectedChannel) {
    return channelFilterNames(channel)
        .map(name => [name, DSP.config?.filters?.[name]])
        .filter(([, filter]) => !!filter);
}

function crossoverEntry(kind, channel = selectedChannel) {
    const token = kind === 'hpf' ? 'highpass' : 'lowpass';
    return channelFilterEntries(channel).find(([, filter]) =>
        filter?.type === 'BiquadCombo' && String(filter?.parameters?.type || '').toLowerCase().includes(token));
}

function gainEntry(channel = selectedChannel) {
    return channelFilterEntries(channel).find(([, filter]) => filter?.type === 'Gain');
}

function delayEntry(channel = selectedChannel) {
    return channelFilterEntries(channel).find(([, filter]) => filter?.type === 'Delay');
}

function limiterEntries(channel = selectedChannel) {
    return channelFilterEntries(channel).filter(([, filter]) => filter?.type === 'Limiter');
}

function processorEntries(channel = selectedChannel) {
    return (DSP.config?.pipeline || [])
        .filter(step => step?.type === 'Processor')
        .map(step => [step.name, DSP.config?.processors?.[step.name]])
        .filter(([, processor]) => {
            if (!processor) return false;
            const p = processor.parameters || {};
            const process = Array.isArray(p.process_channels) ? p.process_channels.map(Number) : [];
            const monitor = Array.isArray(p.monitor_channels) ? p.monitor_channels.map(Number) : [];
            return process.includes(Number(channel)) || monitor.includes(Number(channel));
        });
}

function phaseName(channel = selectedChannel) {
    return `${PHASE_PREFIX}CH${channel}`;
}

function phaseEntry(channel = selectedChannel) {
    const name = phaseName(channel);
    const filter = DSP.config?.filters?.[name];
    return filter?.type === 'Biquad' && filter?.parameters?.type === 'AllpassFO' ? [name, filter] : null;
}

function userPeqSlots(channel = selectedChannel) {
    const slots = Array(PEQ_SLOTS).fill(null);
    const leftovers = [];
    for (const [name, filter] of channelFilterEntries(channel)) {
        if (!String(name).startsWith(USER_PREFIX) || filter?.type !== 'Biquad') continue;
        const match = String(name).match(/_PEQ_(\d{2})$/);
        if (match) {
            const index = Number(match[1]) - 1;
            if (index >= 0 && index < PEQ_SLOTS && !slots[index]) {
                slots[index] = [name, filter];
                continue;
            }
        }
        leftovers.push([name, filter]);
    }
    for (const entry of leftovers) {
        const index = slots.findIndex(item => !item);
        if (index < 0) break;
        slots[index] = entry;
    }
    return slots;
}

function channelsUsingFilter(name) {
    return ESTACK_CHANNELS.filter(channel => channelFilterNames(channel).includes(name));
}

function firstOutputFilterStep(channel = selectedChannel) {
    const steps = postMixerFilterSteps(channel);
    if (!steps.length) return null;
    return steps.find(({ step }) => (step.names || []).some(name => {
        const type = DSP.config?.filters?.[name]?.type;
        return type === 'BiquadCombo' || type === 'Gain' || type === 'Delay';
    }))?.step || steps[0].step;
}

function attachBeforeGain(name, channel = selectedChannel) {
    const step = firstOutputFilterStep(channel);
    if (!step) throw new Error(`No post-mixer filter stage for ${wayName(channel)}`);
    if (!Array.isArray(step.names)) step.names = [];
    step.names = step.names.filter(item => item !== name);
    let index = step.names.findIndex(item => DSP.config?.filters?.[item]?.type === 'Gain');
    if (index < 0) index = step.names.findIndex(item => DSP.config?.filters?.[item]?.type === 'Delay');
    if (index < 0) index = step.names.length;
    step.names.splice(index, 0, name);
}

function removeFilterEverywhere(name) {
    for (const step of (DSP.config?.pipeline || [])) {
        if (step?.type !== 'Filter' || !Array.isArray(step.names)) continue;
        step.names = step.names.filter(item => item !== name);
    }
    if (DSP.config?.filters) delete DSP.config.filters[name];
}

async function guardedEdit(reason, policy, mutate) {
    if (testStatus.active) {
        setStatus('Stop the test signal before editing DSP parameters.', 'error');
        return false;
    }
    const before = DSP.estackConfigSnapshot ? DSP.estackConfigSnapshot() : clone(DSP.config);
    try {
        mutate();
        if (typeof DSP.uploadConfigGuarded !== 'function') throw new Error('E-Stack configuration guard is unavailable');
        await DSP.uploadConfigGuarded(before, { name: reason, ...policy });
        await DSP.downloadConfig();
        setStatus(`${reason} · applied`, 'ok');
        renderAll();
        return true;
    } catch (error) {
        console.error(`E-Stack ${reason} failed`, error);
        try { await DSP.downloadConfig(); } catch (_) {}
        setStatus(`${reason} · ERROR: ${error?.message || error}`, 'error');
        renderAll();
        return false;
    }
}

function phaseReferenceFrequency(channel = selectedChannel) {
    const lpf = crossoverEntry('lpf', channel);
    if (lpf) return Number(lpf[1]?.parameters?.freq || 1000);
    const hpf = crossoverEntry('hpf', channel);
    return Number(hpf?.[1]?.parameters?.freq || 1000);
}

function phaseToAllpassFreq(phaseDeg, referenceFreq) {
    const fs = Number(DSP.config?.devices?.samplerate || 48000);
    const magnitude = clamp(Math.abs(Number(phaseDeg)), 0.01, 179.5);
    const reference = clamp(referenceFreq, 1, fs / 2 - 1);
    const tRef = Math.tan(Math.PI * reference / fs);
    const divisor = Math.tan(magnitude * Math.PI / 360);
    const tDesign = tRef / Math.max(1e-9, divisor);
    return clamp((fs / Math.PI) * Math.atan(tDesign), 1, fs / 2 - 1);
}

function allpassFreqToPhase(filterFreq, referenceFreq) {
    const fs = Number(DSP.config?.devices?.samplerate || 48000);
    const fc = clamp(filterFreq, 1, fs / 2 - 1);
    const reference = clamp(referenceFreq, 1, fs / 2 - 1);
    const ratio = Math.tan(Math.PI * reference / fs) / Math.tan(Math.PI * fc / fs);
    return -2 * Math.atan(ratio) * 180 / Math.PI;
}

function currentPhase(channel = selectedChannel) {
    const entry = phaseEntry(channel);
    if (!entry) return 0;
    return allpassFreqToPhase(Number(entry[1]?.parameters?.freq || 1000), phaseReferenceFrequency(channel));
}

function sharedText(entry) {
    if (!entry) return '';
    const peers = channelsUsingFilter(entry[0]).filter(channel => channel !== selectedChannel);
    return peers.length ? `Shared with ${peers.map(wayName).join(', ')}` : 'Independent';
}

function renderWayTabs() {
    const root = document.getElementById('wayTabs');
    root.replaceChildren();
    for (const channel of ESTACK_CHANNELS) {
        const button = document.createElement('button');
        button.className = 'per-way-tab';
        button.classList.toggle('active', channel === selectedChannel);
        button.innerHTML = `<strong>${wayName(channel)}</strong><small>OUT ${channel + 1}</small>`;
        button.addEventListener('click', async () => {
            selectedChannel = channel;
            if (!testStatus.active) setDefaultTestTargets([channel]);
            await DSP.downloadConfig();
            renderAll();
        });
        root.appendChild(button);
    }
}

function renderHeader() {
    document.getElementById('perWayTitle').textContent = wayName();
    document.getElementById('perWayMeta').textContent = `OUT ${selectedChannel + 1} · ${sharedText(crossoverEntry('hpf'))}`;
    const edit = document.getElementById('systemEditToggle');
    edit.classList.toggle('active', systemEditEnabled);
    edit.setAttribute('aria-pressed', String(systemEditEnabled));
    edit.textContent = systemEditEnabled ? 'SYSTEM EDIT ON' : 'EDIT SYSTEM';
    edit.disabled = !!testStatus.active;
}

function makeCard(title, subtitle) {
    const card = document.createElement('section');
    card.className = 'per-way-card';
    const header = document.createElement('header');
    const copy = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = subtitle || '';
    copy.append(strong, small);
    header.appendChild(copy);
    const body = document.createElement('div');
    body.className = 'per-way-card-body';
    card.append(header, body);
    return { card, header, body };
}

function makeNumber(label, value, { min, max, step = 1, unit = '', disabled = false, onChange }) {
    const row = document.createElement('label');
    row.className = 'per-way-field';
    const name = document.createElement('span');
    name.textContent = label;
    const wrap = document.createElement('div');
    wrap.className = 'per-way-number-wrap';
    const input = document.createElement('input');
    input.type = 'number';
    input.value = Number(value).toFixed(step < .1 ? 2 : step < 1 ? 1 : 0);
    input.min = min;
    input.max = max;
    input.step = step;
    input.disabled = disabled;
    const suffix = document.createElement('span');
    suffix.textContent = unit;
    input.addEventListener('change', () => {
        const next = clamp(Number(input.value), min, max);
        input.value = next;
        onChange?.(next);
    });
    wrap.append(input, suffix);
    row.append(name, wrap);
    return row;
}

function makeSelect(label, value, options, disabled, onChange) {
    const row = document.createElement('label');
    row.className = 'per-way-field';
    const name = document.createElement('span');
    name.textContent = label;
    const select = document.createElement('select');
    for (const option of options) {
        const item = document.createElement('option');
        item.value = typeof option === 'object' ? option.value : option;
        item.textContent = typeof option === 'object' ? option.label : option;
        select.appendChild(item);
    }
    select.value = value;
    select.disabled = disabled;
    select.addEventListener('change', () => onChange?.(select.value));
    row.append(name, select);
    return row;
}

function makeToggle(label, on, disabled, onChange, onText = 'ON', offText = 'OFF') {
    const row = document.createElement('div');
    row.className = 'per-way-field';
    const name = document.createElement('span');
    name.textContent = label;
    const button = document.createElement('button');
    button.className = 'per-way-toggle';
    button.classList.toggle('active', !!on);
    button.textContent = on ? onText : offText;
    button.disabled = disabled;
    button.addEventListener('click', () => onChange?.(!on));
    row.append(name, button);
    return row;
}

function systemLocked() {
    return !systemEditEnabled || !!testStatus.active;
}

function renderCrossoverCard(root) {
    const { card, body } = makeCard('CROSSOVER', 'HPF / LPF · loudspeaker operating band');
    const grid = document.createElement('div');
    grid.className = 'per-way-xo-grid';

    for (const kind of ['hpf', 'lpf']) {
        const entry = crossoverEntry(kind);
        const panel = document.createElement('div');
        panel.className = 'per-way-xo-panel';
        const heading = document.createElement('div');
        heading.className = 'per-way-subhead';
        heading.innerHTML = `<strong>${kind.toUpperCase()}</strong><small>${entry ? sharedText(entry) : 'Not configured'}</small>`;
        panel.appendChild(heading);
        if (!entry) {
            const empty = document.createElement('div');
            empty.className = 'per-way-empty';
            empty.textContent = `No ${kind.toUpperCase()} on ${wayName()}`;
            panel.appendChild(empty);
            grid.appendChild(panel);
            continue;
        }
        const [filterName, filter] = entry;
        const p = filter.parameters || {};
        const currentFamily = String(p.type || '').startsWith('Butterworth') ? 'Butterworth' : 'LinkwitzRiley';
        panel.appendChild(makeSelect('Family', currentFamily, [
            { value: 'LinkwitzRiley', label: 'Linkwitz-Riley' },
            { value: 'Butterworth', label: 'Butterworth' }
        ], systemLocked(), value => guardedEdit(`${wayName()} ${kind.toUpperCase()} family`, { allowedFilterNames: [filterName] }, () => {
            p.type = `${value}${kind === 'hpf' ? 'Highpass' : 'Lowpass'}`;
        })));
        const slope = Math.max(6, Number(p.order || 4) * 6);
        panel.appendChild(makeSelect('Slope', String(slope), [12, 24, 36, 48].map(value => ({ value: String(value), label: `${value} dB/oct` })), systemLocked(), value => guardedEdit(`${wayName()} ${kind.toUpperCase()} slope`, { allowedFilterNames: [filterName] }, () => {
            p.order = Number(value) / 6;
        })));
        panel.appendChild(makeNumber('Frequency', Number(p.freq || 100), {
            min: 10, max: 20000, step: 1, unit: 'Hz', disabled: systemLocked(),
            onChange: value => guardedEdit(`${wayName()} ${kind.toUpperCase()} frequency`, { allowedFilterNames: [filterName] }, () => { p.freq = value; })
        }));
        grid.appendChild(panel);
    }
    body.appendChild(grid);
    card.classList.toggle('locked', !systemEditEnabled);
    root.appendChild(card);
}

function renderAlignmentCard(root) {
    const { card, body } = makeCard('ALIGNMENT', 'gain · delay · polarity · all-pass phase');
    const gain = gainEntry();
    const delay = delayEntry();
    const grid = document.createElement('div');
    grid.className = 'per-way-fields-grid';

    if (gain) {
        const [name, filter] = gain;
        const p = filter.parameters || {};
        grid.appendChild(makeNumber('Gain', Number(p.gain || 0), {
            min: -60, max: 12, step: .1, unit: 'dB', disabled: systemLocked(),
            onChange: value => guardedEdit(`${wayName()} gain`, { allowedFilterNames: [name] }, () => { p.gain = Math.round(value * 10) / 10; })
        }));
        grid.appendChild(makeToggle('Polarity', !!p.inverted, systemLocked(), inverted => guardedEdit(`${wayName()} polarity`, { allowedFilterNames: [name] }, () => { p.inverted = inverted; }), 'INVERTED', 'NORMAL'));
        grid.appendChild(makeToggle('Output', !p.mute, systemLocked(), enabled => guardedEdit(`${wayName()} output mute`, { allowedFilterNames: [name] }, () => { p.mute = !enabled; }), 'ON', 'MUTED'));
    }

    if (delay) {
        const [name, filter] = delay;
        const p = filter.parameters || {};
        const unit = p.unit || 'ms';
        grid.appendChild(makeNumber('Delay', Number(p.delay || 0), {
            min: 0, max: unit === 'ms' ? 100 : 50000, step: unit === 'ms' ? .01 : 1, unit, disabled: systemLocked(),
            onChange: value => guardedEdit(`${wayName()} alignment delay`, { allowedFilterNames: [name] }, () => { p.delay = value; })
        }));
    }

    const reference = phaseReferenceFrequency();
    const phase = currentPhase();
    const phaseField = makeNumber(`Phase @ ${Math.round(reference)} Hz`, phase, {
        min: -179, max: 0, step: .1, unit: '°', disabled: systemLocked(),
        onChange: value => setPhase(value)
    });
    phaseField.title = 'First-order all-pass. 0° removes the E-Stack phase filter; magnitude response stays unchanged.';
    grid.appendChild(phaseField);

    const activePhase = phaseEntry();
    const phaseNote = document.createElement('div');
    phaseNote.className = 'per-way-note';
    phaseNote.textContent = activePhase
        ? `AllpassFO active · design frequency ${Math.round(Number(activePhase[1].parameters.freq))} Hz. Reference follows this way's upper crossover.`
        : `0° · no E-Stack all-pass filter. Reference follows ${crossoverEntry('lpf') ? 'LPF' : 'HPF'} at ${Math.round(reference)} Hz.`;
    body.append(grid, phaseNote);
    card.classList.toggle('locked', !systemEditEnabled);
    root.appendChild(card);
}

async function setPhase(value) {
    const phase = clamp(value, -179, 0);
    const name = phaseName();
    await guardedEdit(`${wayName()} phase`, { allowedFilterPrefixes: [PHASE_PREFIX] }, () => {
        if (Math.abs(phase) < .05) {
            removeFilterEverywhere(name);
            return;
        }
        const freq = phaseToAllpassFreq(phase, phaseReferenceFrequency());
        DSP.config.filters = DSP.config.filters || {};
        DSP.config.filters[name] = {
            type: 'Biquad',
            description: `E-Stack phase trim ${wayName()} (${phase.toFixed(1)} deg @ ${phaseReferenceFrequency().toFixed(1)} Hz)`,
            parameters: { type: 'AllpassFO', freq: Math.round(freq * 10) / 10 }
        };
        attachBeforeGain(name);
    });
}

function renderPeqCard(root) {
    const { card, header, body } = makeCard('SPEAKER PEQ', '8 user bands · safe to edit without SYSTEM EDIT');
    const add = document.createElement('button');
    add.className = 'per-way-secondary';
    add.textContent = '+ ADD BAND';
    add.disabled = !!testStatus.active || userPeqSlots().every(Boolean);
    add.addEventListener('click', () => {
        const slot = userPeqSlots().findIndex(item => !item);
        if (slot >= 0) createPeq(slot);
    });
    header.appendChild(add);

    const table = document.createElement('div');
    table.className = 'per-way-peq-table';
    const head = document.createElement('div');
    head.className = 'per-way-peq-row per-way-peq-head';
    head.innerHTML = '<span>#</span><span>Type</span><span>Frequency</span><span>Gain</span><span>Q</span><span></span>';
    table.appendChild(head);

    const slots = userPeqSlots();
    slots.forEach((entry, slot) => {
        const row = document.createElement('div');
        row.className = 'per-way-peq-row';
        const index = document.createElement('strong');
        index.textContent = String(slot + 1);
        row.appendChild(index);
        if (!entry) {
            const empty = document.createElement('button');
            empty.className = 'per-way-peq-empty';
            empty.textContent = '+ unused band';
            empty.disabled = !!testStatus.active;
            empty.addEventListener('click', () => createPeq(slot));
            const holder = document.createElement('div');
            holder.className = 'per-way-peq-unused';
            holder.appendChild(empty);
            row.appendChild(holder);
            table.appendChild(row);
            return;
        }

        const [name, filter] = entry;
        const p = filter.parameters || {};
        const type = document.createElement('select');
        [['Peaking','Bell'],['Lowshelf','Low Shelf'],['Highshelf','High Shelf']].forEach(([value,label]) => {
            const option = document.createElement('option'); option.value = value; option.textContent = label; type.appendChild(option);
        });
        type.value = p.type || 'Peaking';
        type.disabled = !!testStatus.active;
        type.addEventListener('change', () => guardedEdit(`${wayName()} PEQ ${slot + 1} type`, { allowedFilterPrefixes: [USER_PREFIX] }, () => { p.type = type.value; }));
        row.appendChild(type);
        row.appendChild(peqNumber(Number(p.freq || PEQ_DEFAULT_FREQ[slot]), 20, 20000, 1, 'Hz', value => guardedEdit(`${wayName()} PEQ ${slot + 1} frequency`, { allowedFilterPrefixes: [USER_PREFIX] }, () => { p.freq = value; })));
        row.appendChild(peqNumber(Number(p.gain || 0), -20, 20, .1, 'dB', value => guardedEdit(`${wayName()} PEQ ${slot + 1} gain`, { allowedFilterPrefixes: [USER_PREFIX] }, () => { p.gain = Math.round(value * 10) / 10; })));
        row.appendChild(peqNumber(Number(p.q || 1), .1, 20, .01, '', value => guardedEdit(`${wayName()} PEQ ${slot + 1} Q`, { allowedFilterPrefixes: [USER_PREFIX] }, () => { p.q = Math.round(value * 100) / 100; })));
        const remove = document.createElement('button');
        remove.className = 'per-way-icon-button';
        remove.textContent = '×';
        remove.title = `Delete ${name}`;
        remove.disabled = !!testStatus.active;
        remove.addEventListener('click', () => {
            if (!confirm(`Delete PEQ band ${slot + 1} on ${wayName()}?`)) return;
            guardedEdit(`${wayName()} PEQ ${slot + 1} deleted`, { allowedFilterPrefixes: [USER_PREFIX] }, () => removeFilterEverywhere(name));
        });
        row.appendChild(remove);
        table.appendChild(row);
    });

    body.appendChild(table);
    root.appendChild(card);
}

function peqNumber(value, min, max, step, unit, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'per-way-peq-number';
    const input = document.createElement('input');
    input.type = 'number'; input.value = value; input.min = min; input.max = max; input.step = step; input.disabled = !!testStatus.active;
    const suffix = document.createElement('span'); suffix.textContent = unit;
    input.addEventListener('change', () => {
        const next = clamp(Number(input.value), min, max);
        input.value = next;
        onChange(next);
    });
    wrap.append(input, suffix);
    return wrap;
}

async function createPeq(slot) {
    const name = `USER_CH${selectedChannel}_PEQ_${String(slot + 1).padStart(2, '0')}`;
    await guardedEdit(`${wayName()} PEQ ${slot + 1} created`, { allowedFilterPrefixes: [USER_PREFIX] }, () => {
        DSP.config.filters = DSP.config.filters || {};
        DSP.config.filters[name] = {
            type: 'Biquad',
            description: `E-Stack PEQ ${slot + 1} - ${wayName()}`,
            parameters: { type: 'Peaking', freq: PEQ_DEFAULT_FREQ[slot], gain: 0, q: 1 }
        };
        attachBeforeGain(name);
    });
}

function summarizeProcessor(processor) {
    const p = processor?.parameters || {};
    const values = [];
    if (Number.isFinite(Number(p.threshold))) values.push(`threshold ${p.threshold} dBFS`);
    if (Number.isFinite(Number(p.factor))) values.push(`ratio ${p.factor}:1`);
    if (Number.isFinite(Number(p.attack))) values.push(`attack ${(Number(p.attack) * 1000).toFixed(1)} ms`);
    if (Number.isFinite(Number(p.release))) values.push(`release ${(Number(p.release) * 1000).toFixed(0)} ms`);
    return values.join(' · ');
}

function renderProtectionCard(root) {
    const { card, body } = makeCard('PROTECTION', 'compressor + hard ceiling');
    const list = document.createElement('div');
    list.className = 'per-way-protection';

    for (const [name, processor] of processorEntries()) {
        const item = document.createElement('div');
        item.className = 'per-way-protection-item';
        item.innerHTML = `<strong>${name}</strong><span>${processor?.type || 'Processor'} · ${summarizeProcessor(processor)}</span>`;
        list.appendChild(item);
    }

    const limiters = limiterEntries();
    limiters.forEach(([name, filter], index) => {
        const item = document.createElement('div');
        item.className = 'per-way-protection-item limiter';
        const title = document.createElement('strong');
        title.textContent = limiters.length > 1 ? `Hard limiter ${index + 1}` : 'Hard limiter';
        const control = makeNumber('Ceiling', Number(filter?.parameters?.clip_limit ?? -3), {
            min: -60, max: 0, step: .1, unit: 'dBFS', disabled: systemLocked(),
            onChange: value => guardedEdit(`${wayName()} limiter ceiling`, { allowedFilterNames: [name] }, () => { filter.parameters.clip_limit = Math.round(value * 10) / 10; })
        });
        item.append(title, control);
        list.appendChild(item);
    });

    if (!list.children.length) {
        const empty = document.createElement('div');
        empty.className = 'per-way-empty';
        empty.textContent = 'No protection processor detected on this output.';
        list.appendChild(empty);
    }
    body.appendChild(list);
    card.classList.toggle('locked', !systemEditEnabled);
    root.appendChild(card);
}

function renderProcessing() {
    const root = document.getElementById('processingCards');
    root.replaceChildren();
    renderCrossoverCard(root);
    renderAlignmentCard(root);
    renderPeqCard(root);
    renderProtectionCard(root);
}

function testTargetButtons() {
    return [...document.querySelectorAll('#testTargets button[data-channel]')];
}

function selectedTestTargets() {
    return testTargetButtons().filter(button => button.classList.contains('active')).map(button => Number(button.dataset.channel));
}

function setDefaultTestTargets(targets) {
    const set = new Set(targets.map(Number));
    for (const button of testTargetButtons()) button.classList.toggle('active', set.has(Number(button.dataset.channel)));
    updateTestSafety();
}

function renderTestTargets() {
    const root = document.getElementById('testTargets');
    root.replaceChildren();
    for (const channel of ESTACK_CHANNELS) {
        const button = document.createElement('button');
        button.dataset.channel = channel;
        button.innerHTML = `<strong>${wayName(channel)}</strong><small>OUT ${channel + 1}</small>`;
        button.classList.toggle('active', testStatus.active ? (testStatus.targets || []).includes(channel) : channel === selectedChannel);
        button.disabled = !!testStatus.active;
        button.addEventListener('click', () => {
            button.classList.toggle('active');
            if (!selectedTestTargets().length) button.classList.add('active');
            updateTestSafety();
        });
        root.appendChild(button);
    }
}

function quickFrequencies() {
    const values = [40, 50, 60, 80, 100, 130, 300, 1000, 2000, 4000, 10000];
    for (const kind of ['hpf', 'lpf']) {
        const entry = crossoverEntry(kind);
        const freq = Number(entry?.[1]?.parameters?.freq);
        if (Number.isFinite(freq)) values.push(Math.round(freq));
    }
    return [...new Set(values)].filter(value => value >= 10 && value <= 20000).sort((a, b) => a - b);
}

function renderQuickFrequencies() {
    const root = document.getElementById('quickFrequencies');
    root.replaceChildren();
    for (const freq of quickFrequencies()) {
        const button = document.createElement('button');
        button.textContent = freq >= 1000 ? `${Number((freq / 1000).toFixed(freq % 1000 ? 1 : 0))}k` : String(freq);
        button.title = `${freq} Hz`;
        button.disabled = !!testStatus.active;
        button.addEventListener('click', () => {
            document.getElementById('testFrequency').value = freq;
        });
        root.appendChild(button);
    }
}

function clientSafeCap(type, targets) {
    const white = type === 'WhiteNoise';
    if (targets.some(channel => channel >= 4)) return white ? -30 : -20;
    if (targets.some(channel => channel >= 2)) return white ? -25 : -15;
    return white ? -20 : -10;
}

function updateTestSafety() {
    const type = document.getElementById('testType')?.value || 'Sine';
    const targets = selectedTestTargets();
    const cap = clientSafeCap(type, targets);
    const level = document.getElementById('testLevel');
    if (level) {
        level.max = cap;
        if (Number(level.value) > cap) level.value = cap;
    }
    const note = document.getElementById('testSafetyNote');
    if (note) note.textContent = `Safety ceiling for this selection: ${cap} dBFS${type === 'WhiteNoise' ? ' (white noise)' : ''}. Start low; -40 dBFS is the normal measurement starting point.`;
}

function renderTestPanel() {
    const type = document.getElementById('testType');
    const freq = document.getElementById('testFrequency');
    const level = document.getElementById('testLevel');
    const duration = document.getElementById('testDuration');
    const start = document.getElementById('startTestSignal');
    const stop = document.getElementById('stopTestSignal');

    const active = !!testStatus.active;
    [type, freq, level, duration, start].forEach(el => { if (el) el.disabled = active; });
    if (freq) freq.disabled = active || type?.value === 'WhiteNoise';
    if (stop) stop.disabled = !active;
    renderTestTargets();
    renderQuickFrequencies();
    updateTestSafety();

    const status = document.getElementById('testSignalStatus');
    if (!status) return;
    status.classList.toggle('active', active);
    if (active) {
        const remaining = Math.max(0, Math.ceil(Number(testStatus.remainingMs || 0) / 1000));
        const signal = testStatus.type === 'Sine' ? `${Math.round(Number(testStatus.freq))} Hz sine` : 'white noise';
        status.innerHTML = `<strong>TEST ACTIVE</strong><span>${signal} · ${Number(testStatus.level).toFixed(1)} dBFS · ${testStatus.targets.map(wayName).join(' + ')} · auto-stop ${remaining}s</span>`;
    } else {
        status.innerHTML = '<strong>NORMAL INPUT</strong><span>Signal generator off. REW sweeps must be run in this state so the REW sweep enters the normal CamillaDSP input and traverses the complete E-Stack processing chain.</span>';
    }
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
}

async function refreshTestStatus(render = true) {
    try {
        testStatus = await fetchJson('/api/test-signal/status');
        if (render) {
            renderTestPanel();
            renderHeader();
            renderProcessing();
        }
    } catch (error) {
        const status = document.getElementById('testSignalStatus');
        if (status) status.innerHTML = `<strong>GENERATOR UNAVAILABLE</strong><span>${error.message}</span>`;
    }
}

async function startTestSignal() {
    const type = document.getElementById('testType').value;
    const targets = selectedTestTargets();
    if (!targets.length) return setStatus('Select at least one test output.', 'error');
    const payload = {
        type,
        targets,
        level: Number(document.getElementById('testLevel').value),
        duration: Number(document.getElementById('testDuration').value)
    };
    if (type === 'Sine') payload.freq = Number(document.getElementById('testFrequency').value);
    try {
        setStatus('Starting protected test signal…', 'busy');
        testStatus = await fetchJson('/api/test-signal/start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        setStatus(`Test signal active on ${testStatus.targets.map(wayName).join(' + ')}`, 'ok');
        await DSP.downloadConfig();
        renderAll();
    } catch (error) {
        setStatus(`Signal generator ERROR: ${error.message}`, 'error');
        await refreshTestStatus(false);
        renderAll();
    }
}

async function stopTestSignal({ silent = false } = {}) {
    try {
        if (!silent) setStatus('Stopping test signal and restoring normal input…', 'busy');
        await fetchJson('/api/test-signal/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await DSP.downloadConfig();
        testStatus = { active: false, targets: [] };
        if (!silent) setStatus('Normal input and original routing restored.', 'ok');
        renderAll();
        return true;
    } catch (error) {
        if (!silent) setStatus(`STOP ERROR: ${error.message}`, 'error');
        return false;
    }
}

function setupTestEvents() {
    document.getElementById('testType').addEventListener('change', () => {
        const white = document.getElementById('testType').value === 'WhiteNoise';
        document.getElementById('testFrequency').disabled = white || !!testStatus.active;
        updateTestSafety();
    });
    document.getElementById('startTestSignal').addEventListener('click', startTestSignal);
    document.getElementById('stopTestSignal').addEventListener('click', () => stopTestSignal());
    document.getElementById('testLevel').addEventListener('change', updateTestSafety);
}

function renderAll() {
    renderWayTabs();
    renderHeader();
    renderTestPanel();
    renderProcessing();
}

async function initPerWay() {
    DSP = await waitForDSP();
    window.DSP = DSP;
    await DSP.downloadConfig();
    setupTestEvents();
    document.getElementById('systemEditToggle').addEventListener('click', () => {
        if (testStatus.active) return;
        if (!systemEditEnabled) {
            const ok = confirm('Enable SYSTEM EDIT? This unlocks crossover, gain, delay, polarity, phase and limiter settings. Speaker protection can be damaged by incorrect values.');
            if (!ok) return;
        }
        systemEditEnabled = !systemEditEnabled;
        renderAll();
    });

    await refreshTestStatus(false);
    renderAll();
    setStatus('Per Way ready. Signal Generator is protected by output routing, level caps and automatic restore.', 'info');

    statusTimer = setInterval(async () => {
        const wasActive = !!testStatus.active;
        await refreshTestStatus(false);
        if (wasActive !== !!testStatus.active || testStatus.active) renderAll();
        if (wasActive && !testStatus.active) {
            try { await DSP.downloadConfig(); } catch (_) {}
            setStatus('Test signal stopped automatically; normal input restored.', 'ok');
        }
    }, 1000);

    window.addEventListener('pagehide', () => {
        if (!testStatus.active) return;
        try {
            navigator.sendBeacon('/api/test-signal/stop', new Blob(['{}'], { type: 'application/json' }));
        } catch (_) {
            fetch('/api/test-signal/stop', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
        }
    });
}

window.addEventListener('beforeunload', () => { if (statusTimer) clearInterval(statusTimer); });
document.addEventListener('DOMContentLoaded', initPerWay);
