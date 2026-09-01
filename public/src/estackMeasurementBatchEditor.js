'use strict';

/* Structured editor for E-Stack Measurement Batch v1.
 * The server remains authoritative: SAVE re-imports the draft through
 * /api/measurement-batch/import, so the exact same normalization/safety model
 * is used for hand-authored JSON and UI-authored batches.
 */

const BATCH_EDITOR_WAYS = [
    ['SUB', 'SUB'],
    ['KICK', 'KICK'],
    ['MID_L', 'MID L'],
    ['MID_R', 'MID R'],
    ['HIGH_L', 'HIGH L'],
    ['HIGH_R', 'HIGH R']
];

let batchEditorDraft = null;
let batchEditorIndex = 0;
let batchEditorBusy = false;

const editorClone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const editorEl = id => document.getElementById(id);

function editorSetStatus(message, state = 'info') {
    const el = editorEl('batchEditorStatus');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.state = state;
}

function editorNumber(value) {
    if (value == null || String(value).trim() === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function editorCsv(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter((item, index, all) => item && all.indexOf(item) === index);
}

function editorBatchFromState() {
    if (!measureState?.batch) return null;
    return {
        schema: 'estack.measurement-batch',
        version: 1,
        name: measureState.batch.name,
        description: measureState.batch.description || '',
        defaults: editorClone(measureState.batch.defaults || {
            muteUnlisted: true,
            settleMs: 500,
            disabledFilters: []
        }),
        steps: (measureState.sequence || []).map(step => ({
            id: step.id,
            name: step.name,
            instruction: step.instruction || '',
            position: step.position || '',
            activeWays: editorClone(step.activeWays || []),
            ways: editorClone(step.ways || {}),
            crossovers: editorClone(step.crossovers || {}),
            disabledFilters: editorClone(step.disabledFilters || []),
            rew: editorClone(step.rew || {})
        }))
    };
}

function editorNewBatch() {
    return {
        schema: 'estack.measurement-batch',
        version: 1,
        name: 'New E-Stack measurement batch',
        description: 'Edit this campaign directly in CamillaNode.',
        defaults: {
            muteUnlisted: true,
            settleMs: 500,
            disabledFilters: []
        },
        steps: [{
            id: 'M01',
            name: 'KICK solo',
            instruction: 'Check the prepared DSP state, then run the REW sweep.',
            position: '',
            activeWays: ['KICK'],
            ways: { KICK: { gainOffsetDb: -15 } },
            crossovers: {},
            disabledFilters: [],
            rew: {
                measurementName: 'M01_KICK_SOLO',
                startHz: 80,
                endHz: 800,
                levelDbfs: -20,
                timingReference: true,
                notes: ''
            }
        }]
    };
}

function editorCurrentStep() {
    return batchEditorDraft?.steps?.[batchEditorIndex] || null;
}

function editorUniqueId(base) {
    const used = new Set((batchEditorDraft?.steps || []).map(step => String(step.id || '').toUpperCase()));
    let candidate = String(base || 'M01').trim() || 'M01';
    let n = 2;
    while (used.has(candidate.toUpperCase())) candidate = `${base}_${n++}`;
    return candidate;
}

function editorNextId() {
    const used = new Set((batchEditorDraft?.steps || []).map(step => String(step.id || '').toUpperCase()));
    for (let n = 1; n <= 999; n += 1) {
        const id = `M${String(n).padStart(2, '0')}`;
        if (!used.has(id)) return id;
    }
    return editorUniqueId('M');
}

function editorFamilyValue(value) {
    if (value === 'LinkwitzRiley') return 'LinkwitzRiley';
    if (value === 'Butterworth') return 'Butterworth';
    return '';
}

function editorFamilyOptions(value) {
    return `
        <option value=""${!value ? ' selected' : ''}>BASE</option>
        <option value="LinkwitzRiley"${value === 'LinkwitzRiley' ? ' selected' : ''}>LR</option>
        <option value="Butterworth"${value === 'Butterworth' ? ' selected' : ''}>BW</option>`;
}

function editorPolarityOptions(value) {
    return `
        <option value=""${!value ? ' selected' : ''}>BASE</option>
        <option value="normal"${value === 'normal' ? ' selected' : ''}>NORMAL</option>
        <option value="inverted"${value === 'inverted' ? ' selected' : ''}>INVERTED</option>`;
}

function editorPhaseRef(phase) {
    if (phase?.referenceHz != null) return 'fixed';
    return phase?.reference || 'auto';
}

function editorPhaseRefOptions(value) {
    return `
        <option value="auto"${value === 'auto' ? ' selected' : ''}>AUTO</option>
        <option value="hpf"${value === 'hpf' ? ' selected' : ''}>HPF</option>
        <option value="lpf"${value === 'lpf' ? ' selected' : ''}>LPF</option>
        <option value="fixed"${value === 'fixed' ? ' selected' : ''}>FIXED</option>`;
}

function editorRenderBatchFields() {
    const batch = batchEditorDraft;
    if (!batch) return;
    editorEl('editorBatchName').value = batch.name || '';
    editorEl('editorBatchDescription').value = batch.description || '';
    editorEl('editorSettleMs').value = batch.defaults?.settleMs ?? 500;
    editorEl('editorMuteUnlisted').value = batch.defaults?.muteUnlisted === false ? 'false' : 'true';
    editorEl('editorBatchDisabled').value = (batch.defaults?.disabledFilters || []).join(', ');
}

function editorRenderStepList() {
    const root = editorEl('editorStepList');
    root.replaceChildren();
    const steps = batchEditorDraft?.steps || [];
    editorEl('editorStepCount').textContent = `${steps.length} step${steps.length === 1 ? '' : 's'}`;

    steps.forEach((step, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'measure-editor-step-item';
        button.classList.toggle('selected', index === batchEditorIndex);
        const ways = (step.activeWays || []).map(key => key.replace('_', ' ')).join(' + ');
        button.innerHTML = `
            <span>${String(index + 1).padStart(2, '0')}</span>
            <span><strong>${step.id || '—'} · ${step.name || 'Unnamed'}</strong><span>${ways || 'No active way'}</span></span>`;
        button.addEventListener('click', () => {
            batchEditorIndex = index;
            editorRenderStepList();
            editorRenderStep();
        });
        root.appendChild(button);
    });
}

function editorRenderActiveWays(step) {
    const root = editorEl('editorActiveWays');
    root.replaceChildren();
    const active = new Set(step.activeWays || []);
    for (const [key, label] of BATCH_EDITOR_WAYS) {
        const item = document.createElement('label');
        item.className = 'measure-editor-way-toggle';
        item.innerHTML = `<input type="checkbox" data-way="${key}" ${active.has(key) ? 'checked' : ''}><span>${label}</span>`;
        item.querySelector('input').addEventListener('change', event => {
            const set = new Set(step.activeWays || []);
            if (event.target.checked) set.add(key); else set.delete(key);
            step.activeWays = BATCH_EDITOR_WAYS.map(([way]) => way).filter(way => set.has(way));
            editorRenderStepList();
        });
        root.appendChild(item);
    }
}

function editorUpdateWayRow(row, step) {
    const way = row.dataset.way;
    const delay = editorNumber(row.querySelector('[data-field="delayMs"]').value);
    const delayOffset = editorNumber(row.querySelector('[data-field="delayOffsetMs"]').value);
    const polarity = row.querySelector('[data-field="polarity"]').value;
    const gain = editorNumber(row.querySelector('[data-field="gainOffsetDb"]').value);
    const phaseDegrees = editorNumber(row.querySelector('[data-field="phaseDegrees"]').value);
    const phaseRef = row.querySelector('[data-field="phaseRef"]').value;
    const phaseHzInput = row.querySelector('[data-field="phaseReferenceHz"]');
    let phaseHz = editorNumber(phaseHzInput.value);

    const override = {};
    if (delay != null) override.delayMs = delay;
    if (delayOffset != null) override.delayOffsetMs = delayOffset;
    if (polarity) override.polarity = polarity;
    if (gain != null) override.gainOffsetDb = gain;
    if (phaseDegrees != null) {
        if (phaseRef === 'fixed') {
            if (phaseHz == null) {
                phaseHz = 300;
                phaseHzInput.value = '300';
            }
            override.phase = { degrees: phaseDegrees, referenceHz: phaseHz };
        } else {
            override.phase = { degrees: phaseDegrees, reference: phaseRef || 'auto' };
        }
    }

    if (Object.keys(override).length) step.ways[way] = override;
    else delete step.ways[way];
}

function editorRenderWayTable(step) {
    const tbody = editorEl('editorWayTable').querySelector('tbody');
    tbody.replaceChildren();

    for (const [way, label] of BATCH_EDITOR_WAYS) {
        const override = step.ways?.[way] || {};
        const phase = override.phase || null;
        const phaseRef = editorPhaseRef(phase);
        const row = document.createElement('tr');
        row.dataset.way = way;
        row.innerHTML = `
            <td>${label}</td>
            <td><input data-field="delayMs" type="number" min="0" max="100" step="0.01" placeholder="BASE" value="${override.delayMs ?? ''}"></td>
            <td><input data-field="delayOffsetMs" type="number" min="-50" max="50" step="0.01" placeholder="0" value="${override.delayOffsetMs ?? ''}"></td>
            <td><select data-field="polarity">${editorPolarityOptions(override.polarity)}</select></td>
            <td><input data-field="gainOffsetDb" type="number" min="-60" max="0" step="0.1" placeholder="0" value="${override.gainOffsetDb ?? ''}"></td>
            <td><input data-field="phaseDegrees" type="number" min="-179" max="0" step="0.1" placeholder="0" value="${phase?.degrees ?? ''}"></td>
            <td><select data-field="phaseRef">${editorPhaseRefOptions(phaseRef)}</select></td>
            <td><input data-field="phaseReferenceHz" type="number" min="5" max="24000" step="1" placeholder="—" value="${phase?.referenceHz ?? ''}" ${phaseRef === 'fixed' ? '' : 'disabled'}></td>`;

        const abs = row.querySelector('[data-field="delayMs"]');
        const off = row.querySelector('[data-field="delayOffsetMs"]');
        abs.addEventListener('input', () => {
            if (abs.value !== '') off.value = '';
            editorUpdateWayRow(row, step);
        });
        off.addEventListener('input', () => {
            if (off.value !== '') abs.value = '';
            editorUpdateWayRow(row, step);
        });
        row.querySelector('[data-field="phaseRef"]').addEventListener('change', event => {
            const hz = row.querySelector('[data-field="phaseReferenceHz"]');
            hz.disabled = event.target.value !== 'fixed';
            editorUpdateWayRow(row, step);
        });
        for (const input of row.querySelectorAll('input, select')) {
            if (input === abs || input === off || input.dataset.field === 'phaseRef') continue;
            input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => editorUpdateWayRow(row, step));
        }
        tbody.appendChild(row);
    }
}

function editorBuildXoSide(row, side) {
    const freq = editorNumber(row.querySelector(`[data-field="${side}Freq"]`).value);
    const family = row.querySelector(`[data-field="${side}Family"]`).value;
    const order = editorNumber(row.querySelector(`[data-field="${side}Order"]`).value);
    const spec = {};
    if (freq != null) spec.freqHz = freq;
    if (family) spec.family = family;
    if (order != null) spec.order = order;
    return Object.keys(spec).length ? spec : null;
}

function editorUpdateXoRow(row, step) {
    const way = row.dataset.way;
    const hpf = editorBuildXoSide(row, 'hpf');
    const lpf = editorBuildXoSide(row, 'lpf');
    const value = {};
    if (hpf) value.hpf = hpf;
    if (lpf) value.lpf = lpf;
    if (Object.keys(value).length) step.crossovers[way] = value;
    else delete step.crossovers[way];
}

function editorRenderXoTable(step) {
    const tbody = editorEl('editorXoTable').querySelector('tbody');
    tbody.replaceChildren();

    for (const [way, label] of BATCH_EDITOR_WAYS) {
        const xo = step.crossovers?.[way] || {};
        const hpf = xo.hpf || {};
        const lpf = xo.lpf || {};
        const row = document.createElement('tr');
        row.dataset.way = way;
        row.innerHTML = `
            <td>${label}</td>
            <td><input data-field="hpfFreq" type="number" min="10" max="24000" step="0.1" placeholder="BASE" value="${hpf.freqHz ?? ''}"></td>
            <td><select data-field="hpfFamily">${editorFamilyOptions(editorFamilyValue(hpf.family))}</select></td>
            <td><input data-field="hpfOrder" type="number" min="2" max="8" step="1" placeholder="BASE" value="${hpf.order ?? ''}"></td>
            <td><input data-field="lpfFreq" type="number" min="10" max="24000" step="0.1" placeholder="BASE" value="${lpf.freqHz ?? ''}"></td>
            <td><select data-field="lpfFamily">${editorFamilyOptions(editorFamilyValue(lpf.family))}</select></td>
            <td><input data-field="lpfOrder" type="number" min="2" max="8" step="1" placeholder="BASE" value="${lpf.order ?? ''}"></td>`;
        for (const input of row.querySelectorAll('input, select')) {
            input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => editorUpdateXoRow(row, step));
        }
        tbody.appendChild(row);
    }
}

