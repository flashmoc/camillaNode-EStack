const MEASURE_WAYS = [
    { key: 'SUB', label: 'SUB', out: 1 },
    { key: 'KICK', label: 'KICK', out: 2 },
    { key: 'MID_L', label: 'MID L', out: 3 },
    { key: 'MID_R', label: 'MID R', out: 4 },
    { key: 'HIGH_L', label: 'HIGH L', out: 5 },
    { key: 'HIGH_R', label: 'HIGH R', out: 6 }
];

let measureState = { phase: 'empty', active: false, batch: null, sequence: [] };
let measureBusy = false;
let measureTimer = null;

function setMeasureStatus(message, state = 'info') {
    const el = document.getElementById('measurePageStatus');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.state = state;
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `${response.status} ${response.statusText}`);
    return data;
}

function postJson(url, body = {}) {
    return fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function formatSigned(value, digits = 2, suffix = '') {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    const text = `${number > 0 ? '+' : ''}${number.toFixed(digits)}`;
    return suffix ? `${text} ${suffix}` : text;
}

function formatHz(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    if (number >= 1000) {
        const k = number / 1000;
        return `${Number(k.toFixed(k % 1 ? 2 : 0))} kHz`;
    }
    return `${Number(number.toFixed(number % 1 ? 1 : 0))} Hz`;
}

function effectivePreviewStep() {
    if (measureState.current) return measureState.current;
    return measureState.sequence?.[0] || null;
}

function renderRuntime() {
    const runtime = document.getElementById('measureRuntimeState');
    const phase = measureState.phase || 'empty';
    runtime.dataset.state = phase === 'complete' ? 'ready' : phase;
    const labels = {
        empty: 'NO BATCH',
        ready: 'BATCH READY',
        active: 'MEASUREMENT ACTIVE',
        complete: 'BATCH COMPLETE',
        error: 'BATCH ERROR'
    };
    runtime.innerHTML = `<strong>${labels[phase] || phase.toUpperCase()}</strong>`;
}

function renderBatchHeader() {
    const batch = measureState.batch;
    document.getElementById('batchName').textContent = batch?.name || 'No measurement batch loaded';
    document.getElementById('batchDescription').textContent = batch?.description ||
        'Import a versioned E-Stack batch JSON file. DSP changes are temporary and restored from a live snapshot.';

    const active = !!measureState.active;
    document.getElementById('importBatch').disabled = active || measureBusy;
    document.getElementById('clearBatch').disabled = active || measureBusy || !batch;
}

function renderProgress() {
    const progress = measureState.progress || {};
    const total = Number(progress.total || measureState.batch?.total || 0);
    const completed = Number(progress.completedCount || 0);
    const currentNumber = Number(progress.currentNumber || 0);
    const label = measureState.active ? `${currentNumber} / ${total}` : total ? `${completed} / ${total}` : '0 / 0';
    document.getElementById('batchProgressLabel').textContent = label;

    let text = 'Waiting for a batch';
    if (measureState.phase === 'ready' && total) text = `${total} measurements ready to run`;
    if (measureState.active && measureState.current) text = measureState.current.summary;
    if (measureState.phase === 'complete') text = 'Batch complete · normal DSP processing restored';
    document.getElementById('batchProgressText').textContent = text;

    const fraction = total ? Math.max(0, Math.min(1, completed / total)) : 0;
    document.getElementById('batchProgressBar').style.width = `${fraction * 100}%`;
}

function renderWays(step) {
    const root = document.getElementById('measurementWays');
    root.replaceChildren();
    const active = new Set(step?.activeWays || []);
    for (const way of MEASURE_WAYS) {
        const item = document.createElement('div');
        item.className = 'measure-way';
        item.classList.toggle('active', active.has(way.key));
        item.innerHTML = `<strong>${way.label}</strong><span>${active.has(way.key) ? `ACTIVE · OUT ${way.out}` : `MUTED · OUT ${way.out}`}</span>`;
        root.appendChild(item);
    }
}

function crossoverText(spec, side) {
    if (!spec) return null;
    const parts = [];
    if (spec.freqHz != null) parts.push(formatHz(spec.freqHz));
    if (spec.family) parts.push(spec.family === 'LinkwitzRiley' ? 'LR' : 'BW');
    if (spec.order != null) parts.push(`order ${spec.order}`);
    return `${side.toUpperCase()} ${parts.join(' · ')}`;
}

function phaseText(phase) {
    if (!phase) return null;
    const degrees = Number(phase.degrees);
    if (!Number.isFinite(degrees)) return null;
    let reference = 'AUTO XO';
    if (phase.referenceHz != null) reference = formatHz(phase.referenceHz);
    else if (phase.reference === 'hpf') reference = 'HPF';
    else if (phase.reference === 'lpf') reference = 'LPF';
    return `phase ${degrees.toFixed(1)}° @ ${reference}`;
}

function renderDeltas(step) {
    const root = document.getElementById('measurementOverrides');
    root.replaceChildren();
    const rows = [];

    for (const [way, override] of Object.entries(step?.ways || {})) {
        const parts = [];
        if (override.delayMs != null) parts.push(`delay ${Number(override.delayMs).toFixed(2)} ms`);
        if (override.delayOffsetMs != null) parts.push(`delay Δ ${formatSigned(override.delayOffsetMs, 2, 'ms')}`);
        if (override.polarity) parts.push(`polarity ${override.polarity.toUpperCase()}`);
        if (override.gainOffsetDb != null) parts.push(`gain Δ ${formatSigned(override.gainOffsetDb, 1, 'dB')}`);
        const phase = phaseText(override.phase);
        if (phase) parts.push(phase);
        if (parts.length) rows.push({ label: way.replace('_', ' '), text: parts.join(' · ') });
    }

    for (const [way, crossover] of Object.entries(step?.crossovers || {})) {
        const parts = [crossoverText(crossover.hpf, 'HPF'), crossoverText(crossover.lpf, 'LPF')].filter(Boolean);
        if (parts.length) rows.push({ label: way.replace('_', ' '), text: parts.join(' · ') });
    }

    const disabled = step?.disabledFilters || [];
    if (disabled.length) rows.push({ label: 'FILTERS OFF', text: disabled.join(' · ') });

    if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'measure-delta-empty';
        empty.textContent = 'No per-step override · active ways use the captured session baseline.';
        root.appendChild(empty);
        return;
    }

    for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'measure-delta-row';
        item.innerHTML = `<strong>${row.label}</strong><span>${row.text}</span>`;
        root.appendChild(item);
    }
}

