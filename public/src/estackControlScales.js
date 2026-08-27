// E-Stack Control gain scale + custom fader handle.
//
// The visible GAIN scale and the visible fader handle are intentionally derived
// from one fixed mathematical axis. They do not depend on browser range-thumb
// geometry or DOM measurements. This guarantees that a 0.0 dB fader value and
// the printed 0 dB tick always have the exact same Y coordinate.

const ESTACK_GAIN_AXIS_TOP = 4;
const ESTACK_GAIN_AXIS_BOTTOM = 242;
const ESTACK_GAIN_AXIS_TRAVEL = ESTACK_GAIN_AXIS_BOTTOM - ESTACK_GAIN_AXIS_TOP;

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

function estackGainValueY(fader, value) {
    const min = Number(fader.min);
    const max = Number(fader.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return ESTACK_GAIN_AXIS_TOP;
    }

    const clamped = Math.max(min, Math.min(max, Number(value)));
    const ratio = (max - clamped) / (max - min);
    return ESTACK_GAIN_AXIS_TOP + ratio * ESTACK_GAIN_AXIS_TRAVEL;
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

function estackEnsureGainScale(fader) {
    const center = fader.closest('.estack-strip-center');
    if (!center) return null;

    let scale = center.querySelector('.estack-gain-scale');
    if (!scale) {
        scale = document.createElement('div');
        scale.className = 'estack-gain-scale';
        scale.setAttribute('aria-hidden', 'true');
        center.appendChild(scale);
    }
    return scale;
}

function estackPositionVisualHandle(fader) {
    const wrap = fader.closest('.estack-fader-wrap');
    if (!wrap) return;
    const handle = estackEnsureVisualHandle(fader, wrap);
    handle.style.top = `${estackGainValueY(fader, Number(fader.value))}px`;
}

function estackBuildGainScale(fader) {
    const scale = estackEnsureGainScale(fader);
    if (!scale) return;

    const min = Number(fader.min);
    const max = Number(fader.max);
    const fragment = document.createDocumentFragment();

    for (const value of estackGainScaleValues(min, max)) {
        const tick = document.createElement('span');
        tick.dataset.value = String(value);
        tick.textContent = estackFormatGainTick(value);
        tick.classList.toggle('unity', Math.abs(value) < 1e-9);
        tick.classList.toggle('maximum', Math.abs(value - max) < 1e-9);
        tick.style.top = `${estackGainValueY(fader, value)}px`;
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
