// E-Stack Q input fix.
// Output Processing previously displayed Q in an <output> that looked editable.
// Advanced filter Q fields also relied on blur/change and passed numeric values as
// strings. This layer makes Q genuinely keyboard-editable and numeric end-to-end.

(function () {
    'use strict';

    const Q_MIN = 0.1;
    const Q_MAX = 20;
    const Q_INCREMENT = 0.05;

    function clampQ(value, fallback = 0.7) {
        const normalized = String(value ?? '').trim().replace(',', '.');
        const number = Number(normalized);
        const safe = Number.isFinite(number) ? number : Number(fallback);
        return Math.round(Math.max(Q_MIN, Math.min(Q_MAX, safe)) * 100) / 100;
    }

    function quantizeQ(value) {
        const clamped = clampQ(value);
        return clampQ(Math.round(clamped / Q_INCREMENT) * Q_INCREMENT);
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
        // Slider movement is deliberately quantized to 0.05 Q increments.
        return quantizeQ(q);
    }

    // Output Processing: replace the fake readout with a real text/decimal input.
    // A text input is deliberate: both "0.70" and French-style "0,70" work.
    if (typeof window.estackEq8QControl === 'function') {
        window.estackEq8QControl = function estackEq8QControlKeyboard(slot, entry, q) {
            const root = document.createElement('div');
            root.className = 'estack-eq8-q-control';
            root.style.minWidth = '0';
            root.style.width = '100%';

            const head = document.createElement('div');
            head.className = 'estack-eq8-q-head';
            // The old CSS only set min-width on the readout. Once it became an
            // input, the browser's intrinsic text-input width overflowed into the
            // next PEQ strip. Explicit compact sizing keeps every Q field local.
            head.style.minWidth = '0';
            head.style.width = '100%';
            head.style.gap = '4px';
            head.style.overflow = 'hidden';

            const label = document.createElement('span');
            label.className = 'estack-eq8-q-label';
            label.textContent = 'Q';
            label.style.flex = '0 0 auto';

            const number = document.createElement('input');
            number.type = 'text';
            number.className = 'estack-eq8-q-value';
            number.inputMode = 'decimal';
            number.autocomplete = 'off';
            number.spellcheck = false;
            number.setAttribute('aria-label', `PEQ ${Number(slot) + 1} Q`);
            number.setAttribute('data-q-step', String(Q_INCREMENT));
            number.style.boxSizing = 'border-box';
            number.style.width = '42px';
            number.style.maxWidth = 'calc(100% - 12px)';
            number.style.minWidth = '0';
            number.style.height = '17px';
            number.style.padding = '1px 2px';
            number.style.flex = '0 1 42px';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'estack-eq8-q';
            slider.min = '0';
            slider.max = '1000';
            slider.step = '1';
            slider.style.minWidth = '0';
            slider.style.width = '100%';
            slider.setAttribute('aria-valuetext', `${quantizeQ(q).toFixed(2)} Q`);

            let current = clampQ(q);
            let lastCommitted = current;

            const updateDspPreview = next => {
                current = clampQ(next, current);
                if (entry?.[1]?.parameters) {
                    entry[1].parameters.q = current;
                    if (typeof window.drawGraph === 'function') window.drawGraph();
                }
            };

            const render = next => {
                updateDspPreview(next);
                number.value = current.toFixed(2);
                slider.value = String(qToSlider(current));
                slider.setAttribute('aria-valuetext', `${current.toFixed(2)} Q`);
            };

            const commit = async next => {
                render(next);
                if (Math.abs(current - lastCommitted) < 0.0001) return;
                const committed = current;
                if (typeof window.estackCommitPeqValue === 'function') {
                    await window.estackCommitPeqValue(slot, 'q', committed);
                }
                lastCommitted = committed;
            };

            slider.value = String(qToSlider(current));
            number.value = current.toFixed(2);

            slider.addEventListener('input', () => {
                const next = sliderToQ(slider.value);
                updateDspPreview(next);
                number.value = next.toFixed(2);
                slider.setAttribute('aria-valuetext', `${next.toFixed(2)} Q`);
            });
            slider.addEventListener('change', () => commit(sliderToQ(slider.value)));

            number.addEventListener('input', () => {
                const text = String(number.value || '').trim().replace(',', '.');
                if (!text || text === '.' || text === '-') return;
                const next = Number(text);
                if (!Number.isFinite(next)) return;
                current = Math.max(Q_MIN, Math.min(Q_MAX, next));
                slider.value = String(qToSlider(current));
                slider.setAttribute('aria-valuetext', `${current.toFixed(2)} Q`);
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

                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    const direction = event.key === 'ArrowUp' ? 1 : -1;
                    const next = quantizeQ(current + direction * Q_INCREMENT);
                    render(next);
                    commit(next);
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
        if (!isAdvancedQInput(target) && !isGlobalQInput(target)) return null;
        const next = clampQ(target.value, target.defaultValue || 0.7);
        target.value = next.toFixed(2);
        return next;
    }

    // Advanced's legacy filter editor sends generic numeric text as strings.
    // Intercept Q before that handler and use its existing filter/upload objects
    // directly so CamillaDSP receives a real number.
    document.addEventListener('change', event => {
        const target = event.target;
        if (isAdvancedQInput(target)) {
            const next = normalizeExistingQ(target);
            if (!Number.isFinite(next)) return;
            event.stopImmediatePropagation();

            const filter = target.filter;
            if (!filter || typeof filter.setFilterParameter !== 'function') return;
            filter.setFilterParameter(target.id, next);
            const editor = target.parentElement?.parentElement;
            editor?.dispatchEvent?.(new Event('updated'));
            Promise.resolve(filter.uploadToDSP?.()).catch(error => {
                console.error('Advanced Q upload failed', error);
            });
            return;
        }

        // Global EQ already converts to Number in its commit path; just normalize
        // decimal syntax/range before that existing change handler runs.
        if (isGlobalQInput(target)) normalizeExistingQ(target);
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