function renderRew(step) {
    const rew = step?.rew || {};
    document.getElementById('rewName').textContent = rew.measurementName || '—';
    document.getElementById('rewSweep').textContent = rew.startHz != null && rew.endHz != null
        ? `${formatHz(rew.startHz)} → ${formatHz(rew.endHz)}`
        : 'Use current REW sweep';
    document.getElementById('rewLevel').textContent = rew.levelDbfs != null ? `${Number(rew.levelDbfs).toFixed(1)} dBFS` : 'Current';
    document.getElementById('rewTiming').textContent = rew.timingReference == null ? 'Current' : rew.timingReference ? 'ON' : 'OFF';
    const notes = document.getElementById('rewNotes');
    notes.hidden = !rew.notes;
    notes.textContent = rew.notes || '';
    document.getElementById('copyRewName').disabled = measureBusy || !rew.measurementName;
}

function renderCurrent() {
    const step = effectivePreviewStep();
    const active = !!measureState.active;
    const counter = document.getElementById('measurementCounter');
    const name = document.getElementById('measurementName');
    const instruction = document.getElementById('measurementInstruction');
    const position = document.getElementById('measurementPosition');

    if (!step) {
        counter.textContent = '—';
        name.textContent = 'No active measurement';
        instruction.textContent = 'Start the batch to snapshot the live DSP configuration and prepare measurement 1.';
        position.hidden = true;
        renderWays(null);
        renderDeltas(null);
        renderRew(null);
        return;
    }

    counter.textContent = `${active ? 'READY' : 'PREVIEW'} · ${step.id} · ${step.number}/${step.total}`;
    name.textContent = step.name;
    instruction.textContent = step.instruction || (active
        ? 'DSP state applied and settled. Run the REW sweep, then advance the batch.'
        : 'Start the batch to apply this measurement state.');
    position.hidden = !step.position;
    position.textContent = step.position ? `POSITION · ${step.position}` : '';
    renderWays(step);
    renderDeltas(step);
    renderRew(step);
}

function renderSequence() {
    const root = document.getElementById('measurementSequence');
    root.replaceChildren();
    const sequence = measureState.sequence || [];
    document.getElementById('sequenceCount').textContent = `${sequence.length} measurement${sequence.length === 1 ? '' : 's'}`;
    const currentIndex = Number(measureState.progress?.currentIndex);
    const completed = new Set(measureState.progress?.completed || []);

    for (const step of sequence) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'measure-sequence-item';
        const isCurrent = measureState.active && step.index === currentIndex;
        const isCompleted = completed.has(step.index);
        button.classList.toggle('current', isCurrent);
        button.classList.toggle('completed', isCompleted);
        button.disabled = measureBusy || !measureState.active || isCurrent;
        const state = isCurrent ? 'CURRENT' : isCompleted ? 'DONE' : 'READY';
        const ways = (step.activeWayLabels || []).join(' + ');
        button.innerHTML = `
            <span class="seq-number">${String(step.number).padStart(2, '0')}</span>
            <span class="seq-copy"><strong>${step.name}</strong><span>${ways}${step.rew?.measurementName ? ` · ${step.rew.measurementName}` : ''}</span></span>
            <span class="seq-state">${state}</span>`;
        button.addEventListener('click', () => runAction('/api/measurement-batch/goto', { index: step.index }, `Preparing ${step.id}…`));
        root.appendChild(button);
    }

    if (!sequence.length) {
        const empty = document.createElement('div');
        empty.className = 'measure-delta-empty';
        empty.textContent = 'No measurements loaded.';
        root.appendChild(empty);
    }
}

