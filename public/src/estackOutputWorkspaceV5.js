// E-Stack Output Workspace V5 — stable graph-mode geometry + shared E-Stack knobs.
// Loaded after V4. This layer deliberately reuses estackEq8MakeKnob(), the same
// rotary control used elsewhere in E-Stack, and bridges it to the already-tested
// V4 numeric input handlers. No DSP mutation path is duplicated here.

(function installEStackOutputWorkspaceV5() {
    const baseRenderControls = renderControls;

    function fieldLabel(field) {
        return field?.querySelector('.estack-ws-field-label, .estack-eq8-knob-label')?.textContent?.trim().toUpperCase() || '';
    }

    function unitFromWrap(wrap) {
        return wrap?.querySelector(':scope > span')?.textContent?.trim() || '';
    }

    function resetFor(label, value) {
        if (label === 'GAIN' || label === 'DELAY' || label.startsWith('PHASE')) return 0;
        return Number(value);
    }

    function replaceV4KnobWithShared(field) {
        if (!field || field.dataset.estackV5Knob === 'true') return;
        const oldControl = field.querySelector('.estack-ws-v4-knob-control');
        const oldWrap = oldControl?.querySelector('.estack-ws-number');
        const oldInput = oldWrap?.querySelector('input[type="number"]');
        if (!oldControl || !oldWrap || !oldInput || typeof estackEq8MakeKnob !== 'function') return;

        const label = fieldLabel(field);
        const value = Number(oldInput.value);
        const min = Number(oldInput.min);
        const max = Number(oldInput.max);
        const step = Number(oldInput.step) || 1;
        const unit = unitFromWrap(oldWrap);
        const locked = !!oldInput.disabled;
        if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;

        // Keep the original input alive in this closure. Its listeners own all
        // preview/commit behaviour and therefore retain the guarded DSP writes.
        const bridgePreview = locked ? null : next => {
            oldInput.value = String(next);
            oldInput.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const bridgeCommit = locked ? null : next => {
            oldInput.value = String(next);
            oldInput.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const shared = estackEq8MakeKnob({
            label,
            value,
            min,
            max,
            step,
            logarithmic: label === 'FREQ',
            unit,
            resetValue: resetFor(label, value),
            preview: bridgePreview,
            commit: bridgeCommit
        });
        shared.classList.add('estack-ws-v5-shared-knob');

        if (locked) {
            shared.classList.add('estack-v2-locked');
            const knob = shared.querySelector('.estack-eq8-knob');
            const number = shared.querySelector('.estack-eq8-number');
            if (knob) {
                knob.tabIndex = -1;
                knob.setAttribute('aria-disabled', 'true');
            }
            if (number) number.disabled = true;
        }

        field.dataset.estackV5Knob = 'true';
        field.classList.remove('estack-ws-v4-knob-field');
        field.classList.add('estack-ws-v5-knob-field');
        field.replaceChildren(shared);
    }

    function replaceWorkspaceKnobs() {
        const workspace = document.querySelector('#moduleControls .estack-ws-workspace-v2');
        if (!workspace) return;
        workspace.querySelectorAll('.estack-ws-v4-knob-field').forEach(replaceV4KnobWithShared);
        workspace.classList.add('estack-ws-workspace-v5');
    }

    function stabilizeGraphModeGeometry() {
        const modebar = document.getElementById('estackGraphModebar');
        const xoControls = document.getElementById('estackXoControls');
        const xoReadout = document.getElementById('estackXoReadout');
        if (modebar) modebar.classList.add('estack-ws-v5-modebar');
        if (xoControls) xoControls.classList.add('estack-ws-v5-xo-slot');
        if (xoReadout) xoReadout.classList.add('estack-ws-v5-xo-readout-slot');
    }

    renderControls = function() {
        baseRenderControls();
        replaceWorkspaceKnobs();
        stabilizeGraphModeGeometry();
    };

    document.addEventListener('DOMContentLoaded', () => {
        requestAnimationFrame(() => {
            replaceWorkspaceKnobs();
            stabilizeGraphModeGeometry();
        });
    });
})();
