'use strict';

/* Adds the batch-global physical measurement input selector.
 * Values are one-based to match the labels on the E-Stack hardware:
 * IN4 means CamillaDSP mixer source channel 3.
 */

(function installMeasurementBatchInputUi() {
    let quickInputBusy = false;

    function inputOptions(value) {
        let html = `<option value=""${value == null ? ' selected' : ''}>BASELINE</option>`;
        for (let input = 1; input <= 8; input += 1) {
            html += `<option value="${input}"${Number(value) === input ? ' selected' : ''}>IN${input}</option>`;
        }
        return html;
    }

    function ensureEditorInput() {
        let select = document.getElementById('editorMeasurementInput');
        if (select) return select;

        const settle = document.getElementById('editorSettleMs');
        const grid = settle?.closest('.measure-editor-grid');
        if (!grid) return null;

        const field = document.createElement('div');
        field.className = 'measure-editor-field';
        field.innerHTML = `
            <label for="editorMeasurementInput">MEASUREMENT INPUT</label>
            <select id="editorMeasurementInput">${inputOptions(null)}</select>
            <small class="measure-input-help">Physical capture input routed temporarily to the E-Stack ways.</small>`;

        const disabledField = document.getElementById('editorBatchDisabled')?.closest('.measure-editor-field');
        grid.insertBefore(field, disabledField || null);
        select = field.querySelector('select');
        select.addEventListener('change', () => {
            if (!batchEditorDraft) return;
            batchEditorDraft.defaults = batchEditorDraft.defaults || {};
            if (select.value === '') delete batchEditorDraft.defaults.measurementInput;
            else batchEditorDraft.defaults.measurementInput = Number(select.value);
            if (typeof editorSetStatus === 'function') {
                editorSetStatus(select.value
                    ? `Measurement source set to IN${select.value} · SAVE BATCH to apply.`
                    : 'Measurement source uses baseline routing · SAVE BATCH to apply.', 'info');
            }
        });
        return select;
    }

    function ensureQuickInput() {
        let select = document.getElementById('measurementInputQuick');
        if (select) return select;
        const actions = document.querySelector('.measure-import-actions');
        if (!actions) return null;

        const field = document.createElement('label');
        field.className = 'measure-input-quick';
        field.innerHTML = `
            <span>MEASUREMENT INPUT</span>
            <select id="measurementInputQuick" aria-label="Measurement input">${inputOptions(null)}</select>`;
        actions.insertBefore(field, actions.firstChild);
        select = field.querySelector('select');

        select.addEventListener('change', async () => {
            if (quickInputBusy) return;
            if (!measureState?.batch) {
                select.value = '';
                setMeasureStatus('Import or create a batch first.', 'error');
                return;
            }
            if (measureState?.active) {
                syncQuickInput();
                setMeasureStatus('Finish or abort the active batch before changing its measurement input.', 'error');
                return;
            }

            const draft = typeof editorBatchFromState === 'function' ? editorBatchFromState() : null;
            if (!draft) {
                syncQuickInput();
                setMeasureStatus('Could not rebuild the current batch for editing.', 'error');
                return;
            }

            draft.defaults = draft.defaults || {};
            if (select.value === '') delete draft.defaults.measurementInput;
            else draft.defaults.measurementInput = Number(select.value);

            try {
                quickInputBusy = true;
                select.disabled = true;
                setMeasureStatus(select.value ? `Setting measurement source to IN${select.value}…` : 'Restoring baseline measurement routing…');
                const data = await postJson('/api/measurement-batch/import', { batch: draft });
                measureState = data;
                renderAll();
                setMeasureStatus(data.batch?.defaults?.measurementInput != null
                    ? `Measurement source · IN${data.batch.defaults.measurementInput}`
                    : 'Measurement source · baseline routing', 'ok');
            } catch (error) {
                setMeasureStatus(`INPUT ERROR · ${error.message}`, 'error');
                try { await refreshState(); } catch (_) {}
            } finally {
                quickInputBusy = false;
                syncQuickInput();
            }
        });
        return select;
    }

    function syncQuickInput() {
        const select = ensureQuickInput();
        if (!select) return;
        const input = measureState?.batch?.defaults?.measurementInput;
        select.innerHTML = inputOptions(input);
        select.value = input == null ? '' : String(input);
        select.disabled = quickInputBusy || !!measureState?.active || !measureState?.batch || !!measureBusy;
        const field = select.closest('.measure-input-quick');
        if (field) {
            field.dataset.state = measureState?.active ? 'locked' : input == null ? 'baseline' : 'selected';
            field.title = measureState?.active
                ? 'Measurement input is locked while a batch is active.'
                : input == null
                    ? 'Use the normal captured mixer routing.'
                    : `Physical IN${input} will be routed temporarily to the E-Stack ways.`;
        }
    }

    function ensureRuntimeBadge() {
        let badge = document.getElementById('measurementInputBadge');
        if (badge) return badge;
        const heads = [...document.querySelectorAll('.measure-block-head')];
        const activeHead = heads.find(head => head.querySelector('strong')?.textContent?.trim() === 'ACTIVE WAYS');
        if (!activeHead) return null;
        badge = document.createElement('span');
        badge.id = 'measurementInputBadge';
        badge.className = 'measurement-input-badge';
        activeHead.appendChild(badge);
        return badge;
    }

    const baseEditorRenderBatchFields = editorRenderBatchFields;
    editorRenderBatchFields = function renderBatchFieldsWithInput() {
        baseEditorRenderBatchFields();
        const select = ensureEditorInput();
        if (select) {
            const value = batchEditorDraft?.defaults?.measurementInput;
            select.innerHTML = inputOptions(value);
            select.value = value == null ? '' : String(value);
        }
    };

    const baseEditorNewBatch = editorNewBatch;
    editorNewBatch = function newBatchWithExplicitInputChoice() {
        const batch = baseEditorNewBatch();
        delete batch.defaults.measurementInput;
        return batch;
    };

    const baseRenderBatchHeader = renderBatchHeader;
    renderBatchHeader = function renderBatchHeaderWithInputSelector() {
        baseRenderBatchHeader();
        syncQuickInput();
    };

    const baseRenderCurrent = renderCurrent;
    renderCurrent = function renderCurrentWithInputSource() {
        baseRenderCurrent();
        const badge = ensureRuntimeBadge();
        if (!badge) return;
        const input = measureState?.batch?.defaults?.measurementInput;
        badge.textContent = input == null ? 'SOURCE · BASELINE ROUTING' : `SOURCE · IN${input}`;
        badge.title = input == null
            ? 'Measurement Batch preserves the captured mixer routing.'
            : `Physical IN${input} is routed to the E-Stack output ways for this batch.`;
        syncQuickInput();
    };

    document.addEventListener('DOMContentLoaded', () => {
        ensureEditorInput();
        ensureQuickInput();
        ensureRuntimeBadge();
        syncQuickInput();
    });
})();
