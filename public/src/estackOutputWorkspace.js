// E-Stack Output Workspace — measurement-first per-way editor.
// Loaded last on Output Processing. It keeps the existing DSP mutation model,
// graph/phase engine and safety guard, but replaces the multi-tab control surface
// with one compact per-way workspace designed for desktop and phone use.

(function installEStackOutputWorkspace() {
    const PHASE_PREFIX = 'ESTACK_PHASE_';

    function wsLocked() { return !systemEditEnabled; }
    function wsClamp(value, min, max) {
        const n = Number(value);
        return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
    }
    function wsRound(value, decimals = 1) {
        const f = Math.pow(10, decimals);
        return Math.round(Number(value) * f) / f;
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

    function wsSectionHead(title, meta) {
        const head = wsElement('header', 'estack-ws-section-head');
        head.append(wsElement('strong', '', title));
        if (meta) head.append(wsElement('span', '', meta));
        return head;
    }

    async function wsSelectChannel(channel) {
        if (typeof estackV4SelectChannel === 'function') {
            await estackV4SelectChannel(channel);
            return;
        }
        selectedChannel = Number(channel);
        selectedPeqSlot = 0;
        await DSP.downloadConfig();
        renderAll(false);
    }

    function wsWayStepper() {
        const root = wsElement('div', 'estack-ws-waystep');
        const channels = activeChannels();
        const index = Math.max(0, channels.indexOf(selectedChannel));
        const previous = channels[(index - 1 + channels.length) % channels.length];
        const next = channels[(index + 1) % channels.length];

        const prev = wsElement('button', 'estack-ws-way-arrow', '‹');
        prev.type = 'button';
        prev.title = `Previous output · ${channelName(previous)}`;
        prev.addEventListener('click', () => wsSelectChannel(previous));

        const current = wsElement('div', 'estack-ws-way-current');
        const dot = wsElement('i');
        dot.style.setProperty('--channel-color', typeof estackV4ChannelColor === 'function' ? estackV4ChannelColor(selectedChannel) : '#59d5e3');
        current.append(dot, wsElement('strong', '', channelName()), wsElement('span', '', `OUT ${selectedChannel + 1}`));

        const nxt = wsElement('button', 'estack-ws-way-arrow', '›');
        nxt.type = 'button';
        nxt.title = `Next output · ${channelName(next)}`;
        nxt.addEventListener('click', () => wsSelectChannel(next));
        root.append(prev, current, nxt);
        return root;
    }

    function wsCrossover(kind) {
        const entry = getCrossover(kind);
        const card = wsElement('section', `estack-ws-compact-card estack-ws-xo estack-ws-${kind}`);
        const label = kind === 'hpf' ? 'HIGH PASS' : 'LOW PASS';
        card.append(wsSectionHead(label, entry ? (wsLocked() ? 'LOCKED' : 'LIVE EDIT') : 'NOT CONFIGURED'));
        if (!entry) {
            card.append(wsElement('div', 'estack-ws-empty', 'No crossover on this output'));
            return card;
        }

        const [name, filter] = entry;
        const p = filter.parameters || (filter.parameters = {});
        const family = String(p.type || '').startsWith('Butterworth') ? 'Butterworth' : 'LinkwitzRiley';
        const slope = Math.max(12, Number(p.order || 4) * 6);
        const controls = wsElement('div', 'estack-ws-xo-controls');

        controls.append(wsField('FREQ', wsNumber(
            Number(p.freq || 100), 16, 20000, 1, 'Hz', wsLocked(),
            async next => {
                p.freq = wsRound(next, 1);
                await safeUpload(`${channelName()} ${kind.toUpperCase()} frequency`);
                renderAll(false);
            },
            next => { p.freq = wsRound(next, 1); drawGraph(); }
        )));

        controls.append(wsField('TYPE', wsSelect(
            ['LinkwitzRiley', 'Butterworth'], family,
            value => value === 'LinkwitzRiley' ? 'LR' : 'BW', wsLocked(),
            async value => {
                p.type = `${value}${kind === 'hpf' ? 'Highpass' : 'Lowpass'}`;
                await safeUpload(`${channelName()} ${kind.toUpperCase()} type`);
                renderAll(false);
            }
        )));

        controls.append(wsField('SLOPE', wsSelect(
            [12, 24, 36, 48], slope, value => `${value} dB`, wsLocked(),
            async value => {
                p.order = Number(value) / 6;
                await safeUpload(`${channelName()} ${kind.toUpperCase()} slope`);
                renderAll(false);
            }
        )));

        card.title = name;
        card.append(controls);
        return card;
    }

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
        const meta = wsPhaseMetadata(channel);
        if (meta?.referenceHz > 0) return meta.referenceHz;
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
            if (step?.type === 'Filter' && Array.isArray(step.names)) step.names = step.names.filter(item => item !== name);
        }
        if (DSP?.config?.filters) delete DSP.config.filters[name];
    }

    function wsAttachPhase(name, channel = selectedChannel) {
        const pipeline = DSP?.config?.pipeline || [];
        const mixerIndex = pipeline.findIndex(step => step?.type === 'Mixer');
        const stage = pipeline.slice(mixerIndex + 1).find(step =>
            step?.type === 'Filter' && stepChannels(step).includes(Number(channel)) &&
            (step.names || []).some(filterName => ['Gain', 'Delay', 'BiquadCombo'].includes(DSP?.config?.filters?.[filterName]?.type))
        );
        if (!stage) throw new Error(`No output filter stage found for ${channelName(channel)}`);
        const channels = stepChannels(stage);
        if (channels.length !== 1 || channels[0] !== Number(channel)) throw new Error('Phase trim requires an independent output stage');
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
            if (typeof DSP.uploadConfigGuarded !== 'function') throw new Error('Guarded configuration writer unavailable');
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

    function wsAlignment() {
        const card = wsElement('section', 'estack-ws-compact-card estack-ws-alignment');
        card.append(wsSectionHead('OUTPUT / ALIGN', wsLocked() ? 'LOCKED' : 'LIVE EDIT'));
        const controls = wsElement('div', 'estack-ws-align-controls');
        const gainEntry = getGainEntry();
        const delayEntry = getDelayEntry();

        if (gainEntry) {
            const p = gainEntry[1].parameters || (gainEntry[1].parameters = {});
            controls.append(wsField('GAIN', wsNumber(
                Number(p.gain || 0), -60, 12, .1, 'dB', wsLocked(),
                async next => {
                    p.gain = wsRound(next, 1);
                    await safeUpload(`${channelName()} output gain`);
                    renderAll(false);
                },
                next => { p.gain = wsRound(next, 1); drawGraph(); }
            )));

            const polarity = wsElement('button', `estack-ws-state-button ${p.inverted ? 'active warning' : ''}`.trim());
            polarity.type = 'button';
            polarity.disabled = wsLocked();
            polarity.innerHTML = `<span>POLARITY</span><strong>${p.inverted ? 'INVERTED' : 'NORMAL'}</strong>`;
            polarity.addEventListener('click', async () => {
                p.inverted = !p.inverted;
                await safeUpload(`${channelName()} polarity`);
                renderAll(false);
            });
            controls.append(polarity);

            const mute = wsElement('button', `estack-ws-state-button ${p.mute ? 'danger active' : ''}`.trim());
            mute.type = 'button';
            mute.disabled = wsLocked();
            mute.innerHTML = `<span>OUTPUT</span><strong>${p.mute ? 'MUTED' : 'ON'}</strong>`;
            mute.addEventListener('click', async () => {
                p.mute = !p.mute;
                await safeUpload(`${channelName()} ${p.mute ? 'muted' : 'unmuted'}`);
                renderAll(false);
            });
            controls.append(mute);
        }

        if (delayEntry) {
            const p = delayEntry[1].parameters || (delayEntry[1].parameters = {});
            const unit = p.unit || 'ms';
            controls.append(wsField('DELAY', wsNumber(
                Number(p.delay || 0), 0, unit === 'ms' ? 100 : 50000, unit === 'ms' ? .01 : 1, unit, wsLocked(),
                async next => {
                    p.delay = Number(next);
                    await safeUpload(`${channelName()} alignment delay`);
                    renderAll(false);
                }
            )));
        }

        const ref = wsPhaseReference();
        controls.append(wsField(`PHASE @ ${Math.round(ref)} Hz`, wsNumber(
            wsCurrentPhase(), -179, 0, .1, '°', wsLocked(), wsCommitPhase
        ), 'estack-ws-phase-field'));
        card.append(controls);
        return card;
    }

    async function wsDeletePeq(slot, entry) {
        if (!entry) return;
        const [name] = entry;
        DSP.removeFilterFromChannelPipeline(name, selectedChannel);
        if (DSP.config?.filters?.[name]) delete DSP.config.filters[name];
        if (typeof estackPeqDisabledKey === 'function') window.localStorage.removeItem(estackPeqDisabledKey(selectedChannel, slot));
        if (typeof estackPeqStoredGainKey === 'function') window.localStorage.removeItem(estackPeqStoredGainKey(selectedChannel, slot));
        await safeUpload(`${channelName()} PEQ ${slot + 1} deleted`);
        selectedPeqSlot = 0;
        renderAll(false);
    }

    function wsPeqRow(slot, entry) {
        const p = entry[1].parameters || (entry[1].parameters = {});
        const disabled = typeof estackPeqIsDisabled === 'function' && estackPeqIsDisabled(selectedChannel, slot);
        const row = wsElement('div', `estack-ws-peq-row ${disabled ? 'bypassed' : ''}`.trim());
        row.dataset.peqSlot = String(slot);

        const power = wsElement('button', `estack-ws-peq-power ${disabled ? '' : 'active'}`.trim());
        power.type = 'button';
        power.title = disabled ? 'Enable PEQ' : 'Bypass PEQ';
        power.setAttribute('aria-label', power.title);
        power.addEventListener('click', () => estackTogglePeq(slot));

        const number = wsElement('strong', 'estack-ws-peq-index', String(slot + 1));
        const type = wsSelect(
            ['Peaking', 'Lowshelf', 'Highshelf'], p.type || 'Peaking',
            value => value === 'Peaking' ? 'BELL' : value === 'Lowshelf' ? 'LOW SHELF' : 'HIGH SHELF', false,
            value => estackCommitPeqValue(slot, 'type', value)
        );

        const freq = wsNumber(Number(p.freq || 1000), 20, 20000, 1, 'Hz', false,
            next => estackCommitPeqValue(slot, 'freq', next),
            next => { p.freq = next; selectedPeqSlot = slot; drawGraph(); });
        const gain = wsNumber(Number(p.gain || 0), ESTACK_PEQ_GAIN_MIN, ESTACK_PEQ_GAIN_MAX, .1, 'dB', false,
            next => estackCommitPeqValue(slot, 'gain', next),
            next => { p.gain = next; selectedPeqSlot = slot; drawGraph(); });
        const q = wsNumber(Number(p.q || ESTACK_PEQ_DEFAULT_Q), .1, 20, .01, 'Q', false,
            next => estackCommitPeqValue(slot, 'q', next),
            next => { p.q = next; selectedPeqSlot = slot; drawGraph(); });

        const remove = wsElement('button', 'estack-ws-peq-delete', '×');
        remove.type = 'button';
        remove.title = `Delete PEQ ${slot + 1}`;
        remove.addEventListener('click', () => wsDeletePeq(slot, entry));

        row.append(power, number,
            wsField('TYPE', type),
            wsField('FREQ', freq),
            wsField('GAIN', gain),
            wsField('Q', q),
            remove);
        row.addEventListener('pointerdown', () => {
            selectedPeqSlot = slot;
            drawGraph();
        });
        return row;
    }

    function wsPeq() {
        const card = wsElement('section', 'estack-ws-card estack-ws-peq');
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
        card.append(head);

        const rows = wsElement('div', 'estack-ws-peq-rows');
        if (!active.length) {
            const empty = wsElement('button', 'estack-ws-peq-empty');
            empty.type = 'button';
            empty.innerHTML = '<strong>No PEQ</strong><span>Tap to create the first band</span>';
            empty.addEventListener('click', () => createPeqBand(0));
            rows.append(empty);
        } else {
            active.forEach(({ entry, slot }) => rows.append(wsPeqRow(slot, entry)));
        }
        card.append(rows);
        return card;
    }

    function wsProtection() {
        const card = wsElement('section', 'estack-ws-card estack-ws-protection');
        const limiters = getLimiterEntries();
        const processors = getProcessorEntries();
        card.append(wsSectionHead('PROTECTION', wsLocked() ? 'LOCKED' : 'LIVE EDIT'));
        const body = wsElement('div', 'estack-ws-protection-body');

        if (limiters.length) {
            for (const [name, filter] of limiters) {
                const p = filter.parameters || (filter.parameters = {});
                body.append(wsField('HARD LIMIT', wsNumber(
                    Number(p.clip_limit ?? -3), -60, 0, .1, 'dBFS', wsLocked(),
                    async next => {
                        p.clip_limit = wsRound(next, 1);
                        await safeUpload(`${channelName()} limiter threshold`);
                        renderAll(false);
                    }
                ), 'estack-ws-limit-field'));
            }
        } else {
            body.append(wsElement('span', 'estack-ws-protection-empty', 'No hard limiter'));
        }

        for (const [name, processor] of processors) {
            const p = processor?.parameters || {};
            const summary = wsElement('div', 'estack-ws-processor-summary');
            summary.append(wsElement('strong', '', String(processor?.type || name).toUpperCase()));
            const values = [
                p.threshold !== undefined ? `THR ${Number(p.threshold).toFixed(1)} dB` : '',
                p.attack !== undefined ? `A ${Number(p.attack).toFixed(3)} s` : '',
                p.release !== undefined ? `R ${Number(p.release).toFixed(3)} s` : '',
                p.factor !== undefined ? `RATIO ${Number(p.factor)}:1` : ''
            ].filter(Boolean);
            summary.append(wsElement('span', '', values.join(' · ') || name));
            body.append(summary);
        }
        card.append(body);
        return card;
    }

    function wsAnalyzerBar() {
        const bar = wsElement('section', 'estack-ws-analyzerbar');
        bar.append(wsElement('strong', '', 'ANALYZER'));

        if (typeof estackSpectrumView !== 'undefined' && typeof estackSetSpectrumView === 'function') {
            const view = wsSelect(['full', 'sub', 'low', 'mid', 'high'], estackSpectrumView,
                value => String(value).toUpperCase(), false, value => estackSetSpectrumView(value));
            bar.append(wsField('VIEW', view));
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
            const refresh = wsSelect([10, 15, 20, 30], estackEq8RefreshHz, value => `${value} Hz`, false, value => {
                estackEq8RefreshHz = Number(value);
                window.localStorage.setItem('estack.analyzer.refreshHz', String(estackEq8RefreshHz));
                startSpectrum();
            });
            bar.append(wsField('REFRESH', refresh, 'estack-ws-analyzer-advanced'));
        }
        return bar;
    }

    // The output page is always a per-way workspace now. No module switching is
    // required; the graph stays in PEQ/magnitude context while all output system
    // controls are rendered below it at the same time.
    renderModuleTabs = function() {
        activeModule = 'peq';
        const root = document.getElementById('moduleTabs');
        root.replaceChildren(wsWayStepper());
    };

    renderBandSelector = function() {
        const root = document.getElementById('bandSelector');
        root.replaceChildren();
        root.classList.add('estack-peq-hidden-selector');
    };

    renderHeader = function() {
        if (typeof estackV4ApplyChannelAccent === 'function') estackV4ApplyChannelAccent(selectedChannel);
        const selectedTitle = document.getElementById('selectedChannelTitle');
        const selectedMeta = document.getElementById('selectedChannelMeta');
        if (selectedTitle) selectedTitle.textContent = channelName();
        if (selectedMeta) selectedMeta.textContent = `OUT ${selectedChannel + 1}`;
        const moduleTitle = document.getElementById('moduleTitle');
        const moduleSubtitle = document.getElementById('moduleSubtitle');
        if (moduleTitle) moduleTitle.textContent = 'PER-WAY WORKSPACE';
        if (moduleSubtitle) moduleSubtitle.textContent = '';
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

        const workspace = wsElement('div', 'estack-ws-workspace');
        workspace.append(wsAnalyzerBar());

        const essentials = wsElement('div', 'estack-ws-essentials');
        essentials.append(wsCrossover('hpf'), wsCrossover('lpf'), wsAlignment());
        workspace.append(essentials, wsPeq(), wsProtection());
        root.append(workspace);
    };

    // Keep channel selection reachable on phones even if the user is working
    // lower in the page. The actual sticky behaviour is CSS-owned.
    try { activeModule = 'peq'; } catch (_) {}
})();
