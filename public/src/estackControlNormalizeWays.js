'use strict';

// E-Stack Control — normalize all per-way output Gain filters by one common dB
// offset so the highest way lands exactly at 0 dB. Because every way receives
// the same offset, all relative gain differences are preserved exactly.
// MASTER, mute, polarity, delay, XO, PEQ and limiter settings are untouched.

(function installNormalizeWaysControl() {
    const EPSILON_DB = 0.005;
    const SAFE_TRANSITION_DB = -60;
    let busy = false;
    let refreshTimer = null;

    function roundDb(value) {
        return Number(Number(value).toFixed(6));
    }

    function wayEntriesFromConfig() {
        if (!DSP?.config) throw new Error('CamillaDSP configuration is unavailable');
        const channels = activeOutputs();
        if (!channels.length) throw new Error('No E-Stack output ways are active');

        return channels.map(channel => {
            const entry = gainEntryForChannel(channel);
            if (!entry) throw new Error(`${EStackControlChannels[channel]?.name || `OUT ${channel + 1}`}: no Gain filter found`);
            const [filterName, filter] = entry;
            const gain = Number(filter?.parameters?.gain);
            if (!Number.isFinite(gain)) throw new Error(`${EStackControlChannels[channel]?.name || `OUT ${channel + 1}`}: invalid Gain value`);
            return {
                channel,
                name: EStackControlChannels[channel]?.name || `OUT ${channel + 1}`,
                filterName,
                filter,
                gain
            };
        });
    }

    function normalizationPlan(entries) {
        const highest = Math.max(...entries.map(entry => entry.gain));
        const shiftDb = roundDb(-highest);
        return {
            highest,
            shiftDb,
            entries: entries.map(entry => ({
                ...entry,
                target: roundDb(entry.gain + shiftDb)
            }))
        };
    }

    function formatSigned(value) {
        const n = Number(value);
        return `${n > 0 ? '+' : ''}${n.toFixed(1)} dB`;
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

    function ensureButton() {
        let button = document.getElementById('normalizeWayGains');
        if (button) return button;
        const actions = document.querySelector('.estack-control-actions');
        if (!actions) return null;

        const wrap = document.createElement('div');
        wrap.className = 'estack-normalize-wrap';
        wrap.innerHTML = `
            <button id="normalizeWayGains" class="estack-normalize-button" type="button">
                <span>MAX WAY → 0 dB</span>
                <small id="normalizeWayShift">—</small>
            </button>`;
        actions.insertBefore(wrap, actions.firstChild);
        button = wrap.querySelector('button');
        button.addEventListener('click', normalizeWays);
        return button;
    }

    function syncFader(channel, gain) {
        const control = faderControls.get(Number(channel));
        if (!control) return;
        control.fader.value = String(gain);
        control.valueBox.textContent = `${Number(gain).toFixed(1)} dB`;
        if (typeof window.estackSyncControlFaderVisual === 'function') {
            window.estackSyncControlFaderVisual(control.fader);
        }
    }

    async function refreshButton() {
        const button = ensureButton();
        const shift = document.getElementById('normalizeWayShift');
        if (!button || !shift || busy || !DSP?.connected || !DSP?.config) return;

        try {
            const entries = wayEntriesFromConfig();
            const plan = normalizationPlan(entries);
            if (Math.abs(plan.shiftDb) <= EPSILON_DB) {
                shift.textContent = 'ALREADY NORMALIZED';
                button.dataset.state = 'normalized';
            } else {
                shift.textContent = `ALL ${formatSigned(plan.shiftDb)}`;
                button.dataset.state = plan.shiftDb > 0 ? 'raise' : 'trim';
            }
            button.title = `Apply ${formatSigned(plan.shiftDb)} to every E-Stack way. Relative level differences stay unchanged. MASTER is not changed.`;
        } catch (error) {
            shift.textContent = 'UNAVAILABLE';
            button.dataset.state = 'error';
            button.title = error.message;
        }
    }

    async function normalizeWays() {
        if (busy) return;
        const button = ensureButton();
        if (!button) return;

        busy = true;
        button.disabled = true;
        const shiftLabel = document.getElementById('normalizeWayShift');
        try {
            if (await measurementBatchActive()) {
                throw new Error('Finish or abort Measurement Batch before normalizing output gains');
            }

            await DSP.downloadConfig();
            if (signalGeneratorActive()) {
                throw new Error('Stop Signal Generator before normalizing output gains');
            }

            const entries = wayEntriesFromConfig();
            const plan = normalizationPlan(entries);
            if (Math.abs(plan.shiftDb) <= EPSILON_DB) {
                setMixerStatus('Output ways already normalized · highest way = 0.0 dB', 'ok');
                return;
            }

            const preview = plan.entries
                .map(entry => `${entry.name}: ${entry.gain.toFixed(1)} → ${entry.target.toFixed(1)} dB`)
                .join('\n');
            const direction = plan.shiftDb > 0 ? 'raise' : 'shift';
            const accepted = window.confirm(
                `Normalize E-Stack ways?\n\n` +
                `This will ${direction} EVERY output way by ${formatSigned(plan.shiftDb)} so the highest way becomes 0.0 dB.\n` +
                `Relative differences are preserved exactly. MASTER is unchanged.\n\n${preview}`
            );
            if (!accepted) return;

            const structureBefore = protectedFingerprint(DSP.config);
            const originalMaster = Number(await DSP.sendDSPMessage('GetVolume'));
            const safeMaster = Number.isFinite(originalMaster) ? Math.min(originalMaster, SAFE_TRANSITION_DB) : SAFE_TRANSITION_DB;

            if (Number.isFinite(originalMaster)) {
                await DSP.sendDSPMessage({ SetVolume: safeMaster });
            }

            let masterRestored = false;
            try {
                for (const item of plan.entries) {
                    const live = DSP.config?.filters?.[item.filterName];
                    if (!live || live.type !== 'Gain') throw new Error(`${item.name}: Gain filter disappeared before apply`);
                    live.parameters = live.parameters || {};
                    live.parameters.gain = item.target;
                }

                const ok = await DSP.uploadConfig();
                if (!ok) throw new Error('CamillaDSP rejected normalized gains');
                await DSP.downloadConfig();

                if (protectedFingerprint(DSP.config) !== structureBefore) {
                    throw new Error('Protected DSP structure changed during normalization');
                }

                const verified = wayEntriesFromConfig();
                const verifiedHighest = Math.max(...verified.map(entry => entry.gain));
                if (Math.abs(verifiedHighest) > 0.01) {
                    throw new Error(`Normalization verification failed: highest way is ${verifiedHighest.toFixed(3)} dB`);
                }

                for (const before of entries) {
                    const after = verified.find(item => item.channel === before.channel);
                    if (!after) throw new Error(`${before.name}: verification channel missing`);
                    const actualShift = after.gain - before.gain;
                    if (Math.abs(actualShift - plan.shiftDb) > 0.01) {
                        throw new Error(`${before.name}: relative gain shift was not preserved`);
                    }
                }

                if (Number.isFinite(originalMaster)) {
                    await DSP.sendDSPMessage({ SetVolume: originalMaster });
                    masterRestored = true;
                }

                for (const entry of verified) syncFader(entry.channel, entry.gain);
                setMixerStatus(`Ways normalized · ${formatSigned(plan.shiftDb)} all · highest = 0.0 dB · relative balance preserved`, 'ok');
            } finally {
                if (!masterRestored && Number.isFinite(originalMaster)) {
                    try { await DSP.sendDSPMessage({ SetVolume: originalMaster }); } catch (_) {}
                }
            }
        } catch (error) {
            console.error('Normalize ways failed', error);
            setMixerStatus(`Normalize ways failed: ${error?.message || error}`, 'error');
        } finally {
            busy = false;
            button.disabled = false;
            if (shiftLabel && shiftLabel.textContent === '—') shiftLabel.textContent = 'READY';
            await refreshButton();
        }
    }

    function startRefresh() {
        ensureButton();
        let attempts = 0;
        const wait = async () => {
            attempts += 1;
            if (DSP?.connected && faderControls?.size) {
                await refreshButton();
                if (refreshTimer) clearInterval(refreshTimer);
                refreshTimer = setInterval(() => {
                    if (!busy) refreshButton();
                }, 2000);
                return;
            }
            if (attempts < 50) setTimeout(wait, 100);
        };
        wait();
    }

    window.estackNormalizeWayGains = normalizeWays;

    window.addEventListener('beforeunload', () => {
        if (refreshTimer) clearInterval(refreshTimer);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startRefresh, { once: true });
    } else {
        startRefresh();
    }
})();
