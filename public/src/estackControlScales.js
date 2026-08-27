// Calibrated gain scales for the integrated E-Stack Control meter/faders.
// The left scale belongs to the playback meter (dBFS). This module adds a
// separate right-hand GAIN scale whose tick positions are derived from each
// fader's actual min/max and from the real slider thumb travel geometry.
//
// IMPORTANT: do not observe mutations inside the scale itself. Rebuilding the
// scale changes child nodes; observing those mutations caused a render loop and
// froze the Control page after the meter-scale update.

const ESTACK_CONTROL_THUMB_PX = 12;

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

function estackFaderValueY(fader, wrap, value) {
    const min = Number(fader.min);
    const max = Number(fader.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;

    const wrapRect = wrap.getBoundingClientRect();
    const faderRect = fader.getBoundingClientRect();
    const insetTop = faderRect.top - wrapRect.top;
    const thumb = Math.min(ESTACK_CONTROL_THUMB_PX, faderRect.height);
    const travel = Math.max(0, faderRect.height - thumb);
    const ratio = (max - Number(value)) / (max - min);
    return insetTop + thumb / 2 + Math.max(0, Math.min(1, ratio)) * travel;
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

    // Build off-DOM, then replace once. No observer watches this subtree.
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

    if (min <= 0 && max >= 0) {
        wrap.style.setProperty('--estack-unity-px', `${estackFaderValueY(fader, wrap, 0)}px`);
    }

    wrap.dataset.gainRange = `${estackFormatGainTick(max)}…${estackFormatGainTick(min)}`;
}

function estackRefreshGainScales() {
    const faders = [...document.querySelectorAll('.estack-vertical-fader')];
    faders.forEach(estackBuildGainScale);
    return faders.length;
}

function estackInitGainScales() {
    // estackBasic.js builds the strips asynchronously after downloading the DSP
    // config. Use bounded retries instead of a MutationObserver so scale drawing
    // can never recursively trigger itself.
    let attempts = 0;
    const maxAttempts = 20;

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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', estackInitGainScales, { once: true });
} else {
    estackInitGainScales();
}
