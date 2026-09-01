// E-Stack Output Processing — unified per-way workspace.
// -----------------------------------------------------------------------------
// This is the ONLY Output Processing layout/controller layer.
// DSP mutation helpers, graph engine and safety guards remain in their dedicated
// modules. Visual structure is generated here once; there are no V2/V3/V4/V5
// DOM-transform layers anymore.

(function installEStackOutputWorkspace() {
    const PHASE_PREFIX = 'ESTACK_PHASE_';

    function wsLocked() { return !systemEditEnabled; }
    function wsClamp(value, min, max) {
        const n = Number(value);
        return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
    }
    function wsRound(value, decimals = 1) {
        const factor = Math.pow(10, decimals);
        return Math.round(Number(value) * factor) / factor;
    }
    function wsElement(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function wsSelect(values, current, formatter, disabled, commit) {
        const select = document.createElement('select');
        select.className = 'estack-ws-select';
        select.disabled = !!disabled;
        for (const value of values) {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = formatter ? formatter(value) : String(value);
            select.appendChild(option);
        }
        select.value = String(current);
        select.addEventListener('change', () => commit(select.value));
        return select;
    }

    function wsNumber(value, min, max, step, unit, disabled, commit, preview = null) {
        const wrap = wsElement('label', 'estack-ws-number');
        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.value = String(value);
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.disabled = !!disabled;

        if (preview) {
            input.addEventListener('input', () => {
                const n = Number(input.value);
                if (Number.isFinite(n)) preview(wsClamp(n, min, max));
            });
        }

        const suffix = wsElement('span', '', unit || '');
        const apply = () => {
            const next = wsClamp(Number(input.value), min, max);
            input.value = String(next);
            commit(next);
        };
        input.addEventListener('change', apply);
        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            apply();
            input.blur();
        });
        wrap.append(input, suffix);
        return wrap;
    }

    function wsField(label, control, extraClass = '') {
        const field = wsElement('div', `estack-ws-field ${extraClass}`.trim());
        field.append(wsElement('span', 'estack-ws-field-label', label), control);
        return field;
    }

    function wsSectionHead(title, meta = '') {
        const head = wsElement('header', 'estack-ws-section-head');
        head.append(wsElement('strong', '', title));
        if (meta) head.append(wsElement('span', '', meta));
        return head;
    }

    function wsKnobField(options) {
        const field = wsElement('div', 'estack-ws-knob-field');
        const locked = !!options.disabled;

        if (typeof estackEq8MakeKnob !== 'function') {
            field.append(wsField(options.label, wsNumber(
                options.value, options.min, options.max, options.step,
                options.unit, locked, options.commit, options.preview
            )));
            return field;
        }

        const control = estackEq8MakeKnob({
            label: options.label,
            value: options.value,
            min: options.min,
            max: options.max,
            step: options.step,
            logarithmic: !!options.logarithmic,
            unit: options.unit || '',
            resetValue: options.resetValue,
            preview: locked ? null : options.preview,
            commit: locked ? null : options.commit
        });

        if (locked) {
            control.classList.add('estack-v2-locked');
            control.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
            const knob = control.querySelector('.estack-eq8-knob');
            if (knob) {
                knob.tabIndex = -1;
                knob.setAttribute('aria-disabled', 'true');
                knob.style.pointerEvents = 'none';
            }
        }

        field.append(control);
        return field;
    }

    /* ----------------------------------------------------------------------
       Phase trim
       ---------------------------------------------------------------------- */
    function wsPhaseName(channel = selectedChannel) {
        return `${PHASE_PREFIX}CH${Number(channel)}`;
    }

    function wsPhaseMetadata(channel = selectedChannel) {
        const filter = DSP?.config?.filters?.[wsPhaseName(channel)];
        if (filter?.type !== 'Biquad' || filter?.parameters?.type !== 'AllpassFO') return null;
        const match = String(filter.description || '').match(/\((-?\d+(?:\.\d+)?)\s*deg\s*@\s*(\d+(?:\.\d+)?)\s*Hz(?:;[^)]*)?\)/i);
        if (!match) return null;
        return { degrees: Number(match[1]), referenceHz: Number(match[2]) };
    }

    function wsPhaseReference(channel = selectedChannel) {
        const metadata = wsPhaseMetadata(channel);
        if (metadata?.referenceHz > 0) return metadata.referenceHz;
        const lpf = getCrossover('lpf', channel);
        if (lpf) return Number(lpf[1]?.parameters?.freq || 1000);
        const hpf = getCrossover('hpf', channel);
        return Number(hpf?.[1]?.parameters?.freq || 1000);
    }

    function wsCurrentPhase(channel = selectedChannel) {
        return wsPhaseMetadata(channel)?.degrees || 0;
    }

    function wsPhaseFilterFrequency(phaseDeg, referenceHz) {
        const fs = Number(DSP?.config?.devices?.samplerate || 48000);
        const phase = wsClamp(Math.abs(Number(phaseDeg)), .01, 179.5);
        const reference = wsClamp(referenceHz, 1, fs / 2 - 1);
        const tReference = Math.tan(Math.PI * reference / fs);
        const divisor = Math.tan(phase * Math.PI / 360);
        return wsClamp((fs / Math.PI) * Math.atan(tReference / Math.max(1e-9, divisor)), 1, fs / 2 - 1);
    }

    function wsRemovePhase(name) {
        for (const step of (DSP?.config?.pipeline || [])) {
            if (step?.type === 'Filter' && Array.isArray(step.names)) {
                step.names = step.names.filter(item => item !== name);
            }
        }
        if (DSP?.config?.filters) delete DSP.config.filters[name];
    }

    function wsAttachPhase(name, channel = selectedChannel) {
        const pipeline = DSP?.config?.pipeline || [];
        const mixerIndex = pipeline.findIndex(step => step?.type === 'Mixer');
        const stage = pipeline.slice(mixerIndex + 1).find(step =>
            step?.type === 'Filter' &&
            stepChannels(step).includes(Number(channel)) &&
            (step.names || []).some(filterName =>
                ['Gain', 'Delay', 'BiquadCombo'].includes(DSP?.config?.filters?.[filterName]?.type)
            )
        );
        if (!stage) throw new Error(`No output filter stage found for ${channelName(channel)}`);
        const channels = stepChannels(stage);
        if (channels.length !== 1 || channels[0] !== Number(channel)) {
            throw new Error('Phase trim requires an independent output stage');
        }
        stage.names = (stage.names || []).filter(item => item !== name);
        let index = stage.names.findIndex(item => DSP?.config?.filters?.[item]?.type === 'Gain');
        if (index < 0) index = stage.names.findIndex(item => DSP?.config?.filters?.[item]?.type === 'Delay');
        if (index < 0) index = stage.names.length;
        stage.names.splice(index, 0, name);
    }

    async function wsCommitPhase(nextPhase) {
        const phase = wsClamp(nextPhase, -179, 0);
        const channel = Number(selectedChannel);
        const name = wsPhaseName(channel);
        const before = typeof DSP.estackConfigSnapshot === 'function'
            ? DSP.estackConfigSnapshot()
            : JSON.parse(JSON.stringify(DSP.config));

        try {
            if (Math.abs(phase) < .05) {
                wsRemovePhase(name);
            } else {
                const reference = wsPhaseReference(channel);
                const filterFreq = wsPhaseFilterFrequency(phase, reference);
                DSP.config.filters = DSP.config.filters || {};
                DSP.config.filters[name] = {
                    type: 'Biquad',
                    description: `E-Stack phase trim ${channelName(channel)} (${phase.toFixed(1)} deg @ ${reference.toFixed(1)} Hz)`,
                    parameters: { type: 'AllpassFO', freq: wsRound(filterFreq, 1) }
                };
                wsAttachPhase(name, channel);
            }
            if (typeof DSP.uploadConfigGuarded !== 'function') {
                throw new Error('Guarded configuration writer unavailable');
            }
            await DSP.uploadConfigGuarded(before, {
                name: `${channelName(channel)} phase trim`,
                allowedFilterPrefixes: [PHASE_PREFIX]
            });
            await DSP.downloadConfig();
            setStatus(`${channelName(channel)} phase · applied`, 'ok');
        } catch (error) {
            console.error('E-Stack workspace phase update failed', error);
            try { await DSP.downloadConfig(); } catch (_) {}
            setStatus(`Phase · ERROR: ${error?.message || error}`, 'error');
        }
        renderAll(false);
    }

    /* ----------------------------------------------------------------------
       Output / alignment / protection
       ---------------------------------------------------------------------- */
    function wsStateButton(label, value, classes, disabled, onClick) {
        const button = wsElement('button', `estack-ws-state-button ${classes || ''}`.trim());
        button.type = 'button';
        button.disabled = !!disabled;
        button.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
        button.addEventListener('click', onClick);
        return button;
    }

    function wsProtectionRail() {
        const rail = wsElement('div', 'estack-ws-protection-rail');
        const limiters = getLimiterEntries();
        const processors = getProcessorEntries();

        if (limiters.length) {
            for (const [name, filter] of limiters) {
                const p = filter.parameters || (filter.parameters = {});
                const module = wsElement('article', 'estack-ws-protection-module');
                const head = wsElement('div', 'estack-ws-protection-module-head');
                head.append(wsElement('strong', '', 'HARD LIMITER'), wsElement('span', '', 'CEILING'));
                const field = wsField('THRESHOLD', wsNumber(
                    Number(p.clip_limit ?? -3), -60, 0, .1, 'dBFS', wsLocked(),
                    async next => {
                        p.clip_limit = wsRound(next, 1);
                        await safeUpload(`${channelName()} limiter threshold`);
                        renderAll(false);
                    }
                ), 'estack-ws-limit-field');
                module.title = name;
                module.append(head, field);
                rail.append(module);
            }
        }

        for (const [name, processor] of processors) {
            const p = processor?.parameters || {};
            const module = wsElement('article', 'estack-ws-protection-module');
            const head = wsElement('div', 'estack-ws-protection-module-head');
            head.append(
                wsElement('strong', '', String(processor?.type || name).toUpperCase()),
                wsElement('span', '', 'ACTIVE')
            );
            const metrics = wsElement('div', 'estack-ws-protection-metrics');
            const values = [
                ['THRESH', p.threshold, v => `${Number(v).toFixed(1)} dB`],
                ['ATTACK', p.attack, v => `${Number(v).toFixed(3)} s`],
                ['RELEASE', p.release, v => `${Number(v).toFixed(3)} s`],
                ['RATIO', p.factor, v => `${Number(v)}:1`]
            ];
            for (const [label, value, formatter] of values) {
                if (value === undefined) continue;
                const metric = wsElement('span', 'estack-ws-protection-metric');
                metric.append(wsElement('small', '', label), wsElement('strong', '', formatter(value)));
                metrics.append(metric);
            }
            module.title = name;
            module.append(head, metrics);
            rail.append(module);
        }

        if (!rail.children.length) {
            const module = wsElement('article', 'estack-ws-protection-module');
            module.append(wsElement('div', 'estack-ws-empty', 'No protection module on this output'));
            rail.append(module);
        }
        return rail;
    }

    function wsOutput() {
        const section = wsElement('section', 'estack-ws-section estack-ws-output');
        section.append(wsSectionHead('OUTPUT / ALIGN / PROTECTION', wsLocked() ? 'LOCKED' : 'LIVE EDIT'));
        const grid = wsElement('div', 'estack-ws-output-grid');

        const gainEntry = getGainEntry();
        const delayEntry = getDelayEntry();

        if (gainEntry) {
            const p = gainEntry[1].parameters || (gainEntry[1].parameters = {});
            grid.append(wsKnobField({
                label: 'GAIN', value: Number(p.gain || 0), min: -60, max: 12, step: .1,
                unit: 'dB', resetValue: 0, disabled: wsLocked(),
                preview: next => { p.gain = wsRound(next, 1); drawGraph(); },
                commit: async next => {
                    p.gain = wsRound(next, 1);
                    await safeUpload(`${channelName()} output gain`);
                    renderAll(false);
                }
            }));
        }

        if (delayEntry) {
            const p = delayEntry[1].parameters || (delayEntry[1].parameters = {});
            const unit = p.unit || 'ms';
            grid.append(wsKnobField({
                label: 'DELAY', value: Number(p.delay || 0), min: 0,
                max: unit === 'ms' ? 100 : 50000, step: unit === 'ms' ? .01 : 1,
                unit, resetValue: 0, disabled: wsLocked(), preview: null,
                commit: async next => {
                    p.delay = Number(next);
                    await safeUpload(`${channelName()} alignment delay`);
                    renderAll(false);
                }
            }));
        }

        const reference = wsPhaseReference();
        grid.append(wsKnobField({
            label: `PHASE @ ${Math.round(reference)} Hz`, value: wsCurrentPhase(),
            min: -179, max: 0, step: .1, unit: '°', resetValue: 0,
            disabled: wsLocked(), preview: null, commit: wsCommitPhase
        }));

        if (gainEntry) {
            const p = gainEntry[1].parameters || (gainEntry[1].parameters = {});
            grid.append(wsStateButton(
                'POLARITY', p.inverted ? 'INVERTED' : 'NORMAL',
                p.inverted ? 'active warning' : '', wsLocked(), async () => {
                    p.inverted = !p.inverted;
                    await safeUpload(`${channelName()} polarity`);
                    renderAll(false);
                }
            ));
            grid.append(wsStateButton(
                'OUTPUT', p.mute ? 'MUTED' : 'ON',
                p.mute ? 'danger active' : '', wsLocked(), async () => {
                    p.mute = !p.mute;
                    await safeUpload(`${channelName()} ${p.mute ? 'muted' : 'unmuted'}`);
                    renderAll(false);
                }
            ));
        }

        section.append(grid, wsProtectionRail());
        return section;
    }

    /* ----------------------------------------------------------------------
       Parametric EQ
       ---------------------------------------------------------------------- */
    async function wsDeletePeq(slot, entry) {
        if (!entry) return;
        const [name] = entry;
        DSP.removeFilterFromChannelPipeline(name, selectedChannel);
        if (DSP.config?.filters?.[name]) delete DSP.config.filters[name];
        if (typeof estackPeqDisabledKey === 'function') {
            window.localStorage.removeItem(estackPeqDisabledKey(selectedChannel, slot));
        }
        if (typeof estackPeqStoredGainKey === 'function') {
            window.localStorage.removeItem(estackPeqStoredGainKey(selectedChannel, slot));
        }
        await safeUpload(`${channelName()} PEQ ${slot + 1} deleted`);
        selectedPeqSlot = 0;
        renderAll(false);
    }

    function wsPeqRow(slot, entry) {
        const p = entry[1].parameters || (entry[1].parameters = {});
        const bypassed = typeof estackPeqIsDisabled === 'function' && estackPeqIsDisabled(selectedChannel, slot);
        const row = wsElement('div', `estack-ws-peq-row ${bypassed ? 'bypassed' : ''}`.trim());
        row.dataset.peqSlot = String(slot);

        const power = wsElement('button', `estack-ws-peq-power ${bypassed ? '' : 'active'}`.trim());
        power.type = 'button';
        power.title = bypassed ? 'Enable PEQ' : 'Bypass PEQ';
        power.setAttribute('aria-label', power.title);
        power.addEventListener('click', () => estackTogglePeq(slot));

        const index = wsElement('strong', 'estack-ws-peq-index', String(slot + 1));
        const type = wsSelect(
            ['Peaking', 'Lowshelf', 'Highshelf'], p.type || 'Peaking',
            value => value === 'Peaking' ? 'BELL' : value === 'Lowshelf' ? 'LOW SHELF' : 'HIGH SHELF',
            false, value => estackCommitPeqValue(slot, 'type', value)
        );
        const freq = wsNumber(
            Number(p.freq || 1000), 20, 20000, 1, 'Hz', false,
            next => estackCommitPeqValue(slot, 'freq', next),
            next => { p.freq = next; selectedPeqSlot = slot; drawGraph(); }
        );
        const gain = wsNumber(
            Number(p.gain || 0), ESTACK_PEQ_GAIN_MIN, ESTACK_PEQ_GAIN_MAX, .1, 'dB', false,
            next => estackCommitPeqValue(slot, 'gain', next),
            next => { p.gain = next; selectedPeqSlot = slot; drawGraph(); }
        );
        const q = wsNumber(
            Number(p.q || ESTACK_PEQ_DEFAULT_Q), .1, 20, .01, 'Q', false,
            next => estackCommitPeqValue(slot, 'q', next),
            next => { p.q = next; selectedPeqSlot = slot; drawGraph(); }
        );

        const remove = wsElement('button', 'estack-ws-peq-delete', '×');
        remove.type = 'button';
        remove.title = `Delete PEQ ${slot + 1}`;
        remove.addEventListener('click', () => wsDeletePeq(slot, entry));

        row.append(
            power, index,
            wsField('TYPE', type),
            wsField('FREQ', freq),
            wsField('GAIN', gain),
            wsField('Q', q),
            remove
        );
        row.addEventListener('pointerdown', () => {
            selectedPeqSlot = slot;
            drawGraph();
        });
        return row;
    }

    function wsPeq() {
        const section = wsElement('section', 'estack-ws-section estack-ws-peq');
        const slots = mapPeqSlots();
        const active = slots.map((entry, slot) => ({ entry, slot })).filter(item => !!item.entry);
        const head = wsSectionHead('PARAMETRIC EQ', `${active.length} band${active.length === 1 ? '' : 's'}`);
        const add = wsElement('button', 'estack-ws-add-peq', '+ PEQ');
        add.type = 'button';
        const emptySlot = slots.findIndex(entry => !entry);
        add.disabled = emptySlot < 0;
        add.addEventListener('click', () => {
            const empty = mapPeqSlots().findIndex(entry => !entry);
            if (empty >= 0) createPeqBand(empty);
        });
        head.append(add);
        section.append(head);

        const rows = wsElement('div', 'estack-ws-peq-rows');
        if (!active.length) {
            const empty = wsElement('button', 'estack-ws-peq-empty');
            empty.type = 'button';
            empty.innerHTML = '<strong>No parametric EQ</strong><span>+ PEQ to add a correction band</span>';
            empty.addEventListener('click', () => createPeqBand(0));
            rows.append(empty);
        } else {
            active.forEach(({ entry, slot }) => rows.append(wsPeqRow(slot, entry)));
        }
        section.append(rows);
        return section;
    }

    /* ----------------------------------------------------------------------
       Crossover — intentionally after PEQ
       ---------------------------------------------------------------------- */
    function wsCrossoverPane(kind) {
        const entry = getCrossover(kind);
        const pane = wsElement('article', `estack-ws-xo estack-ws-${kind}`);
        pane.append(wsElement('strong', 'estack-ws-xo-title', kind === 'hpf' ? 'HIGH PASS' : 'LOW PASS'));

        if (!entry) {
            pane.append(wsElement('div', 'estack-ws-empty', 'Not configured'));
            return pane;
        }

        const [name, filter] = entry;
        const p = filter.parameters || (filter.parameters = {});
        const family = String(p.type || '').startsWith('Butterworth') ? 'Butterworth' : 'LinkwitzRiley';
        const slope = Math.max(12, Number(p.order || 4) * 6);

        pane.append(wsKnobField({
            label: 'FREQ', value: Number(p.freq || 100), min: 16, max: 20000,
            step: 1, logarithmic: true, unit: 'Hz', resetValue: Number(p.freq || 100),
            disabled: wsLocked(),
            preview: next => { p.freq = wsRound(next, 1); drawGraph(); },
            commit: async next => {
                p.freq = wsRound(next, 1);
                await safeUpload(`${channelName()} ${kind.toUpperCase()} frequency`);
                renderAll(false);
            }
        }));

        const controls = wsElement('div', 'estack-ws-xo-controls');
        controls.append(wsField('TYPE', wsSelect(
            ['LinkwitzRiley', 'Butterworth'], family,
            value => value === 'LinkwitzRiley' ? 'LR' : 'BW', wsLocked(), async value => {
                p.type = `${value}${kind === 'hpf' ? 'Highpass' : 'Lowpass'}`;
                await safeUpload(`${channelName()} ${kind.toUpperCase()} type`);
                renderAll(false);
            }
        )));
        controls.append(wsField('SLOPE', wsSelect(
            [12, 24, 36, 48], slope, value => `${value} dB`, wsLocked(), async value => {
                p.order = Number(value) / 6;
                await safeUpload(`${channelName()} ${kind.toUpperCase()} slope`);
                renderAll(false);
            }
        )));
        pane.title = name;
        pane.append(controls);
        return pane;
    }

    function wsCrossover() {
        const section = wsElement('section', 'estack-ws-section estack-ws-crossover');
        section.append(wsSectionHead('CROSSOVER', wsLocked() ? 'LOCKED' : 'LIVE EDIT'));
        const grid = wsElement('div', 'estack-ws-crossover-grid');
        grid.append(wsCrossoverPane('hpf'), wsCrossoverPane('lpf'));
        section.append(grid);
        return section;
    }

    /* ----------------------------------------------------------------------
       Analyzer and graph chrome
       ---------------------------------------------------------------------- */
    function wsAnalyzerBar() {
        const bar = wsElement('section', 'estack-ws-analyzerbar');
        bar.append(wsElement('strong', '', 'ANALYZER'));

        if (typeof estackSpectrumView !== 'undefined' && typeof estackSetSpectrumView === 'function') {
            bar.append(wsField('VIEW', wsSelect(
                ['full', 'sub', 'low', 'mid', 'high'], estackSpectrumView,
                value => String(value).toUpperCase(), false,
                value => estackSetSpectrumView(value)
            )));
        }

        if (typeof estackSpectrumMode !== 'undefined' && typeof estackSetSpectrumMode === 'function') {
            const modes = wsElement('div', 'estack-ws-analyzer-modes');
            for (const mode of ['raw', 'fast', 'slow']) {
                const button = wsElement('button', estackSpectrumMode === mode ? 'active' : '', mode.toUpperCase());
                button.type = 'button';
                button.addEventListener('click', () => {
                    estackSetSpectrumMode(mode);
                    renderAll(false);
                });
                modes.append(button);
            }
            bar.append(modes);
        }

        if (typeof estackEq8RefreshHz !== 'undefined') {
            bar.append(wsField('REFRESH', wsSelect(
                [10, 15, 20, 30], estackEq8RefreshHz,
                value => `${value} Hz`, false, value => {
                    estackEq8RefreshHz = Number(value);
                    window.localStorage.setItem('estack.analyzer.refreshHz', String(estackEq8RefreshHz));
                    startSpectrum();
                }
            ), 'estack-ws-analyzer-advanced'));
        }
        return bar;
    }

    function mountGraphChrome(analyzer) {
        const graph = document.querySelector('.venu-graph-wrap');
        const modebar = document.getElementById('estackGraphModebar');
        const readout = document.getElementById('estackXoReadout');
        if (!graph || !modebar) return false;

        // PhaseGraph creates these controls before the graph. The unified page
        // owns final placement: graph -> command bar -> stable XO readout.
        if (graph.nextElementSibling !== modebar) graph.insertAdjacentElement('afterend', modebar);
        if (readout && modebar.nextElementSibling !== readout) modebar.insertAdjacentElement('afterend', readout);

        let actions = modebar.querySelector('.estack-graph-actions');
        if (!actions) {
            actions = wsElement('div', 'estack-graph-actions');
            const note = modebar.querySelector('.estack-phase-source-note');
            if (note) modebar.insertBefore(actions, note);
            else modebar.append(actions);
        }

        const legend = document.querySelector('.venu-graph-legend');
        const edit = document.getElementById('systemEditToggle');
        if (legend && legend.parentElement !== actions) actions.append(legend);
        if (analyzer && analyzer.parentElement !== actions) actions.append(analyzer);
        if (edit && edit.parentElement !== actions) actions.append(edit);
        return true;
    }

    /* ----------------------------------------------------------------------
       Final render overrides
       ---------------------------------------------------------------------- */
    renderModuleTabs = function() {
        activeModule = 'peq';
        const root = document.getElementById('moduleTabs');
        if (root) root.replaceChildren();
    };

    renderBandSelector = function() {
        const root = document.getElementById('bandSelector');
        if (!root) return;
        root.replaceChildren();
        root.classList.add('estack-peq-hidden-selector');
    };

    renderHeader = function() {
        if (typeof estackV4ApplyChannelAccent === 'function') estackV4ApplyChannelAccent(selectedChannel);
        const selectedTitle = document.getElementById('selectedChannelTitle');
        const selectedMeta = document.getElementById('selectedChannelMeta');
        if (selectedTitle) selectedTitle.textContent = channelName();
        if (selectedMeta) selectedMeta.textContent = `OUT ${selectedChannel + 1}`;

        const edit = document.getElementById('systemEditToggle');
        if (edit) {
            edit.setAttribute('aria-pressed', String(systemEditEnabled));
            edit.textContent = systemEditEnabled ? '● EDITING' : '🔒 LOCKED';
            edit.title = systemEditEnabled
                ? 'System parameters are editable. Tap to lock.'
                : 'Tap once to unlock crossover, alignment and protection editing for this session.';
        }
    };

    renderControls = function() {
        activeModule = 'peq';
        const root = document.getElementById('moduleControls');
        root.className = 'venu-controls estack-workspace-mode';
        root.replaceChildren();

        const workspace = wsElement('div', 'estack-ws-workspace estack-ws-workspace-unified');
        const analyzer = wsAnalyzerBar();

        // Temporary DOM position makes the analyzer available even if PhaseGraph
        // has not mounted its command bar yet. mountGraphChrome moves it later.
        workspace.append(analyzer, wsOutput(), wsPeq(), wsCrossover());
        root.append(workspace);

        requestAnimationFrame(() => mountGraphChrome(analyzer));
    };

    document.addEventListener('DOMContentLoaded', () => {
        requestAnimationFrame(() => {
            const analyzer = document.querySelector('.estack-ws-analyzerbar');
            mountGraphChrome(analyzer);
        });
    });

    try { activeModule = 'peq'; } catch (_) {}
})();
