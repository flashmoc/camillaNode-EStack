// Final E-Stack PEQ behaviour fixes.
// 1) The per-output EQ graph shows only output-local DSP filters. GLOBAL_EQ_*
//    remains pre-routing in CamillaDSP, but is intentionally edited/visualized
//    only on the Global EQ page.
// 2) All ten PEQ slots are selectable and draggable, including empty/disabled
//    slots. Empty filters are created lazily only when the user actually moves
//    a graph point or edits a control.

function estackLocalGraphEntries(channel) {
    return filterEntries(channel).filter(([name, filter]) =>
        !String(name).startsWith("GLOBAL_EQ_") &&
        ["BiquadCombo", "Biquad", "Gain"].includes(filter?.type)
    );
}

// Replace the V4 response renderer with a local-output-only response. This is
// an editor view, not the complete acoustic cascade: Global EQ has its own page.
if (typeof canvasSetup === "function" && typeof activeChannels === "function") {
    drawGraph = function() {
        if (typeof DSP === "undefined" || !DSP) return;
        const { ctx, width, height } = canvasSetup();
        const margin = { left: 50, right: 18, top: 18, bottom: 31 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const range = { min: -60, max: 12, step: 10 };

        ctx.clearRect(0, 0, width, height);
        if (typeof estackV4GraphBackground === "function") estackV4GraphBackground(ctx, width, height);
        if (typeof estackDrawRtaOverlay === "function") estackDrawRtaOverlay(ctx, margin, innerW, innerH);
        if (typeof drawGrid === "function") drawGrid(ctx, margin, innerW, innerH, range);

        const freqs = logFrequencies(20, 20000, 520);
        const channels = activeChannels();
        const order = channels.filter(ch => ch !== selectedChannel).concat(
            channels.includes(selectedChannel) ? [selectedChannel] : []
        );

        for (const channel of order) {
            const entries = estackLocalGraphEntries(channel);
            const values = freqs.map(freq => sumDb(entries, freq));
            if (typeof estackDrawResponseCurve === "function") {
                estackDrawResponseCurve(ctx, freqs, values, margin, innerW, innerH, range, channel, channel === selectedChannel);
            }
        }

        const zeroY = margin.top + dbToY(0, innerH, range);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, zeroY);
        ctx.lineTo(margin.left + innerW, zeroY);
        ctx.stroke();
        ctx.restore();

        if (typeof estackRenderLegend === "function") estackRenderLegend();
        if (typeof estackDrawPeqMarkers === "function") estackDrawPeqMarkers();
    };
}

function estackFixedPeqPointPositions() {
    const canvas = document.getElementById("responseCanvas");
    if (!canvas || typeof ESTACK_PEQ_COUNT === "undefined") return [];
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 50, right: 18, top: 18, bottom: 31 };
    const innerW = rect.width - margin.left - margin.right;
    const innerH = rect.height - margin.top - margin.bottom;
    const range = graphRange();
    const slots = mapPeqSlots();

    return Array.from({ length: ESTACK_PEQ_COUNT }, (_, slot) => {
        const entry = slots[slot] || null;
        const p = entry?.[1]?.parameters || {};
        const freq = Number(p.freq || ESTACK_PEQ_DEFAULT_FREQS[slot]);
        const gain = Number(p.gain || 0);
        return {
            slot,
            entry,
            x: margin.left + freqToX(clamp(freq, 20, 20000), innerW),
            y: margin.top + dbToY(clamp(gain, range.min, range.max), innerH, range)
        };
    });
}

// Keep any code that asks for V2 point positions consistent with what is
// actually drawn. Unlike the old function, empty bands are included.
if (typeof estackV2PointPositions === "function") {
    estackV2PointPositions = estackFixedPeqPointPositions;
}

function estackFixedPeqHit(event, threshold = 20) {
    const canvas = document.getElementById("responseCanvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    for (const point of estackFixedPeqPointPositions()) {
        const distance = Math.hypot(x - point.x, y - point.y);
        if (!best || distance < best.distance) best = { ...point, distance };
    }
    return best && best.distance <= threshold ? best : null;
}

