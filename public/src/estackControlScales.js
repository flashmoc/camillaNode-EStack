// Calibrated gain scales + visual fader handles for E-Stack Control.
//
// The browser range input is only an interaction surface. It is never used as
// a visual geometry reference. Every GAIN tick and the visible handle use the
// same fixed value -> Y mapping inside the 246 px fader wrap.

const ESTACK_CONTROL_WRAP_HEIGHT_PX = 246;
const ESTACK_CONTROL_VISUAL_TOP_PX = 3;
const ESTACK_CONTROL_VISUAL_BOTTOM_PX = 243;

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

function estackFaderValueY(fader, value) {
    const min = Number(fader.min);
    const max = Number(fader.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return ESTACK_CONTROL_VISUAL_TOP_PX;
    }

    const clamped = Math.max(min, Math.min(max, Number(value)));
    const ratio = (max - clamped) / (max - min);
    const travel = ESTACK_CONTROL_VISUAL_BOTTOM_PX - ESTACK_CONTROL_VISUAL_TOP_PX;
    return ESTACK_CONTROL_VISUAL_TOP_PX + ratio * travel;
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
    handle.style.top = `${estackFaderValueY(fader, Number(fader.value))}px`;
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
    const fragment = document.createDocumentFragment();

    for (const value of estackGainScaleValues(min, max)) {
        const tick = document.createElement('span');
        tick.dataset.value = String(value);
        tick.textContent = estackFormatGainTick(value);
        tick.classList.toggle('unity', Math.abs(value) < 1e-9);
        tick.classList.toggle('maximum', Math.abs(value - max) < 1e-9);
        tick.style.top = `${estackFaderValueY(fader, value)}px`;
        fragment.appendChild(tick);
    }

    scale.replaceChildren(fragment);
    estackPositionVisualHandle(fader);
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
