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
                document.dispatchEvent(new CustomEvent('estack:measurement-input-changed'));
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

/* Baseline Processing provenance.
 * Before START this is a live preview. During a batch the server summarizes the
 * exact baselineConfig already persisted for restore, so browser refreshes cannot
 * silently change the reference used by the measurement campaign.
 */
(function installMeasurementBatchBaselineUi() {
    let liveBaseline = null;
    let baselineBusy = false;
    let lastFetchAt = 0;
    let lastInputKey = null;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatNumber(value, digits = 1) {
        const n = Number(value);
        return Number.isFinite(n) ? n.toFixed(digits) : null;
    }

    function formatHz(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        if (n >= 1000) return `${Number((n / 1000).toFixed(2))} kHz`;
        return `${Number(n.toFixed(n % 1 ? 1 : 0))} Hz`;
    }

    function ensureStyles() {
        if (document.getElementById('measurementBaselineStyles')) return;
        const style = document.createElement('style');
        style.id = 'measurementBaselineStyles';
        style.textContent = `
.measure-baseline-strip{grid-column:1/-1;min-width:0;display:flex;align-items:center;gap:7px;white-space:nowrap;color:var(--estack-dim);font-size:8px;overflow:hidden}
.measure-baseline-strip>strong{font-size:8px!important;color:var(--estack-muted)!important;max-width:none!important}
.measure-baseline-pill{padding:2px 5px;border:1px solid var(--estack-border-soft);border-radius:3px;color:var(--estack-muted);font-size:8px}
.measure-baseline-pill.captured{border-color:rgba(121,216,182,.35);color:#79d8b6}
.measure-baseline-pill.live{border-color:rgba(89,213,227,.28);color:#59d5e3}
.measure-baseline-pill.warning{border-color:rgba(255,186,109,.35);color:#ffba6d}
.measure-baseline-spacer{flex:1 1 auto;min-width:3px}
.measure-baseline-strip button{height:22px;min-height:22px;padding:0 7px;border:1px solid var(--estack-border);border-radius:3px;background:transparent;color:#59d5e3;font:8px "Abel",sans-serif;cursor:pointer}
.measure-baseline-strip button:hover{border-color:rgba(89,213,227,.48);color:#fff}
.measure-baseline-dialog{position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);width:min(1080px,94vw);height:min(720px,88vh);margin:0;padding:0;border:1px solid rgba(89,213,227,.28);border-radius:7px;background:var(--estack-bg);color:var(--estack-text);box-shadow:0 18px 70px rgba(0,0,0,.55);overflow:hidden}
.measure-baseline-dialog::backdrop{background:rgba(4,12,13,.78)}
.measure-baseline-shell{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr)}
.measure-baseline-head{padding:9px 11px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--estack-border-soft)}
.measure-baseline-head strong{display:block;font-size:16px;font-weight:500}.measure-baseline-head span{color:var(--estack-muted);font-size:9px}
.measure-baseline-head button{height:28px;padding:0 10px;border:1px solid var(--estack-border);border-radius:3px;background:transparent;color:var(--estack-muted);font:9px "Abel",sans-serif}
.measure-baseline-body{min-height:0;padding:10px;overflow:auto}.measure-baseline-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-bottom:8px}
.measure-baseline-meta>div,.measure-baseline-group{border:1px solid var(--estack-border-soft);border-radius:4px;padding:7px}.measure-baseline-meta span{display:block;color:var(--estack-dim);font-size:8px}.measure-baseline-meta strong{display:block;margin-top:2px;font-size:10px;font-weight:500;color:#edf4f5}
.measure-baseline-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.measure-baseline-group h3{margin:0 0 6px;font-size:10px;font-weight:500;letter-spacing:.04em}.measure-baseline-filter{display:grid;grid-template-columns:minmax(120px,.75fr) minmax(0,1.5fr);gap:8px;padding:5px 0;border-top:1px solid var(--estack-border-soft)}
.measure-baseline-filter:first-of-type{border-top:0}.measure-baseline-filter strong{font-size:9px;font-weight:500;color:#edf4f5;overflow-wrap:anywhere}.measure-baseline-filter span{font-size:9px;color:var(--estack-muted);line-height:1.35}.measure-baseline-kind{color:#59d5e3!important}.measure-baseline-empty{color:var(--estack-dim);font-size:9px;padding:4px 0}.measure-baseline-warning{margin-bottom:6px;padding:6px 8px;border:1px solid rgba(255,186,109,.3);border-radius:4px;color:#ffba6d;font-size:9px}
@media(max-width:760px){.measure-baseline-meta,.measure-baseline-groups{grid-template-columns:1fr}.measure-baseline-strip{overflow:auto}.measure-baseline-dialog{width:97vw;height:92vh}}
`;
        document.head.appendChild(style);
    }

    function ensureStrip() {
        let strip = document.getElementById('measurementBaselineStrip');
        if (strip) return strip;
        const copy = document.querySelector('.measure-import-copy');
        if (!copy) return null;
        strip = document.createElement('div');
        strip.id = 'measurementBaselineStrip';
        strip.className = 'measure-baseline-strip';
        strip.innerHTML = '<strong>BASELINE PROCESSING</strong><span class="measure-baseline-pill">LOADING</span>';
        copy.appendChild(strip);
        return strip;
    }

    function ensureDialog() {
        let dialog = document.getElementById('measurementBaselineDialog');
        if (dialog) return dialog;
        dialog = document.createElement('dialog');
        dialog.id = 'measurementBaselineDialog';
        dialog.className = 'measure-baseline-dialog';
        dialog.innerHTML = `
            <div class="measure-baseline-shell">
                <div class="measure-baseline-head">
                    <div><strong>Baseline Processing</strong><span id="measurementBaselineSubtitle">—</span></div>
                    <button id="measurementBaselineClose" type="button">CLOSE</button>
                </div>
                <div id="measurementBaselineBody" class="measure-baseline-body"></div>
            </div>`;
        document.body.appendChild(dialog);
        dialog.querySelector('#measurementBaselineClose').addEventListener('click', () => dialog.close());
        return dialog;
    }

    function activeBaseline() {
        return measureState?.baseline || liveBaseline;
    }

    function filterText(filter) {
        const parts = [];
        if (filter.subtype) parts.push(filter.subtype);
        const hz = formatHz(filter.freqHz); if (hz) parts.push(hz);
        const gain = formatNumber(filter.gainDb, 1); if (gain != null) parts.push(`${Number(gain) > 0 ? '+' : ''}${gain} dB`);
        const q = formatNumber(filter.q, 2); if (q != null) parts.push(`Q ${q}`);
        if (filter.order != null) parts.push(`order ${filter.order}`);
        const delay = formatNumber(filter.delayMs, 3); if (delay != null) parts.push(`${delay} ms`);
        if (filter.inverted === true) parts.push('INVERTED');
        if (filter.mute === true) parts.push('MUTED');
        return parts.join(' · ') || filter.type || '—';
    }

    function renderFilter(filter) {
        return `<div class="measure-baseline-filter"><strong>${escapeHtml(filter.name)}</strong><span><span class="measure-baseline-kind">${escapeHtml(String(filter.kind || '').toUpperCase())}</span> · ${escapeHtml(filterText(filter))}${filter.description ? `<br>${escapeHtml(filter.description)}` : ''}</span></div>`;
    }

    function renderGroup(title, filters, eqOnly = false) {
        const list = eqOnly ? (filters || []).filter(item => item.kind === 'eq') : (filters || []);
        return `<section class="measure-baseline-group"><h3>${escapeHtml(title)} · ${list.length}</h3>${list.length ? list.map(renderFilter).join('') : '<div class="measure-baseline-empty">No active filters in this group.</div>'}</section>`;
    }

    function renderDialog() {
        const baseline = activeBaseline();
        const dialog = ensureDialog();
        const body = dialog.querySelector('#measurementBaselineBody');
        if (!baseline) {
            body.innerHTML = '<div class="measure-baseline-empty">Baseline unavailable.</div>';
            return;
        }
        const source = baseline.measurementInput == null ? 'BASELINE ROUTING' : `IN${baseline.measurementInput}`;
        dialog.querySelector('#measurementBaselineSubtitle').textContent = `${baseline.captured ? 'CAPTURED' : 'LIVE PREVIEW'} · ${baseline.id} · ${source}`;
        const warnings = (baseline.warnings || []).map(text => `<div class="measure-baseline-warning">${escapeHtml(text)}</div>`).join('');
        const mirror = baseline.sharedInputMirrored
            ? `YES · shared L/R chain → IN${baseline.measurementInput}`
            : 'NOT REQUIRED';
        const groups = [
            renderGroup('INPUT / GLOBAL · all active filters', baseline.input?.filters || [], false),
            renderGroup('SUB · EQ', baseline.ways?.SUB?.filters || [], true),
            renderGroup('KICK · EQ', baseline.ways?.KICK?.filters || [], true),
            renderGroup('MID L · EQ', baseline.ways?.MID_L?.filters || [], true),
            renderGroup('MID R · EQ', baseline.ways?.MID_R?.filters || [], true),
            renderGroup('HIGH L · EQ', baseline.ways?.HIGH_L?.filters || [], true),
            renderGroup('HIGH R · EQ', baseline.ways?.HIGH_R?.filters || [], true)
        ].join('');
        body.innerHTML = `${warnings}<div class="measure-baseline-meta">
            <div><span>BASELINE ID</span><strong>${escapeHtml(baseline.id)}</strong></div>
            <div><span>STATE</span><strong>${baseline.captured ? 'CAPTURED' : 'LIVE PREVIEW'}</strong></div>
            <div><span>MEASUREMENT SOURCE</span><strong>${escapeHtml(source)}</strong></div>
            <div><span>INPUT CHAIN MIRRORED</span><strong>${escapeHtml(mirror)}</strong></div>
        </div><div class="measure-baseline-groups">${groups}</div>`;
    }

    function renderStrip() {
        const strip = ensureStrip();
        if (!strip) return;
        const baseline = activeBaseline();
        if (!baseline) {
            strip.innerHTML = '<strong>BASELINE PROCESSING</strong><span class="measure-baseline-pill">UNAVAILABLE</span>';
            return;
        }
        const kick = baseline.ways?.KICK?.eqCount || 0;
        const mid = baseline.ways?.MID_L?.eqCount || 0;
        const warning = (baseline.warnings || []).length;
        strip.innerHTML = `
            <strong>BASELINE PROCESSING</strong>
            <span class="measure-baseline-pill ${baseline.captured ? 'captured' : 'live'}">${baseline.captured ? 'CAPTURED' : 'LIVE'}</span>
            <span class="measure-baseline-pill">ID ${escapeHtml(baseline.id)}</span>
            <span>INPUT EQ ${baseline.counts?.inputEq || 0}</span>
            <span>KICK EQ ${kick}</span>
            <span>MID L EQ ${mid}</span>
            <span>OUT EQ ${baseline.counts?.outputEqUnique || 0}</span>
            ${warning ? `<span class="measure-baseline-pill warning">${warning} WARNING${warning > 1 ? 'S' : ''}</span>` : ''}
            <span class="measure-baseline-spacer"></span>
            <button id="measurementBaselineView" type="button">VIEW BASELINE</button>`;
        strip.querySelector('#measurementBaselineView').addEventListener('click', async () => {
            if (!measureState?.active) await refreshBaseline(true);
            renderDialog();
            ensureDialog().showModal();
        });
    }

    async function refreshBaseline(force = false) {
        if (baselineBusy || measureState?.active) {
            renderStrip();
            return;
        }
        const now = Date.now();
        const inputKey = measureState?.batch?.defaults?.measurementInput ?? 'baseline';
        if (!force && liveBaseline && now - lastFetchAt < 6000 && inputKey === lastInputKey) {
            renderStrip();
            return;
        }
        baselineBusy = true;
        try {
            const data = await fetchJson('/api/measurement-batch/baseline', { cache: 'no-store' });
            liveBaseline = data.baseline || null;
            lastFetchAt = Date.now();
            lastInputKey = inputKey;
        } catch (_) {
            liveBaseline = null;
        } finally {
            baselineBusy = false;
            renderStrip();
        }
    }

    const baseRenderAll = renderAll;
    renderAll = function renderAllWithBaseline() {
        baseRenderAll();
        ensureStyles();
        ensureStrip();
        renderStrip();
        if (!measureState?.active) refreshBaseline(false);
    };

    document.addEventListener('estack:measurement-input-changed', () => refreshBaseline(true));
    document.addEventListener('DOMContentLoaded', () => {
        ensureStyles();
        ensureStrip();
        ensureDialog();
        setTimeout(() => refreshBaseline(true), 250);
    });
})();
