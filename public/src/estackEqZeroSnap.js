// Perceptible 0 dB detent for bipolar EQ/output gain controls.
// Frequency, Q, delay and limiter ceiling remain unaffected.

function estackZeroDetent(min, max, step) {
    const s = Math.abs(Number(step)) || 0.1;
    if (!(Number(min) < 0 && Number(max) > 0)) return 0;
    const span = Math.abs(Number(max) - Number(min));
    return Math.max(s * 2, Math.min(0.8, span * 0.02));
}

function estackZeroSnapKnobValue(value, min, max, step) {
    let next = Math.min(max, Math.max(min, Number(value)));
    const s = Number(step) || 1;
    next = Math.round(next / s) * s;
    const detent = estackZeroDetent(min, max, step);
    if (detent && Math.abs(next) <= detent) next = 0;
    return next;
}

if (typeof estackEq8MakeKnob === "function") {
    estackEq8MakeKnob = function({ label, value, min, max, step, logarithmic = false, unit = "", resetValue, preview, commit }) {
        const root = document.createElement("div");
        root.className = "estack-eq8-knob-control";

        const labelEl = document.createElement("span");
        labelEl.className = "estack-eq8-knob-label";
        labelEl.textContent = label;

        const knob = document.createElement("div");
        knob.className = "estack-eq8-knob";
        knob.tabIndex = 0;
        knob.setAttribute("role", "slider");
        knob.setAttribute("aria-label", label);
        knob.setAttribute("aria-valuemin", String(min));
        knob.setAttribute("aria-valuemax", String(max));
        if (min < 0 && max > 0) knob.title = "0 dB detent · double-click resets";

        const marker = document.createElement("span");
        marker.className = "estack-eq8-knob-marker";
        knob.appendChild(marker);

        const numberRow = document.createElement("div");
        numberRow.className = "estack-eq8-number-row";
        const number = document.createElement("input");
        number.type = "number";
        number.className = "estack-eq8-number";
        number.min = min;
        number.max = max;
        number.step = step;
        number.inputMode = "decimal";
        const unitEl = document.createElement("span");
        unitEl.className = "estack-eq8-unit";
        unitEl.textContent = unit;
        numberRow.append(number, unitEl);

        let current = estackZeroSnapKnobValue(value, min, max, step);
        let dragStartY = 0;
        let dragStartNorm = 0;
        let dragging = false;
        let wheelCommitTimer;
        let keyCommitTimer;

        const render = () => {
            const norm = estackEq8Norm(current, min, max, logarithmic);
            const angle = -135 + norm * 270;
            knob.style.setProperty("--angle", `${angle}deg`);
            knob.setAttribute("aria-valuenow", String(current));
            number.value = step < 1 ? Number(current).toFixed(step <= .01 ? 2 : 1) : String(Math.round(current));
        };

        const setCurrent = (next, doPreview = true) => {
            current = estackZeroSnapKnobValue(next, min, max, step);
            render();
            if (doPreview && preview) preview(current);
        };

        const commitCurrent = async () => {
            if (commit) await commit(current);
        };

        knob.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            knob.focus({ preventScroll: true });
            dragging = true;
            dragStartY = event.clientY;
            dragStartNorm = estackEq8Norm(current, min, max, logarithmic);
            knob.setPointerCapture(event.pointerId);
        });

        knob.addEventListener("pointermove", event => {
            if (!dragging) return;
            const sensitivity = event.shiftKey ? 520 : 190;
            const nextNorm = dragStartNorm + (dragStartY - event.clientY) / sensitivity;
            setCurrent(estackEq8FromNorm(nextNorm, min, max, logarithmic));
        });

        const finishDrag = async event => {
            if (!dragging) return;
            dragging = false;
            try { knob.releasePointerCapture(event.pointerId); } catch (_) {}
            await commitCurrent();
        };
        knob.addEventListener("pointerup", finishDrag);
        knob.addEventListener("pointercancel", finishDrag);

        knob.addEventListener("wheel", event => {
            event.preventDefault();
            knob.focus({ preventScroll: true });
            const norm = estackEq8Norm(current, min, max, logarithmic);
            const amount = event.shiftKey ? .004 : .015;
            setCurrent(estackEq8FromNorm(norm + (event.deltaY < 0 ? amount : -amount), min, max, logarithmic));
            clearTimeout(wheelCommitTimer);
            wheelCommitTimer = setTimeout(commitCurrent, 220);
        }, { passive: false });

        knob.addEventListener("keydown", event => {
            if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "Home") setCurrent(min);
            else if (event.key === "End") setCurrent(max);
            else {
                const norm = estackEq8Norm(current, min, max, logarithmic);
                const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : -1;
                setCurrent(estackEq8FromNorm(norm + direction * (event.shiftKey ? .004 : .015), min, max, logarithmic));
            }
            clearTimeout(keyCommitTimer);
            keyCommitTimer = setTimeout(commitCurrent, 130);
        });

        knob.addEventListener("dblclick", () => {
            setCurrent(resetValue);
            commitCurrent();
        });

        number.addEventListener("change", () => {
            setCurrent(number.value);
            commitCurrent();
        });
        number.addEventListener("keydown", event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            setCurrent(number.value);
            commitCurrent();
            number.blur();
        });

        render();
        root.append(labelEl, knob, numberRow);
        return root;
    };
}

if (typeof estackCommitPeqValue === "function") {
    const estackZeroSnapBaseCommit = estackCommitPeqValue;
    estackCommitPeqValue = async function(slot, key, value) {
        if (key === "gain" && Math.abs(Number(value)) <= 0.8) value = 0;
        return estackZeroSnapBaseCommit(slot, key, value);
    };
}

if (typeof estackV2PointerToParams === "function") {
    const estackZeroSnapBasePointer = estackV2PointerToParams;
    estackV2PointerToParams = function(event) {
        const params = estackZeroSnapBasePointer(event);
        if (Math.abs(Number(params.gain)) <= 0.8) params.gain = 0;
        return params;
    };
}
