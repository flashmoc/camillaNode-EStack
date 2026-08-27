// E-Stack Control — single UI engine for output faders.
// Owns GAIN labels, dedicated 0 dB marker, custom handle, pointer interaction
// and direct numeric entry. All vertical positions share one mathematical axis.

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
    return ESTACK_AXIS_TOP + ((hi - clamped) / (hi - lo)) * ESTACK_AXIS_TRAVEL;
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
    const scale = consoleEl?.querySelector('.estack-dbfs-scale');
    if (!scale) return;
    scale.querySelectorAll('span[data-value]').forEach(tick => {
        tick.style.top = `${estackLinearY(Number(tick.dataset.value), -60, 0)}px`;
    });
}

function estackGainScaleForFader(fader) {
    const consoleEl = fader?.closest('.estack-meter-console');
    const core = fader?.closest('.estack-meter-core');
    const scale = consoleEl?.querySelector('.estack-gain-scale');
    if (!core || !scale) return null;
    if (scale.parentElement !== core) core.appendChild(scale);
    return scale;
}

function estackBuildGainScale(fader) {
    const scale = estackGainScaleForFader(fader);
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

function estackEnsureUnityMarker(fader) {
    const core = fader?.closest('.estack-meter-core');
    if (!core) return;
    let marker = core.querySelector('.estack-unity-marker');
    if (!marker) {
        marker = document.createElement('div');
        marker.className = 'estack-unity-marker';
        marker.setAttribute('aria-hidden', 'true');
        core.appendChild(marker);
    }
    const min = Number(fader.min);
    const max = Number(fader.max);
    if (min <= 0 && max >= 0) {
        marker.hidden = false;
        marker.style.top = `${estackLinearY(0, min, max)}px`;
    } else {
        marker.hidden = true;
    }
}

function estackPositionHandle(fader) {
    const core = fader?.closest('.estack-meter-core');
    const handle = core?.querySelector('.estack-fader-handle');
    if (!handle) return;
    handle.style.top = `${estackLinearY(Number(fader.value), Number(fader.min), Number(fader.max))}px`;
}

function estackNumericForFader(fader) {
    return fader?.closest('.estack-mixer-strip')?.querySelector('.estack-fader-number') || null;
}

function estackSyncNumeric(fader) {
    const numeric = estackNumericForFader(fader);
    if (!numeric || document.activeElement === numeric) return;
    numeric.value = Number(fader.value).toFixed(1);
}

function estackSyncControlFaderVisual(fader) {
    if (!fader?.classList?.contains('estack-vertical-fader')) return;
    estackEnsureUnityMarker(fader);
    estackPositionHandle(fader);
    estackSyncNumeric(fader);
}

function estackValueFromClientY(fader, core, clientY) {
    const min = Number(fader.min);
    const max = Number(fader.max);
    const step = Math.max(0.000001, Number(fader.step) || 0.1);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return min;

    const rect = core.getBoundingClientRect();
    const localY = Math.max(ESTACK_AXIS_TOP, Math.min(ESTACK_AXIS_BOTTOM, clientY - rect.top));
    const ratio = (localY - ESTACK_AXIS_TOP) / ESTACK_AXIS_TRAVEL;
    let value = max - ratio * (max - min);
    value = Math.round(value / step) * step;
    value = Math.max(min, Math.min(max, value));
    if (min <= 0 && max >= 0 && Math.abs(value) <= ESTACK_GAIN_ZERO_SNAP_DB) value = 0;

    const decimals = Math.max(0, (String(step).split('.')[1] || '').length);
    return Number(value.toFixed(Math.min(6, decimals)));
}

function estackSetFaderFromPointer(fader, core, clientY, commit = false) {
    const next = estackValueFromClientY(fader, core, clientY);
    if (Number(fader.value) !== next) {
        fader.value = String(next);
        fader.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        estackSyncControlFaderVisual(fader);
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

function estackClampNumber(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

function estackAttachNumericControl(fader) {
    if (fader.dataset.numericAttached === 'true') return;
    const strip = fader.closest('.estack-mixer-strip');
    const valueBox = strip?.querySelector('.estack-fader-value');
    if (!strip || !valueBox) return;
    fader.dataset.numericAttached = 'true';

    const wrap = document.createElement('div');
    wrap.className = 'estack-fader-number-wrap';
    const numeric = document.createElement('input');
    numeric.type = 'number';
    numeric.className = 'estack-fader-number';
    numeric.min = fader.min;
    numeric.max = fader.max;
    numeric.step = fader.step;
    numeric.value = Number(fader.value).toFixed(1);
    numeric.inputMode = 'decimal';
    numeric.setAttribute('aria-label', `${strip.querySelector('.estack-strip-head strong')?.textContent || 'Channel'} gain in dB`);
    const unit = document.createElement('span');
    unit.textContent = 'dB';
    wrap.append(numeric, unit);
    valueBox.insertAdjacentElement('afterend', wrap);

    const preview = () => {
        const next = estackClampNumber(numeric.value, Number(fader.min), Number(fader.max));
        fader.value = String(next);
        fader.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const commit = () => {
        preview();
        numeric.value = Number(fader.value).toFixed(1);
        fader.dispatchEvent(new Event('change', { bubbles: true }));
    };
    numeric.addEventListener('input', preview);
    numeric.addEventListener('change', commit);
    numeric.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
        numeric.blur();
    });
}

function estackDecorateFader(fader) {
    if (!fader) return;
    const consoleEl = fader.closest('.estack-meter-console');
    if (!consoleEl) return;
    estackPositionDbfsScale(consoleEl);
    estackBuildGainScale(fader);
    estackEnsureUnityMarker(fader);
    estackPositionHandle(fader);
    estackAttachPointerControl(fader);
    estackAttachNumericControl(fader);

    if (fader.dataset.estackUnifiedAttached === 'true') return;
    fader.dataset.estackUnifiedAttached = 'true';
    const sync = () => estackSyncControlFaderVisual(fader);
    fader.addEventListener('input', sync);
    fader.addEventListener('change', sync);
    fader.addEventListener('keydown', () => requestAnimationFrame(sync));
}

function estackRefreshControlUI() {
    const faders = [...document.querySelectorAll('.estack-vertical-fader')];
    faders.forEach(estackDecorateFader);
    faders.forEach(estackSyncControlFaderVisual);
    return faders.length;
}

window.estackSyncControlFaderVisual = estackSyncControlFaderVisual;
window.estackRefreshControlUI = estackRefreshControlUI;
window.estackRefreshControlScales = estackRefreshControlUI;

function estackInitControlUI() {
    let attempts = 0;
    const tryBuild = () => {
        attempts += 1;
        const count = estackRefreshControlUI();
        if (count > 0 || attempts >= 30) return;
        setTimeout(tryBuild, 100);
    };
    requestAnimationFrame(tryBuild);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', estackInitControlUI, { once: true });
} else {
    estackInitControlUI();
}
