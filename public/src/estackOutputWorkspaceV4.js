// E-Stack Output Workspace V4 — premium hybrid control surface.
// This layer is intentionally presentation/interaction-only. It enhances the
// established V3 DOM and reuses the existing number-input mutation handlers so
// every DSP write still flows through the already-tested safeUpload/guarded paths.

(function installEStackOutputWorkspaceV4() {
    const baseRenderControls = renderControls;

    function fieldLabel(field) {
        return field?.querySelector('.estack-ws-field-label')?.textContent?.trim().toUpperCase() || '';
    }

    function clamp(value, min, max) {
        const n = Number(value);
        return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
    }

    function normFor(value, min, max, logarithmic) {
        const v = clamp(value, min, max);
        if (logarithmic && min > 0 && max > min) {
            return Math.log(v / min) / Math.log(max / min);
        }
        return (v - min) / Math.max(1e-12, max - min);
    }

    function valueFor(norm, min, max, logarithmic) {
        const t = clamp(norm, 0, 1);
        if (logarithmic && min > 0 && max > min) {
            return min * Math.pow(max / min, t);
        }
        return min + (max - min) * t;
    }

    function roundToStep(value, step) {
        const s = Math.abs(Number(step)) || 1;
        const precision = String(s).includes('.') ? String(s).split('.')[1].length : 0;
        const rounded = Math.round(Number(value) / s) * s;
        return Number(rounded.toFixed(Math.min(6, precision)));
    }

    function enhanceNumberAsKnob(field, options = {}) {
        if (!field || field.dataset.estackV4Knob === 'true') return;
        const numberWrap = field.querySelector('.estack-ws-number');
        const input = numberWrap?.querySelector('input[type="number"]');
        if (!numberWrap || !input) return;

        const min = Number(input.min);
        const max = Number(input.max);
        const step = Number(input.step) || 1;
        if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;

        field.dataset.estackV4Knob = 'true';
        field.classList.add('estack-ws-v4-knob-field');
        if (options.role) field.classList.add(`estack-ws-v4-${options.role}`);

        const knob = document.createElement('div');
        knob.className = 'estack-ws-v4-knob';
        knob.tabIndex = input.disabled ? -1 : 0;
        knob.setAttribute('role', 'slider');
        knob.setAttribute('aria-label', fieldLabel(field) || options.role || 'Parameter');
        knob.setAttribute('aria-valuemin', String(min));
        knob.setAttribute('aria-valuemax', String(max));

        const face = document.createElement('span');
        face.className = 'estack-ws-v4-knob-face';
        const marker = document.createElement('i');
        marker.className = 'estack-ws-v4-knob-marker';
        const hub = document.createElement('b');
        hub.className = 'estack-ws-v4-knob-hub';
        face.append(marker, hub);
        knob.append(face);

        const control = document.createElement('div');
        control.className = 'estack-ws-v4-knob-control';
        control.append(knob, numberWrap);

        const label = field.querySelector(':scope > .estack-ws-field-label');
        field.replaceChildren();
        if (label) field.append(label);
        field.append(control);

        const logarithmic = !!options.logarithmic;
        let drag = null;
        let wheelTimer = null;

        function current() {
            return clamp(Number(input.value), min, max);
        }

        function paint() {
            const n = normFor(current(), min, max, logarithmic);
            const angle = -135 + n * 270;
            knob.style.setProperty('--v4-angle', `${angle}deg`);
            knob.style.setProperty('--v4-fill', `${n * 270}deg`);
            knob.setAttribute('aria-valuenow', String(current()));
            knob.classList.toggle('disabled', input.disabled);
            knob.tabIndex = input.disabled ? -1 : 0;
        }

        function setFromNorm(norm, preview = true) {
            const next = roundToStep(valueFor(norm, min, max, logarithmic), step);
            input.value = String(clamp(next, min, max));
            paint();
            if (preview) input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        function commit() {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        knob.addEventListener('pointerdown', event => {
            if (input.disabled || event.button !== 0) return;
            event.preventDefault();
            drag = {
                y: event.clientY,
                norm: normFor(current(), min, max, logarithmic),
                pointerId: event.pointerId
            };
            knob.classList.add('dragging');
            try { knob.setPointerCapture(event.pointerId); } catch (_) {}
        });

        knob.addEventListener('pointermove', event => {
            if (!drag || input.disabled) return;
            event.preventDefault();
            const sensitivity = event.shiftKey ? 520 : 190;
            setFromNorm(drag.norm + (drag.y - event.clientY) / sensitivity);
        });

        const finish = event => {
            if (!drag) return;
            event.preventDefault();
            drag = null;
            knob.classList.remove('dragging');
            try { knob.releasePointerCapture(event.pointerId); } catch (_) {}
            commit();
        };
        knob.addEventListener('pointerup', finish);
        knob.addEventListener('pointercancel', finish);

        knob.addEventListener('wheel', event => {
            if (input.disabled) return;
            event.preventDefault();
            const n = normFor(current(), min, max, logarithmic);
            const amount = event.shiftKey ? .0035 : .012;
            setFromNorm(n + (event.deltaY < 0 ? amount : -amount));
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(commit, 180);
        }, { passive: false });

        knob.addEventListener('keydown', event => {
            if (input.disabled || !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Home') setFromNorm(0);
            else if (event.key === 'End') setFromNorm(1);
            else {
                const direction = ['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1;
                const amount = event.shiftKey ? .0035 : .012;
                setFromNorm(normFor(current(), min, max, logarithmic) + direction * amount);
            }
            commit();
        });

        input.addEventListener('input', paint);
        input.addEventListener('change', paint);
        paint();
    }

    function enhanceCrossoverPane(pane) {
        if (!pane || pane.dataset.estackV4 === 'true') return;
        const controls = pane.querySelector('.estack-ws-xo-controls');
        if (!controls) return;

        const fields = [...controls.children].filter(node => node.classList?.contains('estack-ws-field'));
        const freq = fields.find(field => fieldLabel(field) === 'FREQ');
        const type = fields.find(field => fieldLabel(field) === 'TYPE');
        const slope = fields.find(field => fieldLabel(field) === 'SLOPE');
        if (!freq) return;

        pane.dataset.estackV4 = 'true';
        pane.classList.add('estack-ws-v4-xo-pane');
        enhanceNumberAsKnob(freq, { logarithmic: true, role: 'xo-frequency' });

        const layout = document.createElement('div');
        layout.className = 'estack-ws-v4-xo-layout';
        const options = document.createElement('div');
        options.className = 'estack-ws-v4-xo-options';
        if (type) options.append(type);
        if (slope) options.append(slope);
        layout.append(freq, options);
        controls.replaceChildren(layout);
        controls.classList.add('estack-ws-v4-xo-controls');
    }

    function enhanceAlignment(card) {
        if (!card || card.dataset.estackV4 === 'true') return;
        const controls = card.querySelector(':scope > .estack-ws-align-controls');
        if (!controls) return;

        card.dataset.estackV4 = 'true';
        card.classList.add('estack-ws-alignment-v4');
        controls.classList.add('estack-ws-v4-align-deck');

        for (const child of [...controls.children]) {
            if (child.classList.contains('estack-ws-field')) {
                const label = fieldLabel(child);
                if (label === 'GAIN') {
                    child.classList.add('estack-ws-v4-align-gain');
                    enhanceNumberAsKnob(child, { role: 'gain' });
                } else if (label === 'DELAY') {
                    child.classList.add('estack-ws-v4-align-delay');
                    enhanceNumberAsKnob(child, { role: 'delay' });
                } else if (label.startsWith('PHASE')) {
                    child.classList.add('estack-ws-v4-align-phase');
                    enhanceNumberAsKnob(child, { role: 'phase' });
                }
            } else if (child.classList.contains('estack-ws-state-button')) {
                child.classList.add('estack-ws-v4-switch-tile');
            }
        }

        const protection = card.querySelector('.estack-ws-inline-protection');
        if (protection) protection.classList.add('estack-ws-v4-protection-rail');
    }

    function polishPeq(workspace) {
        const peq = workspace?.querySelector('.estack-ws-peq');
        if (!peq) return;
        peq.classList.add('estack-ws-peq-v4');
        const empty = peq.querySelector('.estack-ws-peq-empty');
        if (empty) empty.innerHTML = '<strong>No parametric EQ</strong><span>+ PEQ to add a correction band</span>';
    }

    function enhanceWorkspace() {
        const workspace = document.querySelector('#moduleControls .estack-ws-workspace-v2');
        if (!workspace) return;
        workspace.classList.add('estack-ws-workspace-v4');
        enhanceCrossoverPane(workspace.querySelector('.estack-ws-hpf'));
        enhanceCrossoverPane(workspace.querySelector('.estack-ws-lpf'));
        enhanceAlignment(workspace.querySelector('.estack-ws-alignment-v3, .estack-ws-alignment-v2'));
        polishPeq(workspace);
    }

    renderControls = function() {
        baseRenderControls();
        enhanceWorkspace();
    };

    document.addEventListener('DOMContentLoaded', () => {
        requestAnimationFrame(enhanceWorkspace);
    });
})();
