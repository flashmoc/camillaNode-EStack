// E-Stack Per Way V2 presentation layer.
// Reuses the established Output Processing rotary-control language instead of
// presenting speaker management as a generic settings table. The underlying
// safe edit / signal-generator logic remains owned by estackPerWay.js.

function perWayV2Round(value, step) {
    const s = Number(step) || 1;
    return Math.round(Number(value) / s) * s;
}

function perWayV2Norm(value, min, max, logarithmic = false) {
    const v = clamp(value, min, max);
    if (logarithmic) return Math.log(v / min) / Math.log(max / min);
    return (v - min) / (max - min);
}

function perWayV2FromNorm(norm, min, max, logarithmic = false) {
    const t = clamp(norm, 0, 1);
    if (logarithmic) return min * Math.pow(max / min, t);
    return min + (max - min) * t;
}

function perWayV2Knob({ label, value, min, max, step, logarithmic = false, unit = '', resetValue, disabled = false, commit }) {
    const root = document.createElement('div');
    root.className = 'estack-eq8-knob-control per-way-v2-knob-control';
    root.classList.toggle('estack-v2-locked', !!disabled);

    const labelEl = document.createElement('span');
    labelEl.className = 'estack-eq8-knob-label';
    labelEl.textContent = label;

    const knob = document.createElement('div');
    knob.className = 'estack-eq8-knob';
    knob.tabIndex = disabled ? -1 : 0;
    knob.setAttribute('role', 'slider');
    knob.setAttribute('aria-label', label);
    knob.setAttribute('aria-valuemin', String(min));
    knob.setAttribute('aria-valuemax', String(max));
    knob.setAttribute('aria-disabled', String(!!disabled));

    const marker = document.createElement('span');
    marker.className = 'estack-eq8-knob-marker';
    knob.appendChild(marker);

    const numberRow = document.createElement('div');
    numberRow.className = 'estack-eq8-number-row';
    const number = document.createElement('input');
    number.type = 'number';
    number.className = 'estack-eq8-number';
    number.min = min;
    number.max = max;
    number.step = step;
    number.disabled = !!disabled;
    const unitEl = document.createElement('span');
    unitEl.className = 'estack-eq8-unit';
    unitEl.textContent = unit;
    numberRow.append(number, unitEl);

    let current = clamp(value, min, max);
    let dragStartY = 0;
    let dragStartNorm = 0;
    let dragging = false;
    let wheelTimer;

    function render() {
        const norm = perWayV2Norm(current, min, max, logarithmic);
        knob.style.setProperty('--angle', `${-135 + norm * 270}deg`);
        knob.setAttribute('aria-valuenow', String(current));
        number.value = step <= .01 ? Number(current).toFixed(2) : step < 1 ? Number(current).toFixed(1) : String(Math.round(current));
    }

    function setCurrent(next) {
        current = clamp(perWayV2Round(next, step), min, max);
        render();
    }

    async function doCommit() {
        if (!disabled && commit) await commit(current);
    }

    if (!disabled) {
        knob.addEventListener('pointerdown', event => {
            event.preventDefault();
            dragging = true;
            dragStartY = event.clientY;
            dragStartNorm = perWayV2Norm(current, min, max, logarithmic);
            knob.setPointerCapture(event.pointerId);
        });
        knob.addEventListener('pointermove', event => {
            if (!dragging) return;
            const sensitivity = event.shiftKey ? 520 : 190;
            setCurrent(perWayV2FromNorm(dragStartNorm + (dragStartY - event.clientY) / sensitivity, min, max, logarithmic));
        });
        const finish = async event => {
            if (!dragging) return;
            dragging = false;
            try { knob.releasePointerCapture(event.pointerId); } catch (_) {}
            await doCommit();
        };
        knob.addEventListener('pointerup', finish);
        knob.addEventListener('pointercancel', finish);
        knob.addEventListener('wheel', event => {
            event.preventDefault();
            const amount = event.shiftKey ? .004 : .015;
            const norm = perWayV2Norm(current, min, max, logarithmic);
            setCurrent(perWayV2FromNorm(norm + (event.deltaY < 0 ? amount : -amount), min, max, logarithmic));
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(doCommit, 220);
        }, { passive: false });
        knob.addEventListener('keydown', event => {
            if (!['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home','End'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Home') setCurrent(min);
            else if (event.key === 'End') setCurrent(max);
            else {
                const direction = ['ArrowUp','ArrowRight'].includes(event.key) ? 1 : -1;
                const norm = perWayV2Norm(current, min, max, logarithmic);
                setCurrent(perWayV2FromNorm(norm + direction * (event.shiftKey ? .004 : .015), min, max, logarithmic));
            }
            doCommit();
        });
        knob.addEventListener('dblclick', () => {
            setCurrent(resetValue ?? value);
            doCommit();
        });
        number.addEventListener('change', () => {
            setCurrent(number.value);
            doCommit();
        });
        number.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            setCurrent(number.value);
            doCommit();
            number.blur();
        });
    }

    render();
    root.append(labelEl, knob, numberRow);
    return root;
}

