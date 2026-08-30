'use strict';

// E-Stack Control — live per-way protection headroom.
//
// The existing Control meters already display CamillaDSP playback peaks. This
// module reuses those values (no second DSP polling loop) and compares a rolling
// 4-second peak hold against each way's active Compressor protection threshold
// and final Limiter clip_limit.
//
// SAFE = additional dB before the HP protection compressor starts working.
// HARD = additional dB before the final hard limiter ceiling.
// The smallest SAFE value is the useful system/master headroom for the current
// programme material. This is peak headroom, not thermal/RMS loudspeaker watts.

(() => {
    const HOLD_MS = 4000;
    const SAMPLE_MS = 120;
    const NO_SIGNAL_DBFS = -90;
    const DISPLAY_CAP_DB = 40;
    const histories = new Map();
    let timer = null;
    let lastControlSignature = '';

    function finite(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function fmtMargin(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '—';
        if (n > DISPLAY_CAP_DB) return `>${DISPLAY_CAP_DB}`;
        return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
    }

    function stateFor(safeMargin, hardMargin) {
        if (Number.isFinite(hardMargin) && hardMargin <= 0.10) return 'hard';
        if (Number.isFinite(safeMargin) && safeMargin <= 0.15) return 'limiting';
        if (Number.isFinite(safeMargin) && safeMargin <= 1.0) return 'critical';
        if (Number.isFinite(safeMargin) && safeMargin <= 3.0) return 'low';
        return 'ok';
    }

    function controlSignature() {
        const values = [];
        const master = document.getElementById('masterVolume');
        values.push(master?.value ?? '');
        for (let channel = 0; channel <= 5; channel += 1) {
            const fader = document.getElementById(`outputGain${channel}`);
            values.push(fader?.value ?? '');
        }
        return values.join('|');
    }

    function resetHoldIfControlsChanged() {
        const signature = controlSignature();
        if (!signature || signature === lastControlSignature) return;
        histories.clear();
        lastControlSignature = signature;
    }

    function meterPeak(channel) {
        const parts = meterStrips?.get?.(Number(channel));
        const text = parts?.meterValue?.textContent || '';
        const match = String(text).match(/[+-]?\d+(?:\.\d+)?/);
        return match ? finite(match[0]) : null;
    }

    function rememberPeak(channel, db, now) {
        if (!Number.isFinite(db)) return null;
        let history = histories.get(channel);
        if (!history) {
            history = [];
            histories.set(channel, history);
        }
        history.push({ t: now, db });
        const cutoff = now - HOLD_MS;
        while (history.length && history[0].t < cutoff) history.shift();
        let held = -Infinity;
        for (const item of history) held = Math.max(held, item.db);
        return Number.isFinite(held) ? held : db;
    }

    function activeProcessorNames() {
        const set = new Set();
        for (const step of DSP?.config?.pipeline || []) {
            if (step?.type === 'Processor' && step?.name) set.add(String(step.name));
        }
        return set;
    }

    function protectionThreshold(channel) {
        const active = activeProcessorNames();
        const thresholds = [];
        for (const [name, processor] of Object.entries(DSP?.config?.processors || {})) {
            if (!active.has(name) || processor?.type !== 'Compressor') continue;
            const p = processor.parameters || {};
            const processChannels = Array.isArray(p.process_channels) ? p.process_channels.map(Number) : [];
            if (!processChannels.includes(Number(channel))) continue;
            const threshold = finite(p.threshold);
            if (threshold !== null) thresholds.push({ name, threshold });
        }
        if (!thresholds.length) return null;
        // The earliest protection threshold is the most restrictive one. In
        // dBFS this is the lowest (most negative) threshold.
        return thresholds.sort((a, b) => a.threshold - b.threshold)[0];
    }

    function hardLimit(channel) {
        const limits = [];
        const names = typeof DSP?.getChannelFiltersList === 'function'
            ? DSP.getChannelFiltersList(Number(channel))
            : [];
        for (const name of names || []) {
            const filter = DSP?.config?.filters?.[name];
            if (filter?.type !== 'Limiter') continue;
            const clip = finite(filter?.parameters?.clip_limit);
            if (clip !== null) limits.push({ name, clip });
        }
        if (!limits.length) return null;
        // The most restrictive final limiter is the lowest ceiling.
        return limits.sort((a, b) => a.clip - b.clip)[0];
    }

    function channelMuted(channel) {
        const entry = typeof gainEntryForChannel === 'function' ? gainEntryForChannel(Number(channel)) : null;
        return !!entry?.[1]?.parameters?.mute;
    }

    function ensureSummary() {
        let root = document.getElementById('estackHeadroomSummary');
        if (root) return root;
        const strips = document.getElementById('estackMixerStrips');
        if (!strips) return null;
        root = document.createElement('div');
        root.id = 'estackHeadroomSummary';
        root.className = 'estack-headroom-summary';
        root.innerHTML = `
            <div class="estack-headroom-system">
                <span>SYSTEM HEADROOM</span>
                <strong id="estackSystemHeadroom">—</strong>
            </div>
            <div class="estack-headroom-limiter">
                <span>LIMITING WAY</span>
                <strong id="estackLimitingWay">WAITING</strong>
            </div>
            <div class="estack-headroom-legend">
                SAFE = HP protection onset · HARD = final limiter · 4 s peak hold
            </div>`;
        strips.insertAdjacentElement('beforebegin', root);
        return root;
    }

    function ensureWayReadout(channel) {
        const control = faderControls?.get?.(Number(channel));
        const strip = control?.strip;
        if (!strip) return null;
        let root = strip.querySelector('.estack-way-headroom');
        if (root) return root;
        root = document.createElement('div');
        root.className = 'estack-way-headroom';
        root.dataset.channel = String(channel);
        root.innerHTML = `
            <div class="estack-way-headroom-values">
                <span>SAFE <strong data-role="safe">—</strong></span>
                <span>HARD <strong data-role="hard">—</strong></span>
            </div>
            <div class="estack-way-headroom-bar"><i></i></div>`;
        const head = strip.querySelector('.estack-strip-head');
        head?.insertAdjacentElement('afterend', root);
        return root;
    }

    function ensureAllReadouts() {
        ensureSummary();
        for (const channel of activeOutputs?.() || []) ensureWayReadout(channel);
    }

    function renderWay(channel, data) {
        const root = ensureWayReadout(channel);
        if (!root) return;
        const safe = root.querySelector('[data-role="safe"]');
        const hard = root.querySelector('[data-role="hard"]');
        const bar = root.querySelector('.estack-way-headroom-bar i');

        if (data.muted) {
            root.dataset.state = 'muted';
            safe.textContent = 'MUTED';
            hard.textContent = '—';
            bar.style.width = '0%';
            root.title = `${data.name} is muted and does not constrain system headroom.`;
            return;
        }

        if (!data.limitAvailable) {
            root.dataset.state = 'error';
            safe.textContent = 'NO LIMIT';
            hard.textContent = '—';
            bar.style.width = '0%';
            root.title = `${data.name}: no active hard limiter was found. Headroom cannot be trusted.`;
            return;
        }

        if (!data.signal) {
            root.dataset.state = 'idle';
            safe.textContent = '—';
            hard.textContent = '—';
            bar.style.width = '0%';
            root.title = `${data.name}: waiting for programme signal. Protection ${data.safeThreshold.toFixed(1)} dBFS, hard limit ${data.hardThreshold.toFixed(1)} dBFS.`;
            return;
        }

        root.dataset.state = data.state;
        safe.textContent = `${fmtMargin(data.safeMargin)} dB`;
        hard.textContent = `${fmtMargin(data.hardMargin)} dB`;
        const normalized = Math.max(0, Math.min(1, data.safeMargin / 12));
        bar.style.width = `${normalized * 100}%`;
        const powerRatio = Math.pow(10, Math.max(0, data.safeMargin) / 10);
        root.title = `${data.name} · held peak ${data.peak.toFixed(1)} dBFS · protection ${data.safeThreshold.toFixed(1)} dBFS · hard ${data.hardThreshold.toFixed(1)} dBFS · about ${powerRatio.toFixed(1)}× peak-equivalent power increase to protection (not RMS/thermal watts).`;
    }

    function channelData(channel, now) {
        const name = EStackControlChannels?.[channel]?.name || `OUT ${channel + 1}`;
        const peakNow = meterPeak(channel);
        const peak = rememberPeak(channel, peakNow, now);
        const hard = hardLimit(channel);
        const protection = protectionThreshold(channel);
        const muted = channelMuted(channel);
        const signal = Number.isFinite(peak) && peak > NO_SIGNAL_DBFS;
        const hardThreshold = hard?.clip ?? null;
        const safeThreshold = protection?.threshold ?? hardThreshold;
        const limitAvailable = Number.isFinite(hardThreshold) && Number.isFinite(safeThreshold);
        const safeMargin = limitAvailable && signal ? safeThreshold - peak : null;
        const hardMargin = limitAvailable && signal ? hardThreshold - peak : null;
        return {
            channel,
            name,
            peak,
            signal,
            muted,
            limitAvailable,
            safeThreshold,
            hardThreshold,
            safeMargin,
            hardMargin,
            state: limitAvailable && signal ? stateFor(safeMargin, hardMargin) : 'idle'
        };
    }

    function renderSystem(items) {
        const root = ensureSummary();
        if (!root) return;
        const value = root.querySelector('#estackSystemHeadroom');
        const limiting = root.querySelector('#estackLimitingWay');

        const candidates = items.filter(item => !item.muted && item.limitAvailable && item.signal && Number.isFinite(item.safeMargin));
        if (!candidates.length) {
            root.dataset.state = 'idle';
            value.textContent = '—';
            limiting.textContent = 'PLAY SIGNAL';
            return;
        }

        candidates.sort((a, b) => a.safeMargin - b.safeMargin);
        const first = candidates[0];
        root.dataset.state = first.state;
        value.textContent = `${fmtMargin(first.safeMargin)} dB`;
        if (first.state === 'hard') limiting.textContent = `${first.name} · HARD LIMIT`;
        else if (first.safeMargin <= 0.15) limiting.textContent = `${first.name} · PROTECTION`;
        else limiting.textContent = `${first.name} FIRST`;
        root.title = `Approximate additional MASTER gain before ${first.name} reaches its protection threshold, based on the highest playback peak seen in the last ${HOLD_MS / 1000} seconds.`;
    }

    function tick() {
        try {
            if (!DSP?.connected || !faderControls?.size) return;
            ensureAllReadouts();
            resetHoldIfControlsChanged();
            const now = Date.now();
            const items = [];
            for (const channel of activeOutputs()) {
                const data = channelData(channel, now);
                items.push(data);
                renderWay(channel, data);
            }
            renderSystem(items);
        } catch (error) {
            const root = ensureSummary();
            if (root) {
                root.dataset.state = 'error';
                const value = root.querySelector('#estackSystemHeadroom');
                const limiting = root.querySelector('#estackLimitingWay');
                if (value) value.textContent = 'ERROR';
                if (limiting) limiting.textContent = error?.message || String(error);
            }
        }
    }

    function start() {
        let attempts = 0;
        const wait = () => {
            attempts += 1;
            if (typeof DSP !== 'undefined' && DSP?.connected && faderControls?.size) {
                ensureAllReadouts();
                lastControlSignature = controlSignature();
                tick();
                if (timer) clearInterval(timer);
                timer = setInterval(tick, SAMPLE_MS);
                return;
            }
            if (attempts < 80) setTimeout(wait, 100);
        };
        wait();
    }

    window.estackResetHeadroomHold = () => {
        histories.clear();
        lastControlSignature = controlSignature();
        tick();
    };

    window.addEventListener('beforeunload', () => {
        if (timer) clearInterval(timer);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