function editorRenderStep() {
    const step = editorCurrentStep();
    if (!step) return;
    step.ways = step.ways || {};
    step.crossovers = step.crossovers || {};
    step.rew = step.rew || {};
    step.activeWays = step.activeWays || [];
    step.disabledFilters = step.disabledFilters || [];

    editorEl('editorStepPosition').textContent = `${batchEditorIndex + 1} / ${batchEditorDraft.steps.length}`;
    editorEl('editorStepId').value = step.id || '';
    editorEl('editorStepName').value = step.name || '';
    editorEl('editorInstruction').value = step.instruction || '';
    editorEl('editorPosition').value = step.position || '';
    editorEl('editorDisabledFilters').value = (step.disabledFilters || []).join(', ');

    editorRenderActiveWays(step);
    editorRenderWayTable(step);
    editorRenderXoTable(step);

    editorEl('editorRewName').value = step.rew.measurementName || '';
    editorEl('editorRewStart').value = step.rew.startHz ?? '';
    editorEl('editorRewEnd').value = step.rew.endHz ?? '';
    editorEl('editorRewLevel').value = step.rew.levelDbfs ?? '';
    editorEl('editorRewTiming').value = step.rew.timingReference == null ? '' : String(!!step.rew.timingReference);
    editorEl('editorRewNotes').value = step.rew.notes || '';
}