function perWayV2Segmented(values, current, formatter, disabled, onChange) {
    const row = document.createElement('div');
    row.className = 'estack-v2-segmented per-way-v2-segmented';
    for (const value of values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = formatter(value);
        button.classList.toggle('active', String(value) === String(current));
        button.disabled = !!disabled;
        button.addEventListener('click', async () => {
            if (disabled) return;
            await onChange(value);
        });
        row.appendChild(button);
    }
    return row;
}

function perWayV2OptionBlock(label, control) {
    const block = document.createElement('div');
    block.className = 'estack-v2-xover-options';
    const title = document.createElement('span');
    title.textContent = label;
    block.append(title, control);
    return block;
}

function perWayV2Switch(label, state, activeText, inactiveText, disabled, dangerWhenActive, onChange) {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = !!disabled;
    button.classList.toggle('active', !!state && !dangerWhenActive);
    button.classList.toggle('danger', !!state && !!dangerWhenActive);
    button.innerHTML = `<span>${label}</span><strong>${state ? activeText : inactiveText}</strong>`;
    button.addEventListener('click', () => {
        if (!disabled) onChange(!state);
    });
    return button;
}

renderCrossoverCard = function(root) {
    const { card, body } = makeCard('CROSSOVER', 'HPF / LPF · loudspeaker operating band');
    card.classList.add('per-way-v2-crossover-card');
    const grid = document.createElement('div');
    grid.className = 'per-way-v2-xover-grid';

    for (const kind of ['hpf', 'lpf']) {
        const entry = crossoverEntry(kind);
        const panel = document.createElement('section');
        panel.className = 'estack-peq-xover-card estack-v2-xover';
        panel.classList.toggle('locked', systemLocked());
        const title = document.createElement('div');
        title.className = 'estack-peq-xover-title';
        title.innerHTML = `<strong>${kind === 'hpf' ? 'HIGH PASS' : 'LOW PASS'}</strong><span>${entry ? sharedText(entry) : 'NOT CONFIGURED'}</span>`;
        panel.appendChild(title);

        if (!entry) {
            const empty = document.createElement('div');
            empty.className = 'per-way-empty';
            empty.textContent = `NO ${kind.toUpperCase()}`;
            panel.appendChild(empty);
            grid.appendChild(panel);
            continue;
        }

        const [filterName, filter] = entry;
        const p = filter.parameters || {};
        const family = String(p.type || '').startsWith('Butterworth') ? 'Butterworth' : 'LinkwitzRiley';
        const slope = Math.max(12, Number(p.order || 4) * 6);
        const controls = document.createElement('div');
        controls.className = 'estack-v2-xover-body';
        controls.appendChild(perWayV2Knob({
            label: 'FREQ', value: Number(p.freq || 100), min: 10, max: 20000, step: 1,
            logarithmic: true, unit: 'Hz', resetValue: Number(p.freq || 100), disabled: systemLocked(),
            commit: value => guardedEdit(`${wayName()} ${kind.toUpperCase()} frequency`, { allowedFilterNames: [filterName] }, () => { p.freq = Math.round(value); })
        }));

        const options = document.createElement('div');
        options.className = 'per-way-v2-xover-options-wrap';
        options.appendChild(perWayV2OptionBlock('TYPE', perWayV2Segmented(
            ['LinkwitzRiley','Butterworth'], family,
            value => value === 'LinkwitzRiley' ? 'LR' : 'BW', systemLocked(),
            value => guardedEdit(`${wayName()} ${kind.toUpperCase()} family`, { allowedFilterNames: [filterName] }, () => { p.type = `${value}${kind === 'hpf' ? 'Highpass' : 'Lowpass'}`; })
        )));
        options.appendChild(perWayV2OptionBlock('SLOPE', perWayV2Segmented(
            [12,24,36,48], slope, value => String(value), systemLocked(),
            value => guardedEdit(`${wayName()} ${kind.toUpperCase()} slope`, { allowedFilterNames: [filterName] }, () => { p.order = Number(value) / 6; })
        )));
        controls.appendChild(options);
        panel.appendChild(controls);
        grid.appendChild(panel);
    }

    body.replaceChildren(grid);
    card.classList.toggle('locked', !systemEditEnabled);
    root.appendChild(card);
};