function estackSelectPeqSlotVisual(slot) {
    selectedPeqSlot = slot;
    document.querySelectorAll(".estack-peq-strips > .estack-peq-strip").forEach((strip, index) => {
        strip.classList.toggle("selected", index === slot);
    });
    drawGraph();
}

let estackFixedDrag = null;
let estackFixedSuppressClick = false;

function estackInstallFixedPeqInteraction() {
    const canvas = document.getElementById("responseCanvas");
    if (!canvas || canvas.dataset.estackFixedPeq === "true") return;
    canvas.dataset.estackFixedPeq = "true";

    // Capture phase deliberately runs before the legacy V2 graph handlers.
    canvas.addEventListener("pointerdown", event => {
        if (activeModule !== "peq" || event.button !== 0) return;
        const hit = estackFixedPeqHit(event);
        if (!hit) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        estackFixedSuppressClick = true;
        estackSelectPeqSlotVisual(hit.slot);

        estackFixedDrag = {
            slot: hit.slot,
            entry: hit.entry,
            channel: selectedChannel,
            startX: event.clientX,
            startY: event.clientY,
            moved: false
        };
        try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
        canvas.classList.add("estack-v2-dragging");
    }, true);

    canvas.addEventListener("pointermove", event => {
        if (!estackFixedDrag || activeModule !== "peq") return;
        event.preventDefault();
        event.stopImmediatePropagation();

        const travel = Math.hypot(
            event.clientX - estackFixedDrag.startX,
            event.clientY - estackFixedDrag.startY
        );
        if (!estackFixedDrag.moved && travel < 2) return;

        if (!estackFixedDrag.entry) {
            // The point was a visible empty slot. Create it only now, when the
            // user has actually started an edit.
            estackFixedDrag.entry = estackEnsurePeqEntry(estackFixedDrag.slot);
        }

        const params = estackV2PointerToParams(event);
        const p = estackFixedDrag.entry[1].parameters || (estackFixedDrag.entry[1].parameters = {});
        p.freq = params.freq;
        p.gain = params.gain;
        estackFixedDrag.moved = true;
        estackPeqSetDisabled(selectedChannel, estackFixedDrag.slot, false);
        estackPeqStoreGain(selectedChannel, estackFixedDrag.slot, params.gain);
        drawGraph();
    }, true);

    const finish = async event => {
        if (!estackFixedDrag) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const drag = estackFixedDrag;
        estackFixedDrag = null;
        canvas.classList.remove("estack-v2-dragging");
        try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}

        if (drag.moved) {
            await safeUpload(`${channelName()} PEQ ${drag.slot + 1} graph move`);
        }
        renderAll(false);
    };

    canvas.addEventListener("pointerup", finish, true);
    canvas.addEventListener("pointercancel", finish, true);

    // Suppress the stale legacy click hit-test, whose Y coordinate was based on
    // total response rather than the DAW-style gain point now displayed.
    canvas.addEventListener("click", event => {
        if (!estackFixedSuppressClick && !estackFixedPeqHit(event)) return;
        estackFixedSuppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    // Clicking anywhere inside a PEQ strip selects it immediately. Controls
    // remain fully interactive because this only changes selection state.
    document.addEventListener("pointerdown", event => {
        const strip = event.target?.closest?.(".estack-peq-strips > .estack-peq-strip");
        if (!strip || activeModule !== "peq") return;
        const strips = [...strip.parentElement.children].filter(el => el.classList.contains("estack-peq-strip"));
        const slot = strips.indexOf(strip);
        if (slot < 0 || slot === selectedPeqSlot) return;
        estackSelectPeqSlotVisual(slot);
    }, true);
}

document.addEventListener("DOMContentLoaded", () => {
    estackInstallFixedPeqInteraction();
    requestAnimationFrame(() => {
        if (typeof drawGraph === "function") drawGraph();
    });
});