function editorRenderAll() {
    editorRenderBatchFields();
    editorRenderStepList();
    editorRenderStep();
}

function editorDownload(batch) {
    if (!batch) {
        setMeasureStatus('No Measurement Batch to export', 'error');
        return;
    }
    const safeName = String(batch.name || 'EStack_Measurement_Batch')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/^_+|_+$/g, '') || 'EStack_Measurement_Batch';
    const blob = new Blob([`${JSON.stringify(batch, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function editorValidateDraft(batch) {
    if (!batch?.name?.trim()) throw new Error('Batch name is required');
    if (!Array.isArray(batch.steps) || !batch.steps.length) throw new Error('Keep at least one measurement step');
    const ids = new Set();
    for (const [index, step] of batch.steps.entries()) {
        const id = String(step.id || '').trim();
        if (!id) throw new Error(`Step ${index + 1}: ID is required`);
        if (ids.has(id)) throw new Error(`Duplicate step ID '${id}'`);
        ids.add(id);
        if (!Array.isArray(step.activeWays) || !step.activeWays.length) throw new Error(`${id}: select at least one active way`);
        const rew = step.rew || {};
        if ((rew.startHz == null) !== (rew.endHz == null)) throw new Error(`${id}: REW start and end frequencies must be set together`);
    }
}

async function editorSave() {
    if (batchEditorBusy) return;
    if (measureState?.active) {
        editorSetStatus('Finish or abort the active batch before editing it.', 'error');
        return;
    }
    try {
        editorValidateDraft(batchEditorDraft);
        batchEditorBusy = true;
        editorEl('editorSave').disabled = true;
        editorSetStatus('Validating and saving batch…');
        const response = await fetch('/api/measurement-batch/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: batchEditorDraft })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `${response.status} ${response.statusText}`);
        measureState = data;
        batchEditorDraft = editorBatchFromState();
        batchEditorIndex = Math.min(batchEditorIndex, Math.max(0, batchEditorDraft.steps.length - 1));
        renderAll();
        editorRenderAll();
        editorSetStatus(`Saved · ${data.batch?.name || 'Measurement Batch'} · ${data.batch?.total || 0} measurements`, 'ok');
    } catch (error) {
        editorSetStatus(`SAVE ERROR · ${error.message}`, 'error');
    } finally {
        batchEditorBusy = false;
        editorEl('editorSave').disabled = false;
    }
}

function editorOpen() {
    if (measureState?.active) {
        setMeasureStatus('Finish or abort the active batch before editing it.', 'error');
        return;
    }
    batchEditorDraft = editorBatchFromState() || editorNewBatch();
    batchEditorIndex = 0;
    editorRenderAll();
    editorSetStatus('Changes are local until SAVE BATCH.');
    const dialog = editorEl('batchEditorDialog');
    if (!dialog.open) dialog.showModal();
}

function editorClose() {
    const dialog = editorEl('batchEditorDialog');
    if (dialog.open) dialog.close();
}

function editorAddStep() {
    const id = editorNextId();
    batchEditorDraft.steps.push({
        id,
        name: 'New measurement',
        instruction: 'Check the prepared DSP state, then run the REW sweep.',
        position: '',
        activeWays: ['KICK'],
        ways: { KICK: { gainOffsetDb: -15 } },
        crossovers: {},
        disabledFilters: [],
        rew: { measurementName: `${id}_KICK`, levelDbfs: -20, timingReference: true }
    });
    batchEditorIndex = batchEditorDraft.steps.length - 1;
    editorRenderAll();
}

function editorDuplicateStep() {
    const source = editorCurrentStep();
    if (!source) return;
    const copy = editorClone(source);
    copy.id = editorUniqueId(`${source.id || 'M'}_COPY`);
    copy.name = `${source.name || 'Measurement'} copy`;
    copy.rew = copy.rew || {};
    copy.rew.measurementName = copy.id;
    batchEditorDraft.steps.splice(batchEditorIndex + 1, 0, copy);
    batchEditorIndex += 1;
    editorRenderAll();
}

function editorDeleteStep() {
    if (batchEditorDraft.steps.length <= 1) {
        editorSetStatus('A batch must contain at least one measurement.', 'error');
        return;
    }
    batchEditorDraft.steps.splice(batchEditorIndex, 1);
    batchEditorIndex = Math.min(batchEditorIndex, batchEditorDraft.steps.length - 1);
    editorRenderAll();
}

function editorMove(direction) {
    const target = batchEditorIndex + direction;
    if (target < 0 || target >= batchEditorDraft.steps.length) return;
    const [step] = batchEditorDraft.steps.splice(batchEditorIndex, 1);
    batchEditorDraft.steps.splice(target, 0, step);
    batchEditorIndex = target;
    editorRenderAll();
}

function editorBindStaticFields() {
    const bind = (id, event, fn) => editorEl(id).addEventListener(event, fn);

    bind('editorBatchName', 'input', event => { batchEditorDraft.name = event.target.value; });
    bind('editorBatchDescription', 'input', event => { batchEditorDraft.description = event.target.value; });
    bind('editorSettleMs', 'input', event => { batchEditorDraft.defaults.settleMs = editorNumber(event.target.value) ?? 0; });
    bind('editorMuteUnlisted', 'change', event => { batchEditorDraft.defaults.muteUnlisted = event.target.value === 'true'; });
    bind('editorBatchDisabled', 'input', event => { batchEditorDraft.defaults.disabledFilters = editorCsv(event.target.value); });

    bind('editorStepId', 'input', event => { const step = editorCurrentStep(); step.id = event.target.value; editorRenderStepList(); });
    bind('editorStepName', 'input', event => { const step = editorCurrentStep(); step.name = event.target.value; editorRenderStepList(); });
    bind('editorInstruction', 'input', event => { editorCurrentStep().instruction = event.target.value; });
    bind('editorPosition', 'input', event => { editorCurrentStep().position = event.target.value; });
    bind('editorDisabledFilters', 'input', event => { editorCurrentStep().disabledFilters = editorCsv(event.target.value); });

    bind('editorRewName', 'input', event => { editorCurrentStep().rew.measurementName = event.target.value; });
    bind('editorRewStart', 'input', event => {
        const value = editorNumber(event.target.value);
        if (value == null) delete editorCurrentStep().rew.startHz; else editorCurrentStep().rew.startHz = value;
    });
    bind('editorRewEnd', 'input', event => {
        const value = editorNumber(event.target.value);
        if (value == null) delete editorCurrentStep().rew.endHz; else editorCurrentStep().rew.endHz = value;
    });
    bind('editorRewLevel', 'input', event => {
        const value = editorNumber(event.target.value);
        if (value == null) delete editorCurrentStep().rew.levelDbfs; else editorCurrentStep().rew.levelDbfs = value;
    });
    bind('editorRewTiming', 'change', event => {
        if (!event.target.value) delete editorCurrentStep().rew.timingReference;
        else editorCurrentStep().rew.timingReference = event.target.value === 'true';
    });
    bind('editorRewNotes', 'input', event => { editorCurrentStep().rew.notes = event.target.value; });
}

function editorSyncMainButtons() {
    const edit = editorEl('editBatch');
    const exportButton = editorEl('exportBatch');
    if (!edit || !exportButton) return;
    edit.disabled = !!measureState?.active || !!measureBusy;
    exportButton.disabled = !measureState?.batch || !!measureBusy;
    edit.textContent = measureState?.batch ? 'EDIT' : 'NEW';
}

function initMeasurementBatchEditor() {
    editorBindStaticFields();

    editorEl('editBatch').addEventListener('click', editorOpen);
    editorEl('exportBatch').addEventListener('click', () => editorDownload(editorBatchFromState()));
    editorEl('editorClose').addEventListener('click', editorClose);
    editorEl('editorExport').addEventListener('click', () => editorDownload(batchEditorDraft));
    editorEl('editorSave').addEventListener('click', editorSave);
    editorEl('editorReset').addEventListener('click', () => {
        batchEditorDraft = editorBatchFromState() || editorNewBatch();
        batchEditorIndex = 0;
        editorRenderAll();
        editorSetStatus('Draft reloaded from the currently saved batch.');
    });
    editorEl('editorAddStep').addEventListener('click', editorAddStep);
    editorEl('editorDuplicateStep').addEventListener('click', editorDuplicateStep);
    editorEl('editorDeleteStep').addEventListener('click', editorDeleteStep);
    editorEl('editorMoveUp').addEventListener('click', () => editorMove(-1));
    editorEl('editorMoveDown').addEventListener('click', () => editorMove(1));

    editorEl('batchEditorDialog').addEventListener('cancel', event => {
        event.preventDefault();
        editorClose();
    });

    const baseRenderAll = renderAll;
    renderAll = function estackMeasurementBatchRenderWithEditor() {
        baseRenderAll();
        editorSyncMainButtons();
    };
    editorSyncMainButtons();
}

document.addEventListener('DOMContentLoaded', initMeasurementBatchEditor);