renderAlignmentCard = function(root) {
    const { card, body } = makeCard('ALIGNMENT', 'gain · delay · polarity · all-pass phase');
    card.classList.add('per-way-v2-alignment-card');
    const consoleEl = document.createElement('div');
    consoleEl.className = 'per-way-v2-output-body';
    const locked = systemLocked();

    const gain = gainEntry();
    if (gain) {
        const [name, filter] = gain;
        const p = filter.parameters || {};
        consoleEl.appendChild(perWayV2Knob({
            label: 'GAIN', value: Number(p.gain || 0), min: -60, max: 12, step: .1, unit: 'dB', resetValue: 0, disabled: locked,
            commit: value => guardedEdit(`${wayName()} gain`, { allowedFilterNames: [name] }, () => { p.gain = Math.round(value * 10) / 10; })
        }));

        const switches = document.createElement('div');
        switches.className = 'estack-v2-switches';
        switches.append(
            perWayV2Switch('POLARITY', !!p.inverted, 'INVERTED', 'NORMAL', locked, false,
                inverted => guardedEdit(`${wayName()} polarity`, { allowedFilterNames: [name] }, () => { p.inverted = inverted; })),
            perWayV2Switch('OUTPUT', !!p.mute, 'MUTED', 'ON', locked, true,
                muted => guardedEdit(`${wayName()} output mute`, { allowedFilterNames: [name] }, () => { p.mute = muted; }))
        );
        consoleEl.appendChild(switches);
    }

    const delay = delayEntry();
    if (delay) {
        const [name, filter] = delay;
        const p = filter.parameters || {};
        const unit = p.unit || 'ms';
        consoleEl.appendChild(perWayV2Knob({
            label: 'DELAY', value: Number(p.delay || 0), min: 0, max: unit === 'ms' ? 100 : 50000,
            step: unit === 'ms' ? .01 : 1, unit, resetValue: 0, disabled: locked,
            commit: value => guardedEdit(`${wayName()} alignment delay`, { allowedFilterNames: [name] }, () => { p.delay = Number(value); })
        }));
    }

    const reference = phaseReferenceFrequency();
    consoleEl.appendChild(perWayV2Knob({
        label: `PHASE @ ${Math.round(reference)}Hz`, value: currentPhase(), min: -179, max: 0,
        step: .1, unit: '°', resetValue: 0, disabled: locked, commit: value => setPhase(value)
    }));

    body.replaceChildren(consoleEl);
    const phaseNote = document.createElement('div');
    phaseNote.className = 'per-way-note per-way-v2-phase-note';
    const activePhase = phaseEntry();
    phaseNote.textContent = activePhase
        ? `AllpassFO active · design ${Math.round(Number(activePhase[1].parameters.freq))} Hz · reference ${Math.round(reference)} Hz`
        : `Phase trim bypassed · reference ${Math.round(reference)} Hz`;
    body.appendChild(phaseNote);
    card.classList.toggle('locked', !systemEditEnabled);
    root.appendChild(card);
};