function renderActions() {
    const active = !!measureState.active;
    const hasBatch = !!measureState.batch;
    const index = Number(measureState.progress?.currentIndex || 0);
    const total = Number(measureState.progress?.total || measureState.batch?.total || 0);

    const previous = document.getElementById('previousMeasurement');
    const retry = document.getElementById('retryMeasurement');
    const next = document.getElementById('nextMeasurement');
    const abort = document.getElementById('abortMeasurement');

    previous.disabled = measureBusy || !active || index <= 0;
    retry.disabled = measureBusy || !active;
    next.disabled = measureBusy || !hasBatch;
    abort.disabled = measureBusy || !active;

    if (!active) next.textContent = 'START BATCH';
    else if (index >= total - 1) next.textContent = 'FINISH & RESTORE';
    else next.textContent = 'NEXT MEASUREMENT';
}

function renderAll() {
    renderRuntime();
    renderBatchHeader();
    renderProgress();
    renderCurrent();
    renderSequence();
    renderActions();
}

async function refreshState({ silent = false } = {}) {
    try {
        measureState = await fetchJson('/api/measurement-batch/status', { cache: 'no-store' });
        renderAll();
        if (!silent && measureState.message) setMeasureStatus(measureState.message, measureState.phase === 'error' ? 'error' : 'info');
    } catch (error) {
        setMeasureStatus(`Measurement Batch unavailable: ${error.message}`, 'error');
    }
}

async function runAction(url, body = {}, busyText = 'Applying measurement state…') {
    if (measureBusy) return;
    measureBusy = true;
    setMeasureStatus(busyText, 'busy');
    renderActions();
    try {
        measureState = await postJson(url, body);
        renderAll();
        setMeasureStatus(measureState.message || 'Ready', measureState.phase === 'complete' ? 'ok' : 'ok');
        if (measureState.phase === 'complete') setTimeout(() => refreshState({ silent: true }), 1800);
    } catch (error) {
        setMeasureStatus(error.message, 'error');
        await refreshState({ silent: true });
    } finally {
        measureBusy = false;
        renderAll();
    }
}

async function importBatchFile(file) {
    if (!file || measureBusy) return;
    measureBusy = true;
    setMeasureStatus(`Importing ${file.name}…`, 'busy');
    renderAll();
    try {
        const text = await file.text();
        const batch = JSON.parse(text);
        measureState = await postJson('/api/measurement-batch/import', { batch });
        renderAll();
        setMeasureStatus(`Imported · ${measureState.batch?.name || file.name} · ${measureState.batch?.total || 0} measurements`, 'ok');
    } catch (error) {
        setMeasureStatus(`IMPORT ERROR: ${error.message}`, 'error');
    } finally {
        measureBusy = false;
        document.getElementById('batchFileInput').value = '';
        renderAll();
    }
}

async function copyRewName() {
    const name = effectivePreviewStep()?.rew?.measurementName;
    if (!name) return;
    try {
        await navigator.clipboard.writeText(name);
        setMeasureStatus(`Copied REW name · ${name}`, 'ok');
    } catch (_) {
        setMeasureStatus(`REW name · ${name}`, 'info');
    }
}

async function initMeasurementBatch() {
    const input = document.getElementById('batchFileInput');
    document.getElementById('importBatch').addEventListener('click', () => input.click());
    input.addEventListener('change', () => importBatchFile(input.files?.[0]));
    document.getElementById('clearBatch').addEventListener('click', () => {
        if (confirm('Clear the imported Measurement Batch?')) runAction('/api/measurement-batch/clear', {}, 'Clearing batch…');
    });
    document.getElementById('previousMeasurement').addEventListener('click', () => runAction('/api/measurement-batch/previous', {}, 'Preparing previous measurement…'));
    document.getElementById('retryMeasurement').addEventListener('click', () => runAction('/api/measurement-batch/retry', {}, 'Re-applying current measurement…'));
    document.getElementById('nextMeasurement').addEventListener('click', () => runAction('/api/measurement-batch/next', {}, measureState.active ? 'Preparing next measurement…' : 'Capturing DSP baseline and starting batch…'));
    document.getElementById('abortMeasurement').addEventListener('click', () => {
        if (confirm('Abort the batch and restore the captured DSP processing?')) runAction('/api/measurement-batch/abort', {}, 'Restoring normal DSP processing…');
    });
    document.getElementById('copyRewName').addEventListener('click', copyRewName);

    await refreshState({ silent: true });
    setMeasureStatus(measureState.message || '', measureState.phase === 'error' ? 'error' : 'info');
    measureTimer = setInterval(() => {
        if (!measureBusy) refreshState({ silent: true });
    }, 2000);
}

window.addEventListener('beforeunload', () => {
    if (measureTimer) clearInterval(measureTimer);
});

document.addEventListener('DOMContentLoaded', initMeasurementBatch);
