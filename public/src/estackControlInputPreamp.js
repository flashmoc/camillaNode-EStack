'use strict';

// E-Stack Control — global digital input trim on normal programme inputs L/R.
//
// The trim is a CamillaDSP Gain filter placed before every other pre-routing
// stage. Positive values recover source-level headroom when WiiM=100% and
// MASTER=0 dB. Negative values are available for digital gain staging only:
// because this stage is AFTER the ADC, negative DSP trim cannot prevent analog
// input/ADC clipping. Use an analog pad or reduce the source output for that.
// Measurement Batch strips this trim from every temporary measurement state and
// restores the captured normal-listening baseline at end.

(() => {
    // Keep the original stable filter/step identities for backwards-compatible
    // configs even though the operator-facing name is now INPUT TRIM.
    const FILTER = 'ESTACK_INPUT_PREAMP';
    const STEP_DESCRIPTION = 'E-Stack input preamp';
    const MIN_DB = -20;
    const MAX_DB = 12;
    const STEP_DB = 0.5;
    const AUTO_RESERVE_DB = 1.0;
    const SAFE_TRANSITION_DB = -60;
    const EPSILON = 0.01;
    let busy = false;
    let refreshTimer = null;

    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

    function stable(value) {
        if (Array.isArray(value)) return value.map(stable);
        if (value && typeof value === 'object') {
            const out = {};
            for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
            return out;
        }
        return value;
    }

    function clampGain(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(MIN_DB, Math.min(MAX_DB, Math.round(n / STEP_DB) * STEP_DB));
    }

    function signed(value) {
        const n = Number(value);
        return `${n > 0 ? '+' : ''}${n.toFixed(1)} dB`;
    }

    function firstMixerIndex(config) {
        return (config?.pipeline || []).findIndex(step => step?.type === 'Mixer');
    }

    function preampStep(config = DSP?.config) {
        return (config?.pipeline || []).find(step =>
            step?.type === 'Filter' && (
                step?.description === STEP_DESCRIPTION ||
                (step.names || []).includes(FILTER)
            )
        ) || null;
    }

    function currentGain(config = DSP?.config) {
        const filter = config?.filters?.[FILTER];
        const step = preampStep(config);
        if (!filter || filter.type !== 'Gain' || !step) return 0;
        const gain = Number(filter?.parameters?.gain);
        return Number.isFinite(gain) ? gain : 0;
    }

    function removePreamp(config) {
        if (!config) return config;
        const pipeline = config.pipeline || [];
        for (const step of pipeline) {
            if (step?.type !== 'Filter' || !Array.isArray(step.names)) continue;
            step.names = step.names.filter(name => name !== FILTER);
        }
        config.pipeline = pipeline.filter(step =>
            !(step?.type === 'Filter' && step?.description === STEP_DESCRIPTION && (!Array.isArray(step.names) || step.names.length === 0))
        );
        if (config.filters) delete config.filters[FILTER];
        return config;
    }

    function installPreamp(config, gainDb) {
        removePreamp(config);
        const gain = clampGain(gainDb);
        if (Math.abs(gain) <= EPSILON) return config;

        const captureChannels = Number(config?.devices?.capture?.channels || 0);
        if (!Number.isInteger(captureChannels) || captureChannels < 2) {
            throw new Error('Input Trim requires normal programme inputs L/R (capture channels 1 + 2)');
        }
        const mixerIndex = firstMixerIndex(config);
        if (mixerIndex < 0) throw new Error('Input Trim requires a Mixer stage');

        config.filters = config.filters || {};
        config.filters[FILTER] = {
            type: 'Gain',
            description: `E-Stack global input trim · ${signed(gain)}`,
            parameters: {
                gain,
                scale: 'dB',
                inverted: false,
                mute: false
            }
        };

        const stage = {
            type: 'Filter',
            channels: [0, 1],
            names: [FILTER],
            description: STEP_DESCRIPTION,
            bypassed: false
        };
        // Global digital source trim must be the first pre-routing DSP stage.
        config.pipeline.unshift(stage);
        return config;
    }

    function fingerprintWithoutPreamp(config) {
        const copy = clone(config || {});
        removePreamp(copy);
        return JSON.stringify(stable({
            filters: copy.filters || {},
            pipeline: copy.pipeline || [],
            processors: copy.processors || {},
            mixers: copy.mixers || {}
        }));
    }

    async function measurementBatchActive() {
        try {
            const response = await fetch('/api/measurement-batch/status', { cache: 'no-store' });
            if (!response.ok) return false;
            const data = await response.json();
            return !!data.active;
        } catch (_) {
            return false;
        }
    }

    function signalGeneratorActive() {
        return DSP?.config?.devices?.capture?.type === 'SignalGenerator';
    }

    function parseHeadroom() {
        const el = document.getElementById('estackSystemHeadroom');
        const raw = String(el?.textContent || '').trim();
        if (!raw || raw === '—' || raw === 'ERROR') return null;
        const match = raw.match(/[+-]?\d+(?:\.\d+)?/);
        if (!match) return null;
        const value = Number(match[0]);
        return Number.isFinite(value) ? value : null;
    }

    function availableAddition() {
        const headroom = parseHeadroom();
        if (!Number.isFinite(headroom)) return null;
        const current = currentGain();
        const roomInTrim = Math.max(0, MAX_DB - current);
        const roomToProtection = Math.max(0, headroom - AUTO_RESERVE_DB);
        // Round DOWN so the automatic action never consumes the reserved margin.
        const stepped = Math.floor((Math.min(roomInTrim, roomToProtection) + 1e-9) / STEP_DB) * STEP_DB;
        return Math.max(0, Number(stepped.toFixed(2)));
    }

    function ensurePanel() {
        let root = document.getElementById('estackInputPreamp');
        if (root) return root;
        const strips = document.getElementById('estackMixerStrips');
        if (!strips) return null;

        root = document.createElement('div');
        root.id = 'estackInputPreamp';
        root.className = 'estack-preamp-panel';
        root.innerHTML = `
            <div class="estack-preamp-title">
                <strong>INPUT TRIM</strong>
                <span>DSP POST-ADC · GLOBAL L/R · −20…+12 dB</span>
            </div>
            <div class="estack-preamp-controls">
                <button id="estackPreampDown" class="estack-preamp-step" type="button" aria-label="Reduce digital input trim">−</button>
                <label class="estack-preamp-value-wrap">
                    <input id="estackPreampValue" class="estack-preamp-value" type="number" min="-20" max="12" step="0.5" inputmode="decimal" aria-label="Digital input trim in dB">
                    <span>dB</span>
                </label>
                <button id="estackPreampUp" class="estack-preamp-step" type="button" aria-label="Increase digital input trim">+</button>
            </div>
            <div class="estack-preamp-safe">
                <span>SAFE ADD</span>
                <strong id="estackPreampAvailable">—</strong>
                <small>4 s peak · keeps ${AUTO_RESERVE_DB.toFixed(1)} dB</small>
            </div>
            <button id="estackPreampUse" class="estack-preamp-use" type="button">USE HEADROOM</button>`;
        strips.insertAdjacentElement('beforebegin', root);

        root.querySelector('#estackPreampDown').addEventListener('click', () => setPreamp(currentGain() - STEP_DB));
        root.querySelector('#estackPreampUp').addEventListener('click', () => setPreamp(currentGain() + STEP_DB));
        root.querySelector('#estackPreampValue').addEventListener('change', event => setPreamp(event.target.value));
        root.querySelector('#estackPreampValue').addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            setPreamp(event.currentTarget.value);
            event.currentTarget.blur();
        });
        root.querySelector('#estackPreampUse').addEventListener('click', useAvailableHeadroom);
        return root;
    }

    function setLocked(root, locked) {
        root.dataset.state = locked ? 'locked' : root.dataset.state === 'locked' ? 'ok' : root.dataset.state;
        for (const selector of ['#estackPreampDown', '#estackPreampUp', '#estackPreampValue', '#estackPreampUse']) {
            const el = root.querySelector(selector);
            if (el) el.disabled = !!locked;
        }
    }

    function refreshPanel() {
        const root = ensurePanel();
        if (!root || !DSP?.connected || !DSP?.config) return;
        const gain = currentGain();
        const input = root.querySelector('#estackPreampValue');
        const available = root.querySelector('#estackPreampAvailable');
        const use = root.querySelector('#estackPreampUse');
        if (input && document.activeElement !== input) input.value = gain.toFixed(1);
        root.dataset.active = String(Math.abs(gain) > EPSILON);

        const add = availableAddition();
        if (Number.isFinite(add)) {
            available.textContent = signed(add);
            const headroom = parseHeadroom();
            root.dataset.state = headroom <= 1 ? 'critical' : headroom <= 3 ? 'near' : 'ok';
            use.disabled = busy || add < STEP_DB - EPSILON || gain >= MAX_DB - EPSILON;
            use.title = add >= STEP_DB
                ? `Raise INPUT TRIM by ${signed(add)}. Based on the loudest output peak held over the last 4 seconds and leaves at least ${AUTO_RESERVE_DB.toFixed(1)} dB before the first protection threshold.`
                : `Less than ${STEP_DB.toFixed(1)} dB of guarded automatic headroom is currently available.`;
        } else {
            available.textContent = 'PLAY SIGNAL';
            root.dataset.state = 'ok';
            use.disabled = true;
            use.title = 'Play representative programme material so SYSTEM HEADROOM can be measured first.';
        }
        root.title = `Digital L/R trim AFTER the ADC and before Input Processing/routing. Current ${signed(gain)}. Negative trim does NOT prevent ADC clipping; use an analog pad or reduce source level for that. Measurement Batch forces this trim OFF during acoustic measurements.`;
    }

    async function setPreamp(value) {
        if (busy) return false;
        const target = clampGain(value);
        busy = true;
        const root = ensurePanel();
        if (root) setLocked(root, true);
        try {
            if (await measurementBatchActive()) {
                throw new Error('Finish or abort Measurement Batch before changing Input Trim');
            }
            await DSP.downloadConfig();
            if (signalGeneratorActive()) {
                throw new Error('Stop Signal Generator before changing Input Trim');
            }

            const before = clone(DSP.config);
            const protectedBefore = fingerprintWithoutPreamp(before);
            const originalMaster = Number(await DSP.sendDSPMessage('GetVolume'));
            const safeMaster = Number.isFinite(originalMaster) ? Math.min(originalMaster, SAFE_TRANSITION_DB) : SAFE_TRANSITION_DB;
            if (Number.isFinite(originalMaster)) await DSP.sendDSPMessage({ SetVolume: safeMaster });

            let masterRestored = false;
            try {
                installPreamp(DSP.config, target);
                const ok = await DSP.uploadConfig();
                if (!ok) throw new Error('CamillaDSP rejected Input Trim');
                await DSP.downloadConfig();

                if (fingerprintWithoutPreamp(DSP.config) !== protectedBefore) {
                    throw new Error('DSP processing outside Input Trim changed unexpectedly');
                }
                const actual = currentGain();
                if (Math.abs(actual - target) > 0.02) {
                    throw new Error(`Input Trim verification failed: requested ${target.toFixed(1)} dB, got ${actual.toFixed(2)} dB`);
                }

                if (Number.isFinite(originalMaster)) {
                    await DSP.sendDSPMessage({ SetVolume: originalMaster });
                    masterRestored = true;
                }
                window.estackResetHeadroomHold?.();
                setMixerStatus(`Input Trim ${Math.abs(target) <= EPSILON ? 'OFF' : signed(target)} · DSP post-ADC · global L/R · relative way balance unchanged`, 'ok');
                return true;
            } finally {
                if (!masterRestored && Number.isFinite(originalMaster)) {
                    try { await DSP.sendDSPMessage({ SetVolume: originalMaster }); } catch (_) {}
                }
            }
        } catch (error) {
            console.error('Input Trim update failed', error);
            try { await DSP.downloadConfig(); } catch (_) {}
            setMixerStatus(`Input Trim failed: ${error?.message || error}`, 'error');
            return false;
        } finally {
            busy = false;
            if (root) setLocked(root, false);
            refreshPanel();
        }
    }

    async function useAvailableHeadroom() {
        if (busy) return;
        const add = availableAddition();
        if (!Number.isFinite(add) || add < STEP_DB - EPSILON) {
            setMixerStatus('No guarded positive Input Trim headroom available from the current 4 s peak hold', 'info');
            return;
        }
        const current = currentGain();
        const target = clampGain(current + add);
        if (add >= 3) {
            const accepted = window.confirm(
                `Use available input headroom?\n\n` +
                `INPUT TRIM: ${signed(current)} → ${signed(target)}\n` +
                `Automatic increase: ${signed(add)}\n` +
                `Reserve kept before first protection threshold: at least ${AUTO_RESERVE_DB.toFixed(1)} dB\n\n` +
                `This estimate uses only the loudest peak seen in the last 4 seconds. Play a representative loud section before confirming.`
            );
            if (!accepted) return;
        }
        await setPreamp(target);
    }

    function start() {
        let attempts = 0;
        const wait = () => {
            attempts += 1;
            if (typeof DSP !== 'undefined' && DSP?.connected && faderControls?.size) {
                ensurePanel();
                refreshPanel();
                if (refreshTimer) clearInterval(refreshTimer);
                refreshTimer = setInterval(() => {
                    if (!busy) refreshPanel();
                }, 250);
                return;
            }
            if (attempts < 80) setTimeout(wait, 100);
        };
        wait();
    }

    // Keep legacy API aliases so existing shortcuts/integrations continue to work.
    window.estackSetInputPreamp = setPreamp;
    window.estackGetInputPreamp = () => currentGain();
    window.estackSetInputTrim = setPreamp;
    window.estackGetInputTrim = () => currentGain();

    window.addEventListener('beforeunload', () => {
        if (refreshTimer) clearInterval(refreshTimer);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();