// E-Stack Q input fix.
// Output Processing previously displayed Q in an <output> that looked editable.
// Advanced filter Q fields also relied on blur/change and did not normalize a
// French decimal comma. Keep the existing DSP commit paths; only fix the input UI.

(function () {
    'use strict';

    const Q_MIN = 0.1;
    const Q_MAX = 20;
    const Q_STEP = 0.01;

    function clampQ(value, fallback = 0.7) {
        const normalized = String(value ?? '').trim().replace(',', '.');
        const number = Number(normalized);
        const safe = Number.isFinite(number) ? number : Number(fallback);
        return Math.round(Math.max(Q_MIN, Math.min(Q_MAX, safe)) * 100) / 100;
    }

    function qToSlider(q) {
        if (typeof window.estackEq8Norm === 'function') {
            return Math.round(window.estackEq8Norm(q, Q_MIN, Q_MAX, true) * 1000);
        }
        const norm = Math.log(q / Q_MIN) / Math.log(Q_MAX / Q_MIN);
        return Math.round(Math.max(0, Math.min(1, norm)) * 1000);
    }

    function sliderToQ(value) {
        const norm = Math.max(0, Math.min(1, Number(value) / 1000));
        const q = typeof window.estackEq8FromNorm === 'function'
            ? window.estackEq8FromNorm(norm, Q_MIN, Q_MAX, true)
            : Q_MIN * Math.pow(Q_MAX / Q_MIN, norm);
        return clampQ(q);
    }

    // Output Processing: replace the fake readout with a real numeric input while
    // preserving the logarithmic Q slider and estackCommitPeqValue() safe upload.
    if (typeof window.estackEq8QControl === 'function') {
        window.estackEq8QControl = function estackEq8QControlKeyboard(slot, entry, q) {
            const root = document.createElement('div');
            root.className = 'estack-eq8-q-control';

            const head = document.createElement('div');
            head.className = 'estack-eq8-q-head';

            const label = document.createElement('span');
            label.className = 'estack-eq8-q-label';
            label.textContent = 'Q';

            const number = document.createElement('input');
            number.type = 'number';
            number.className = 'estack-eq8-q-value';
            number.min = String(Q_MIN);
            number.max = String(Q_MAX);
            number.step = String(Q_STEP);
            number.inputMode = 'decimal';
            number.setAttribute('aria-label', `PEQ ${Number(slot) + 1} Q`);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'estack-eq8-q';
            slider.min = '0';
            slider.max = '1000';
            slider.step = '1';

            let current = clampQ(q);
            let lastCommitted = current;

            const render = next => {
                current = clampQ(next, current);
                number.value = current.toFixed(2);
                slider.value = String(qToSlider(current));
                if (entry?.[1]?.parameters) {
                    entry[1].parameters.q = current;
                    if (typeof window.drawGraph === 'function') window.drawGraph();
                }
            };

            const commit = async next => {
                render(next);
                if (Math.abs(current - lastCommitted) < 0.0001) return;
                lastCommitted = current;
                if (typeof window.estackCommitPeqValue === 'function') {
                    await window.estackCommitPeqValue(slot, 'q', current);
                }
            };

            slider.value = String(qToSlider(current));
            number.value = current.toFixed(2);

            slider.addEventListener('input', () => render(sliderToQ(slider.value)));
            slider.addEventListener('change', () => commit(sliderToQ(slider.value)));

            number.addEventListener('input', () => {
                const text = String(number.value || '').trim();
                if (!text) return;
                const next = Number(text.replace(',', '.'));
                if (!Number.isFinite(next)) return;
                current = Math.max(Q_MIN, Math.min(Q_MAX, next));
                slider.value = String(qToSlider(current));
                if (entry?.[1]?.parameters) {
                    entry[1].parameters.q = current;
                    if (typeof window.drawGraph === 'function') window.drawGraph();
                }
            });

            number.addEventListener('change', () => commit(number.value));
            number.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    render(lastCommitted);
                    number.blur();
                    return;
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commit(number.value).finally(() => number.blur());
            });

            head.append(label, number);
            root.append(head, slider);
            return root;
        };
    }

    function isAdvancedQInput(target) {
        return target instanceof HTMLInputElement &&
            target.id.toLowerCase() === 'q' &&
            !!target.closest('#advancedFilters, .peqParams');
    }

    function isGlobalQInput(target) {
        if (!(target instanceof HTMLInputElement)) return false;
        const label = target.closest('.global-eq-fields label');
        return label?.querySelector('span')?.textContent?.trim().toUpperCase() === 'Q';
    }

    function normalizeExistingQ(target) {
        if (!isAdvancedQInput(target) && !isGlobalQInput(target)) return false;
        const next = clampQ(target.value, target.defaultValue || 0.7);
        target.value = next.toFixed(2);
        return true;
    }

    // Advanced / Input Processing: normalize before the page's existing change
    // handler sees the value, and make Enter behave like an explicit commit.
    document.addEventListener('change', event => {
        normalizeExistingQ(event.target);
    }, true);

    document.addEventListener('keydown', event => {
        const target = event.target;
        if (!isAdvancedQInput(target) && !isGlobalQInput(target)) return;

        if (event.key === 'Escape') {
            target.blur();
            return;
        }
        if (event.key !== 'Enter') return;

        event.preventDefault();
        normalizeExistingQ(target);
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.blur();
    }, true);
})();
