'use strict';

/* Adds the batch-global physical measurement input selector without duplicating
 * the structured editor. Values are one-based to match the labels on the E-Stack
 * hardware: IN4 means CamillaDSP mixer source channel 3.
 */

(function installMeasurementBatchInputUi() {
    function inputOptions(value) {
        let html = `<option value=""${value == null ? ' selected' : ''}>BASELINE ROUTING</option>`;
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
            <small style="color:var(--estack-dim);font-size:8px;line-height:1.2">Physical capture input routed temporarily to the E-Stack ways.</small>`;

        const disabledField = document.getElementById('editorBatchDisabled')?.closest('.measure-editor-field');
        grid.insertBefore(field, disabledField || null);
        select = field.querySelector('select');
        select.addEventListener('change', () => {
            if (!batchEditorDraft) return;
            batchEditorDraft.defaults = batchEditorDraft.defaults || {};
            if (select.value === '') delete batchEditorDraft.defaults.measurementInput;
            else batchEditorDraft.defaults.measurementInput = Number(select.value);
            if (typeof editorSetStatus === 'function') {
                editorSetStatus(select.value ? `Measurement source set to IN${select.value} · SAVE BATCH to apply.` : 'Measurement source uses baseline routing · SAVE BATCH to apply.', 'info');
            }
        });
        return select;
    }

    function ensureRuntimeBadge() {
        let badge = document.getElementById('measurementInputBadge');
        if (badge) return badge;
        const heads = [...document.querySelectorAll('.measure-block-head')];
        const activeHead = heads.find(head => head.querySelector('strong')?.textContent?.trim() === 'ACTIVE WAYS');
        if (!activeHead) return null;
        badge = document.createElement('span');
        badge.id = 'measurementInputBadge';
        badge.style.color = '#59d5e3';
        badge.style.fontSize = '9px';
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
        // Absence intentionally means baseline routing. The user must explicitly
        // select IN1..IN8 before a campaign if a dedicated REW capture input is used.
        delete batch.defaults.measurementInput;
        return batch;
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
    };

    document.addEventListener('DOMContentLoaded', () => {
        ensureEditorInput();
        ensureRuntimeBadge();
    });
})();
