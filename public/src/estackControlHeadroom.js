'use strict';

// E-Stack Control — live per-way protection and hard-limit headroom.
//
// The existing Control meters already display CamillaDSP playback peaks. This
// module reuses those values (no second DSP polling loop) and compares a rolling
// 4-second peak hold against each way's active Compressor protection threshold
// and final Limiter clip_limit.
//
// PROTECT = margin before the HP protection compressor starts. Once crossed,
//           the UI explicitly reports ACTIVE and the amount into compression.
// HARD    = remaining dB before the final hard-limiter ceiling.
// HARD PROXIMITY = operator-oriented proximity over the last 12 dB before the
//                  final hard limit. It reaches 100% only at the hard ceiling.
// EST V = an estimated output voltage derived from the calibrated hard-limit
//         voltage for each way and digital margin. It is not a live voltmeter,
//         watts estimate or thermal loudspeaker-power estimate.

(() => {
    const HOLD_MS = 4000;
    const SAMPLE_MS = 120;
    const NO_SIGNAL_DBFS = -90;
    const DISPLAY_CAP_DB = 40;
    const NEAR_LIMIT_DB = 12;

    // Current E-Stack protection calibration. These are the physical voltages
    // represented by each way's active hard limiter and must be kept aligned
    // with the loudspeaker protection setup if that calibration changes.
    const CALIBRATED_LIMIT_VRMS = Object.freeze({
        0: 50.0,   // SUB
        1: 34.64,  // KICK
        2: 25.30,  // MID L
        3: 25.30,  // MID R
        4: 11.50,  // HIGH L
        5: 11.50   // HIGH R
    });

    const histories = new Map();
    let timer = null;
    let lastControlSignature = '';

    function finite(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function fmtMargin(value, clampAtZero = false) {
        const nRaw = Number(value);
        if (!Number.isFinite(nRaw)) return '—';
        const n = clampAtZero ? Math.max(0, nRaw) : nRaw;
        if (n > DISPLAY_CAP_DB) return `>${DISPLAY_CAP_DB}`;
        return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
    }

    function fmtProtection(marginDb) {
        const margin = Number(marginDb);
        if (!Number.isFinite(margin)) return '—';
        if (margin > 0) return `${fmtMargin(margin)} dB`;
        const into = Math.max(0, -margin);
        return into < 0.05 ? 'ACTIVE' : `ACTIVE +${into.toFixed(1)}`;
    }

    function hardProximityPercent(marginDb) {
        const margin = Number(marginDb);
        if (!Number.isFinite(margin)) return null;
        if (margin <= 0) return 100;
        if (margin >= NEAR_LIMIT_DB) return 0;
        return Math.max(0, Math.min(100, 100 * (1 - margin / NEAR_LIMIT_DB)));
    }

    function fmtPercent(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '—';
        if (n > 0 && n < 0.1) return '<0.1%';
        if (n < 10) return `${n.toFixed(1)}%`;
        return `${Math.round(n)}%`;
    }

    function estimatedVrms(channel, hardMarginDb) {
        const limit = finite(CALIBRATED_LIMIT_VRMS[Number(channel)]);
        const margin = finite(hardMarginDb);
        if (limit === null || margin === null) return null;
        const belowLimit = Math.max(0, margin);
        return Math.min(limit, limit * Math.pow(10, -belowLimit / 20));
    }

    function stateFor(protectionMargin, hardMargin) {
        if (Number.isFinite(hardMargin) && hardMargin <= 0.10) return 'hard';
        if (Number.isFinite(protectionMargin) && protectionMargin <= 0) return 'limiting';
        if (Number.isFinite(hardMargin) && hardMargin <= 1.0) return 'critical';
        if (Number.isFinite(hardMargin) && hardMargin <= 3.0) return 'low';
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
                <span>SYSTEM STATUS</span>
                <strong id="estackSystemStatus">WAITING</strong>
            </div>
            <div class="estack-headroom-margin">
                <span>HARD LIMIT MARGIN</span>
                <strong id="estackSystemHeadroom">—</strong>
            </div>
            <div class="estack-headroom-load">
                <span>HARD PROXIMITY</span>
                <div class="estack-headroom-load-bar"><i id="estackSystemLoadBar"></i></div>
                <strong id="estackSystemLoad">—</strong>
            </div>
            <div class="estack-headroom-limiter">
                <span>LIMITING WAY</span>
                <strong id="estackLimitingWay">—</strong>
            </div>
            <div class="estack-headroom-legend">
                PROTECT = compressor onset · HARD = final limiter · EST V = calibrated estimate · 4 s peak hold
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
                <span>PROTECT <strong data-role="protect">—</strong></span>
                <span>HARD <strong data-role="hard">—</strong></span>
            </div>
            <div class="estack-way-headroom-bar"><i></i></div>
            <div class="estack-way-voltage" data-role="voltage">EST V —</div>`;
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
        const protect = root.querySelector('[data-role="protect"]');
        const hard = root.querySelector('[data-role="hard"]');
        const voltage = root.querySelector('[data-role="voltage"]');
        const bar = root.querySelector('.estack-way-headroom-bar i');

        if (data.muted) {
            root.dataset.state = 'muted';
            protect.textContent = 'MUTED';
            hard.textContent = '—';
            voltage.textContent = 'EST V —';
            bar.style.width = '0%';
            root.title = `${data.name} is muted and does not constrain system hard-limit margin.`;
            return;
        }

        if (!data.limitAvailable) {
            root.dataset.state = 'error';
            protect.textContent = 'NO LIMIT';
            hard.textContent = '—';
            voltage.textContent = 'EST V —';
            bar.style.width = '0%';
            root.title = `${data.name}: no active hard limiter was found. Headroom cannot be trusted.`;
            return;
        }

        if (!data.signal) {
            root.dataset.state = 'idle';
            protect.textContent = '—';
            hard.textContent = '—';
            voltage.textContent = data.limitVrms ? `LIMIT ${data.limitVrms.toFixed(1)} V` : 'EST V —';
            bar.style.width = '0%';
            root.title = `${data.name}: waiting for programme signal. Protection ${data.protectionThreshold.toFixed(1)} dBFS, hard limit ${data.hardThreshold.toFixed(1)} dBFS.`;
            return;
        }

        root.dataset.state = data.state;
        protect.textContent = fmtProtection(data.protectionMargin);
        hard.textContent = `${fmtMargin(data.hardMargin, true)} dB`;
        const proximity = hardProximityPercent(data.hardMargin);
        bar.style.width = `${proximity}%`;

        if (Number.isFinite(data.estimatedVrms) && Number.isFinite(data.limitVrms)) {
            const pct = Math.min(100, 100 * data.estimatedVrms / data.limitVrms);
            voltage.textContent = `EST ${data.estimatedVrms.toFixed(1)} / ${data.limitVrms.toFixed(1)} V · ${Math.round(pct)}%`;
        } else {
            voltage.textContent = 'EST V —';
        }

        root.title = `${data.name} · 4 s held peak ${data.peak.toFixed(1)} dBFS · protection ${data.protectionThreshold.toFixed(1)} dBFS · hard ${data.hardThreshold.toFixed(1)} dBFS · hard margin ${Math.max(0, data.hardMargin).toFixed(1)} dB · hard proximity ${fmtPercent(proximity)}. EST V is derived from the calibrated limiter voltage, not a live voltage measurement.`;
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
        const protectionThresholdDb = protection?.threshold ?? hardThreshold;
        const limitAvailable = Number.isFinite(hardThreshold) && Number.isFinite(protectionThresholdDb);
        const protectionMargin = limitAvailable && signal ? protectionThresholdDb - peak : null;
        const hardMargin = limitAvailable && signal ? hardThreshold - peak : null;
        const limitVrms = finite(CALIBRATED_LIMIT_VRMS[Number(channel)]);
        const estimated = limitAvailable && signal ? estimatedVrms(channel, hardMargin) : null;
        return {
            channel,
            name,
            peak,
            signal,
            muted,
            limitAvailable,
            protectionThreshold: protectionThresholdDb,
            hardThreshold,
            protectionMargin,
            hardMargin,
            limitVrms,
            estimatedVrms: estimated,
            state: limitAvailable && signal ? stateFor(protectionMargin, hardMargin) : 'idle'
        };
    }

    function renderSystem(items) {
        const root = ensureSummary();
        if (!root) return;
        const status = root.querySelector('#estackSystemStatus');
        const value = root.querySelector('#estackSystemHeadroom');
        const loadValue = root.querySelector('#estackSystemLoad');
        const loadBar = root.querySelector('#estackSystemLoadBar');
        const limiting = root.querySelector('#estackLimitingWay');

        const candidates = items.filter(item => !item.muted && item.limitAvailable && item.signal && Number.isFinite(item.hardMargin));
        if (!candidates.length) {
            root.dataset.state = 'idle';
            status.textContent = 'WAITING';
            value.textContent = '—';
            loadValue.textContent = '—';
            loadBar.style.width = '0%';
            limiting.textContent = 'PLAY SIGNAL';
            return;
        }

        candidates.sort((a, b) => a.hardMargin - b.hardMargin);
        const first = candidates[0];
        const systemProximity = hardProximityPercent(first.hardMargin);
        root.dataset.state = first.state;
        value.textContent = `${fmtMargin(first.hardMargin, true)} dB`;
        loadValue.textContent = fmtPercent(systemProximity);
        loadBar.style.width = `${systemProximity}%`;
        limiting.textContent = first.name;

        if (first.state === 'hard') status.textContent = 'HARD LIMIT';
        else if (first.protectionMargin <= 0) status.textContent = 'PROTECTION ACTIVE';
        else if (first.hardMargin <= 1.0) status.textContent = 'NEAR HARD LIMIT';
        else if (first.hardMargin <= 3.0) status.textContent = 'LOW MARGIN';
        else status.textContent = 'NORMAL';

        const voltageText = Number.isFinite(first.estimatedVrms) && Number.isFinite(first.limitVrms)
            ? ` Estimated ${first.estimatedVrms.toFixed(1)} / ${first.limitVrms.toFixed(1)} Vrms.`
            : '';
        const protectionText = first.protectionMargin <= 0
            ? ` Protection compressor is active by about ${Math.max(0, -first.protectionMargin).toFixed(1)} dB.`
            : ` Protection compressor starts in ${first.protectionMargin.toFixed(1)} dB.`;
        root.title = `${first.name} is closest to its final hard limiter with ${Math.max(0, first.hardMargin).toFixed(1)} dB remaining.${protectionText}${voltageText} Hard proximity maps the final ${NEAR_LIMIT_DB} dB before the hard ceiling. Peak hold: ${HOLD_MS / 1000} s.`;
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
                const status = root.querySelector('#estackSystemStatus');
                const value = root.querySelector('#estackSystemHeadroom');
                const loadValue = root.querySelector('#estackSystemLoad');
                const loadBar = root.querySelector('#estackSystemLoadBar');
                const limiting = root.querySelector('#estackLimitingWay');
                if (status) status.textContent = 'ERROR';
                if (value) value.textContent = '—';
                if (loadValue) loadValue.textContent = '—';
                if (loadBar) loadBar.style.width = '0%';
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