function perWayV2QControl(value, disabled, commit) {
    const root = document.createElement('div');
    root.className = 'estack-eq8-q-control';
    const head = document.createElement('div');
    head.className = 'estack-eq8-q-head';
    const label = document.createElement('span');
    label.className = 'estack-eq8-q-label';
    label.textContent = 'Q';
    const out = document.createElement('output');
    out.className = 'estack-eq8-q-value';
    out.textContent = Number(value).toFixed(2);
    head.append(label, out);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'estack-eq8-q';
    slider.min = 0; slider.max = 1000; slider.step = 1;
    slider.disabled = !!disabled;
    slider.value = Math.round(perWayV2Norm(value, .1, 20, true) * 1000);
    const getValue = () => Math.round(perWayV2FromNorm(Number(slider.value) / 1000, .1, 20, true) * 100) / 100;
    slider.addEventListener('input', () => { out.textContent = getValue().toFixed(2); });
    slider.addEventListener('change', () => commit(getValue()));
    root.append(head, slider);
    return root;
}

function perWayV2TypeControl(current, disabled, commit) {
    const root = document.createElement('div');
    root.className = 'estack-eq8-type';
    [['Peaking','BELL'],['Lowshelf','LOW'],['Highshelf','HIGH']].forEach(([value,label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.disabled = !!disabled;
        button.classList.toggle('active', (current || 'Peaking') === value);
        button.addEventListener('click', () => commit(value));
        root.appendChild(button);
    });
    return root;
}

renderPeqCard = function(root) {
    const { card, header, body } = makeCard('SPEAKER PEQ', '8 rotary user bands · independent per output');
    card.classList.add('per-way-v2-peq-card');
    const add = document.createElement('button');
    add.className = 'per-way-secondary';
    add.textContent = '+ ADD BAND';
    add.disabled = !!testStatus.active || userPeqSlots().every(Boolean);
    add.addEventListener('click', () => {
        const slot = userPeqSlots().findIndex(item => !item);
        if (slot >= 0) createPeq(slot);
    });
    header.appendChild(add);

    const rack = document.createElement('div');
    rack.className = 'estack-peq-strips per-way-v2-peq-strips';
    const slots = userPeqSlots();

    slots.forEach((entry, slot) => {
        const strip = document.createElement('article');
        strip.className = 'estack-peq-strip estack-eq8-strip per-way-v2-peq-strip';
        strip.classList.toggle('disabled', !entry);
        const head = document.createElement('div');
        head.className = 'estack-peq-strip-head';
        const index = document.createElement('strong');
        index.textContent = String(slot + 1);
        head.appendChild(index);
        strip.appendChild(head);

        if (!entry) {
            const empty = document.createElement('button');
            empty.type = 'button';
            empty.className = 'per-way-v2-add-strip';
            empty.textContent = '+ ADD';
            empty.disabled = !!testStatus.active;
            empty.addEventListener('click', () => createPeq(slot));
            strip.appendChild(empty);
            rack.appendChild(strip);
            return;
        }

        const [name, filter] = entry;
        const p = filter.parameters || {};
        const controls = document.createElement('div');
        controls.className = 'estack-eq8-controls';
        controls.appendChild(perWayV2Knob({
            label: 'FREQ', value: Number(p.freq || PEQ_DEFAULT_FREQ[slot]), min: 20, max: 20000, step: 1,
            logarithmic: true, unit: 'Hz', resetValue: PEQ_DEFAULT_FREQ[slot], disabled: !!testStatus.active,
            commit: value => guardedEdit(`${wayName()} PEQ ${slot + 1} frequency`, { allowedFilterPrefixes: [USER_PREFIX] }, () => { p.freq = Math.round(value); })
        }));
        controls.appendChild(perWayV2Knob({
            label: 'GAIN', value: Number(p.gain || 0), min: -20, max: 20, step: .1,
            unit: 'dB', resetValue: 0, disabled: !!testStatus.active,
            commit: value => guardedEdit(`${wayName()} PEQ ${slot + 1} gain`, { allowedFilterPrefixes: [USER_PREFIX] }, () => { p.gain = Math.round(value * 10) / 10; })
        }));
        controls.appendChild(perWayV2QControl(Number(p.q || 1), !!testStatus.active,
            value => guardedEdit(`${wayName()} PEQ ${slot + 1} Q`, { allowedFilterPrefixes: [USER_PREFIX] }, () => { p.q = value; })));
        controls.appendChild(perWayV2TypeControl(p.type || 'Peaking', !!testStatus.active,
            value => guardedEdit(`${wayName()} PEQ ${slot + 1} type`, { allowedFilterPrefixes: [USER_PREFIX] }, () => { p.type = value; })));
        strip.appendChild(controls);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'estack-eq8-reset per-way-v2-delete-band';
        remove.textContent = 'DELETE';
        remove.disabled = !!testStatus.active;
        remove.addEventListener('click', () => {
            if (!confirm(`Delete PEQ band ${slot + 1} on ${wayName()}?`)) return;
            guardedEdit(`${wayName()} PEQ ${slot + 1} deleted`, { allowedFilterPrefixes: [USER_PREFIX] }, () => removeFilterEverywhere(name));
        });
        strip.appendChild(remove);
        rack.appendChild(strip);
    });

    body.replaceChildren(rack);
    root.appendChild(card);
};

renderProtectionCard = function(root) {
    const { card, body } = makeCard('PROTECTION', 'compressor + hard ceiling');
    card.classList.add('per-way-v2-protection-card');
    const protection = document.createElement('div');
    protection.className = 'estack-v2-protection-body per-way-v2-protection-body';
    const locked = systemLocked();

    for (const [name, processor] of processorEntries()) {
        const p = processor?.parameters || {};
        const module = document.createElement('div');
        module.className = 'estack-v2-protection-module estack-v2-dynamics';
        const title = document.createElement('strong');
        title.textContent = String(processor?.type || 'DYNAMICS').toUpperCase();
        const grid = document.createElement('div');
        grid.className = 'estack-v2-dynamics-grid';
        [['THRESH',p.threshold,'dB'],['ATTACK',p.attack,'s'],['RELEASE',p.release,'s'],['RATIO',p.factor,':1']].forEach(([label,value,unit]) => {
            if (value === undefined) return;
            const item = document.createElement('div');
            const digits = label === 'THRESH' ? 1 : label === 'RATIO' ? 1 : 3;
            item.innerHTML = `<span>${label}</span><strong>${Number(value).toFixed(digits)}${unit}</strong>`;
            grid.appendChild(item);
        });
        module.append(title, grid);
        module.title = name;
        protection.appendChild(module);
    }

    limiterEntries().forEach(([name, filter]) => {
        const p = filter.parameters || {};
        const module = document.createElement('div');
        module.className = 'estack-v2-protection-module';
        const title = document.createElement('strong');
        title.textContent = 'HARD LIMIT';
        module.append(title, perWayV2Knob({
            label: 'CEILING', value: Number(p.clip_limit ?? -3), min: -60, max: 0, step: .1,
            unit: 'dBFS', resetValue: Number(p.clip_limit ?? -3), disabled: locked,
            commit: value => guardedEdit(`${wayName()} limiter ceiling`, { allowedFilterNames: [name] }, () => { p.clip_limit = Math.round(value * 10) / 10; })
        }));
        protection.appendChild(module);
    });

    if (!protection.children.length) {
        const empty = document.createElement('div');
        empty.className = 'per-way-empty';
        empty.textContent = 'NO PROTECTION MODULE';
        protection.appendChild(empty);
    }

    body.replaceChildren(protection);
    card.classList.toggle('locked', !systemEditEnabled);
    root.appendChild(card);
};