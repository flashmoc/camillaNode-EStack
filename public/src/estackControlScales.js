// E-Stack Control — one mathematical axis for dBFS labels, GAIN labels,
// custom visual handles and mouse/touch interaction.
//
// The native vertical range is kept only as the value/focus/keyboard source.
// Pointer interaction is handled by .estack-meter-core so browser-specific
// vertical range geometry can never force the value to the minimum.

const ESTACK_AXIS_TOP = 4;
const ESTACK_AXIS_BOTTOM = 242;
const ESTACK_AXIS_TRAVEL = ESTACK_AXIS_BOTTOM - ESTACK_AXIS_TOP;
const ESTACK_GAIN_ZERO_SNAP_DB = 0.8;

function estackLinearY(value, min, max) {
    const lo = Number(min);
    const hi = Number(max);
    const val = Number(value);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return ESTACK_AXIS_TOP;
    const clamped = Math.max(lo, Math.min(hi, Number.isFinite(val) ? val : lo));
    const ratio = (hi - clamped) / (hi - lo);
    return ESTACK_AXIS_TOP + ratio * ESTACK_AXIS_TRAVEL;
}

function estackValueFromClientY(fader, core, clientY) {
    const min = Number(fader.min);
    const max = Number(fader.max);
    const step = Math.max(0.000001, Number(fader.step) || 0.1);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return min;

    const rect = core.getBoundingClientRect();
    // CSS and JS share the same 4..242 px axis inside the 246 px core.
    const localY = Math.max(ESTACK_AXIS_TOP, Math.min(ESTACK_AXIS_BOTTOM, clientY - rect.top));
    const ratio = (localY - ESTACK_AXIS_TOP) / ESTACK_AXIS_TRAVEL;
    let value = max - ratio * (max - min);

    value = Math.round(value / step) * step;
    value = Math.max(min, Math.min(max, value));

    // Soft detent around unity for gain controls.
    if (min <= 0 && max >= 0 && Math.abs(value) <= ESTACK_GAIN_ZERO_SNAP_DB) value = 0;

    // Avoid floating-point tails such as -8.799999999.
    const decimals = Math.max(0, (String(step).split('.')[1] || '').length);
    return Number(value.toFixed(Math.min(6, decimals)));
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

function estackSetFaderFromPointer(fader, core, clientY, commit = false) {
    const next = estackValueFromClientY(fader, core, clientY);
    if (Number(fader.value) !== next) {
        fader.value = String(next);
        fader.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        estackPositionHandle(fader);
    }
    if (commit) fader.dispatchEvent(new Event('change', { bubbles: true }));
}

function estackAttachPointerControl(fader) {
    if (fader.dataset.estackPointerAttached === 'true') return;
    const core = fader.closest('.estack-meter-core');
    if (!core) return;

    fader.dataset.estackPointerAttached = 'true';
    let activePointer = null;

    core.addEventListener('pointerdown', event => {
        if (fader.disabled || event.button > 0) return;
        event.preventDefault();
        activePointer = event.pointerId;
        core.setPointerCapture?.(event.pointerId);
        fader.focus({ preventScroll: true });
        estackSetFaderFromPointer(fader, core, event.clientY, false);
    });

    core.addEventListener('pointermove', event => {
        if (activePointer !== event.pointerId || fader.disabled) return;
        event.preventDefault();
        estackSetFaderFromPointer(fader, core, event.clientY, false);
    });

    const finish = event => {
        if (activePointer !== event.pointerId) return;
        event.preventDefault();
        estackSetFaderFromPointer(fader, core, event.clientY, true);
        try { core.releasePointerCapture?.(event.pointerId); } catch (_) {}
        activePointer = null;
    };

    core.addEventListener('pointerup', finish);
    core.addEventListener('pointercancel', event => {
        if (activePointer !== event.pointerId) return;
        try { core.releasePointerCapture?.(event.pointerId); } catch (_) {}
        activePointer = null;
    });
}

function estackDecorateFader(fader) {
    if (!fader) return;
    const consoleEl = fader.closest('.estack-meter-console');
    if (!consoleEl) return;

    estackPositionDbfsScale(consoleEl);
    estackBuildGainScale(fader);
    estackPositionHandle(fader);
    estackAttachPointerControl(fader);

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
