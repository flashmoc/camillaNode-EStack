// Calibrated gain scales + visual fader handles for E-Stack Control.
//
// IMPORTANT: the browser's native vertical range thumb is NOT used as a visual
// reference. Chrome/Firefox can map vertical range thumbs with slightly
// different internal geometry. We keep the range input for mouse/keyboard
// interaction, but draw our own handle and every GAIN tick from this one shared
// value->Y function. Therefore 0.0 dB and the 0 tick are always identical.

const ESTACK_CONTROL_HANDLE_PX = 5;
const ESTACK_CONTROL_FADER_HEIGHT_PX = 236;

function estackGainScaleValues(min, max) {
    const candidates = [max, 0, -6, -12, -24, -40, min];
    const seen = new Set();
    return candidates
        .map(Number)
        .filter(value => Number.isFinite(value) && value >= min && value <= max)
        .filter(value => {
            const key = value.toFixed(4);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => b - a);
}

function estackFormatGainTick(value) {
    const n = Number(value);
    if (n > 0) return `+${Number.isInteger(n) ? n : n.toFixed(1)}`;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function estackFaderGeometry(fader, wrap) {
    const wrapHeight = wrap?.clientHeight || 246;
    const faderHeight = fader?.clientHeight || ESTACK_CONTROL_FADER_HEIGHT_PX;
    const actualFaderHeight = Math.min(faderHeight, wrapHeight);
    const inset = Math.max(0, (wrapHeight - actualFaderHeight) / 2);
    const halfHandle = ESTACK_CONTROL_HANDLE_PX / 2;
    const top = inset + halfHandle;
    const bottom = wrapHeight - inset - halfHandle;
    return {
        top,
        bottom,
        travel: Math.max(0, bottom - top)
    };
}

function estackFaderValueY(fader, wrap, value) {
    const min = Number(fader.min);
    const max = Number(fader.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;

    const geometry = estackFaderGeometry(fader, wrap);
    const clamped = Math.max(min, Math.min(max, Number(value)));
    const ratio = (max - clamped) / (max - min);
    return geometry.top + ratio * geometry.travel;
}

function estackEnsureVisualHandle(fader, wrap) {
    let handle = wrap.querySelector('.estack-fader-handle');
    if (!handle) {
        handle = document.createElement('div');
        handle.className = 'estack-fader-handle';
        handle.setAttribute('aria-hidden', 'true');
        wrap.appendChild(handle);
    }
    return handle;
}

function estackPositionVisualHandle(fader) {
    const wrap = fader.closest('.estack-fader-wrap');
    if (!wrap) return;
    const handle = estackEnsureVisualHandle(fader, wrap);
    handle.style.top = `${estackFaderValueY(fader, wrap, Number(fader.value))}px`;
}

function estackBuildGainScale(fader) {
    const wrap = fader.closest('.estack-fader-wrap');
    if (!wrap) return;

    let scale = wrap.querySelector('.estack-gain-scale');
    if (!scale) {
        scale = document.createElement('div');
        scale.className = 'estack-gain-scale';
        scale.setAttribute('aria-hidden', 'true');
        wrap.appendChild(scale);
    }

    const min = Number(fader.min);
    const max = Number(fader.max);
    const values = estackGainScaleValues(min, max);

    const fragment = document.createDocumentFragment();
    for (const value of values) {
        const tick = document.createElement('span');
        tick.dataset.value = String(value);
        tick.textContent = estackFormatGainTick(value);
        tick.classList.toggle('unity', Math.abs(value) < 1e-9);
        tick.classList.toggle('maximum', Math.abs(value - max) < 1e-9);
        tick.style.top = `${estackFaderValueY(fader, wrap, value)}px`;
        fragment.appendChild(tick);
    }
    scale.replaceChildren(fragment);

    estackPositionVisualHandle(fader);
    wrap.dataset.gainRange = `${estackFormatGainTick(max)}…${estackFormatGainTick(min)}`;
}

function estackAttachFaderVisualSync(fader) {
    if (fader.dataset.estackVisualHandle === 'true') return;
    fader.dataset.estackVisualHandle = 'true';

    const sync = () => estackPositionVisualHandle(fader);
    fader.addEventListener('input', sync);
    fader.addEventListener('change', sync);
    fader.addEventListener('keydown', () => requestAnimationFrame(sync));
}

function estackRefreshGainScales() {
    const faders = [...document.querySelectorAll('.estack-vertical-fader')];
    for (const fader of faders) {
        estackAttachFaderVisualSync(fader);
        estackBuildGainScale(fader);
    }
    return faders.length;
}

function estackInitGainScales() {
    // estackBasic.js creates the strips asynchronously after the DSP config is
    // downloaded. Bounded retries avoid MutationObserver render loops.
    let attempts = 0;
    const maxAttempts = 24;

    const tryBuild = () => {
        attempts += 1;
        const count = estackRefreshGainScales();
        if (count > 0 || attempts >= maxAttempts) return;
        setTimeout(tryBuild, 100);
    };

    requestAnimationFrame(tryBuild);

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(estackRefreshGainScales);
    }, { passive: true });

    // Programmatic linked-gain previews change another range's value without a
    // native pointer event. Re-sync the custom handle after any Control input.
    document.addEventListener('input', event => {
        if (!event.target?.classList?.contains('estack-vertical-fader')) return;
        requestAnimationFrame(() => {
            document.querySelectorAll('.estack-vertical-fader').forEach(estackPositionVisualHandle);
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', estackInitGainScales, { once: true });
} else {
    estackInitGainScales();
}
