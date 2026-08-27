// E-Stack Control — single mathematical axis for dBFS labels, GAIN labels and
// the visible gain handle. No browser range geometry and no DOM measurements.

const ESTACK_AXIS_TOP = 4;
const ESTACK_AXIS_BOTTOM = 242;
const ESTACK_AXIS_TRAVEL = ESTACK_AXIS_BOTTOM - ESTACK_AXIS_TOP;

function estackLinearY(value, min, max) {
    const lo = Number(min);
    const hi = Number(max);
    const val = Number(value);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return ESTACK_AXIS_TOP;
    const clamped = Math.max(lo, Math.min(hi, Number.isFinite(val) ? val : lo));
    const ratio = (hi - clamped) / (hi - lo);
    return ESTACK_AXIS_TOP + ratio * ESTACK_AXIS_TRAVEL;
}

function estackFormatGainTick(value) {
    const n = Number(value);
    if (n > 0) return `+${Number.isInteger(n) ? n : n.toFixed(1)}`;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function estackGainScaleValues(min, max) {
    const candidates = [Number(max), 0, -6, -12, -24, -40, Number(min)];
    const seen = new Set();
    return candidates
        .filter(value => Number.isFinite(value) && value >= Number(min) && value <= Number(max))
        .filter(value => {
            const key = value.toFixed(4);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => b - a);
}

function estackPositionDbfsScale(consoleEl) {
    const scale = consoleEl.querySelector('.estack-dbfs-scale');
    if (!scale) return;
    scale.querySelectorAll('span[data-value]').forEach(tick => {
        tick.style.top = `${estackLinearY(Number(tick.dataset.value), -60, 0)}px`;
    });
}

function estackBuildGainScale(fader) {
    const consoleEl = fader.closest('.estack-meter-console');
    const scale = consoleEl?.querySelector('.estack-gain-scale');
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
        tick.style.top = `${estackLinearY(value, min, max)}px`;
        fragment.appendChild(tick);
    }

    scale.replaceChildren(fragment);
}

function estackPositionHandle(fader) {
    const core = fader.closest('.estack-meter-core');
    const handle = core?.querySelector('.estack-fader-handle');
    if (!handle) return;
    handle.style.top = `${estackLinearY(Number(fader.value), Number(fader.min), Number(fader.max))}px`;
}

function estackSyncControlFaderVisual(fader) {
    if (!fader?.classList?.contains('estack-vertical-fader')) return;
    estackPositionHandle(fader);
}

function estackDecorateFader(fader) {
    if (!fader) return;
    const consoleEl = fader.closest('.estack-meter-console');
    if (!consoleEl) return;

    estackPositionDbfsScale(consoleEl);
    estackBuildGainScale(fader);
    estackPositionHandle(fader);

    if (fader.dataset.estackUnifiedScaleAttached === 'true') return;
    fader.dataset.estackUnifiedScaleAttached = 'true';
    const sync = () => estackPositionHandle(fader);
    fader.addEventListener('input', sync);
    fader.addEventListener('change', sync);
    fader.addEventListener('keydown', () => requestAnimationFrame(sync));
}

function estackRefreshControlScales() {
    const faders = [...document.querySelectorAll('.estack-vertical-fader')];
    faders.forEach(estackDecorateFader);
    return faders.length;
}

window.estackSyncControlFaderVisual = estackSyncControlFaderVisual;
window.estackRefreshControlScales = estackRefreshControlScales;

function estackInitControlScales() {
    let attempts = 0;
    const maxAttempts = 30;
    const tryBuild = () => {
        attempts += 1;
        const count = estackRefreshControlScales();
        if (count > 0 || attempts >= maxAttempts) return;
        setTimeout(tryBuild, 100);
    };
    requestAnimationFrame(tryBuild);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', estackInitControlScales, { once: true });
} else {
    estackInitControlScales();
}
