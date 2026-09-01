// Output Processing PEQ presentation and graph interaction.
// This is the single final PEQ view layer: local-output response graph, dynamic
// user-band rack, graph markers and drag editing.

function estackLocalGraphEntries(channel) {
    return filterEntries(channel).filter(([name, filter]) =>
        !String(name).startsWith('GLOBAL_EQ_') &&
        ['BiquadCombo', 'Biquad', 'Gain'].includes(filter?.type)
    );
}

// Output Processing intentionally shows the local speaker-way processing only.
// Global input EQ has its own page and is not duplicated in this editor graph.
if (typeof canvasSetup === 'function' && typeof activeChannels === 'function') {
    drawGraph = function() {
        if (typeof DSP === 'undefined' || !DSP) return;
        const { ctx, width, height } = canvasSetup();
        const margin = { left: 50, right: 18, top: 18, bottom: 31 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const range = { min: -60, max: 12, step: 10 };

        ctx.clearRect(0, 0, width, height);
        if (typeof estackV4GraphBackground === 'function') estackV4GraphBackground(ctx, width, height);
        if (typeof estackDrawRtaOverlay === 'function') estackDrawRtaOverlay(ctx, margin, innerW, innerH);
        if (typeof drawGrid === 'function') drawGrid(ctx, margin, innerW, innerH, range);

        const freqs = logFrequencies(20, 20000, 520);
        const channels = activeChannels();
        const order = channels.filter(channel => channel !== selectedChannel).concat(
            channels.includes(selectedChannel) ? [selectedChannel] : []
        );

        for (const channel of order) {
            const entries = estackLocalGraphEntries(channel);
            const values = freqs.map(freq => sumDb(entries, freq));
            if (typeof estackDrawResponseCurve === 'function') {
                estackDrawResponseCurve(
                    ctx, freqs, values, margin, innerW, innerH, range,
                    channel, channel === selectedChannel
                );
            }
        }

        const zeroY = margin.top + dbToY(0, innerH, range);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, zeroY);
        ctx.lineTo(margin.left + innerW, zeroY);
        ctx.stroke();
        ctx.restore();

        if (typeof estackRenderLegend === 'function') estackRenderLegend();
        if (typeof estackDrawPeqMarkers === 'function') estackDrawPeqMarkers();
    };
}

function estackDynamicFirstEmptySlot() {
    return mapPeqSlots().findIndex(entry => !entry);
}

async function estackDynamicDeletePeq(slot, entry) {
    if (!entry) return;
    const [name] = entry;

    DSP.removeFilterFromChannelPipeline(name, selectedChannel);
    if (DSP.config?.filters?.[name]) delete DSP.config.filters[name];
    window.localStorage.removeItem(estackPeqDisabledKey(selectedChannel, slot));
    window.localStorage.removeItem(estackPeqStoredGainKey(selectedChannel, slot));

    await safeUpload(`${channelName()} PEQ ${slot + 1} deleted`);
    const next = mapPeqSlots().findIndex(Boolean);
    selectedPeqSlot = next >= 0 ? next : 0;
    renderAll(false);
}

function estackDynamicDecorateStrip(slot, entry) {
    const strip = estackRenderPeqStrip(slot, entry);
    strip.dataset.peqSlot = String(slot);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'estack-peq-delete';
    remove.textContent = 'DELETE';
    remove.title = `Delete PEQ ${slot + 1}`;
    remove.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        estackDynamicDeletePeq(slot, entry);
    });
    strip.appendChild(remove);
    return strip;
}

estackRenderPeqRack = function(root) {
    root.classList.add('estack-peq-rack-mode', 'estack-peq-dynamic-mode');

    const consoleEl = document.createElement('div');
    consoleEl.className = 'estack-peq-console estack-eq8-console';

    const xovers = document.createElement('aside');
    xovers.className = 'estack-peq-xovers';
    xovers.append(estackRenderPeqCrossover('hpf'), estackRenderPeqCrossover('lpf'));

    const eq = document.createElement('section');
    eq.className = 'estack-peq-equalizer';

    const eqHead = document.createElement('header');
    eqHead.className = 'estack-peq-eq-head';
    const title = document.createElement('div');
    const slots = mapPeqSlots();
    const active = slots
        .map((entry, slot) => ({ entry, slot }))
        .filter(item => Boolean(item.entry));
    title.innerHTML = `<strong>PARAMETRIC EQ</strong><span>${channelName()} · ${active.length} band${active.length === 1 ? '' : 's'}</span>`;

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'estack-peq-add-button';
    add.textContent = '+ ADD PEQ';
    const empty = estackDynamicFirstEmptySlot();
    add.disabled = empty < 0;
    add.title = empty < 0 ? `Maximum ${ESTACK_PEQ_COUNT} PEQ bands reached` : 'Create a PEQ band';
    add.addEventListener('click', async () => {
        const slot = estackDynamicFirstEmptySlot();
        if (slot < 0) return;
        add.disabled = true;
        try {
            await createPeqBand(slot);
        } finally {
            add.disabled = false;
        }
    });
    eqHead.append(title, add);

    const strips = document.createElement('div');
    strips.className = 'estack-peq-strips estack-peq-dynamic-strips';
    if (active.length) {
        for (const { entry, slot } of active) strips.appendChild(estackDynamicDecorateStrip(slot, entry));
    } else {
        const emptyState = document.createElement('div');
        emptyState.className = 'estack-peq-empty-state';
        emptyState.innerHTML = '<strong>No user PEQ</strong><span>Use + ADD PEQ.</span>';
        strips.appendChild(emptyState);
    }

    eq.append(eqHead, strips);
    consoleEl.append(xovers, eq, estackEq8AnalyzerPanel());
    root.appendChild(consoleEl);
};

function estackPeqPointPositions() {
    const canvas = document.getElementById('responseCanvas');
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 50, right: 18, top: 18, bottom: 31 };
    const innerW = rect.width - margin.left - margin.right;
    const innerH = rect.height - margin.top - margin.bottom;
    const range = graphRange();
    const points = [];

    mapPeqSlots().forEach((entry, slot) => {
        if (!entry) return;
        const p = entry[1]?.parameters || {};
        const freq = Number(p.freq || ESTACK_PEQ_DEFAULT_FREQS[slot]);
        const gain = Number(p.gain || 0);
        points.push({
            slot,
            entry,
            x: margin.left + freqToX(clamp(freq, 20, 20000), innerW),
            y: margin.top + dbToY(clamp(gain, range.min, range.max), innerH, range)
        });
    });
    return points;
}

if (typeof estackV2PointPositions === 'function') estackV2PointPositions = estackPeqPointPositions;

function estackSelectPeqSlotVisual(slot) {
    selectedPeqSlot = Number(slot);
    document.querySelectorAll('.estack-peq-dynamic-strips > .estack-peq-strip').forEach(strip => {
        strip.classList.toggle('selected', Number(strip.dataset.peqSlot) === selectedPeqSlot);
    });
    drawGraph();
}

estackDrawPeqMarkers = function() {
    const canvas = document.getElementById('responseCanvas');
    if (!canvas || activeModule !== 'peq') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    for (const point of estackPeqPointPositions()) {
        const selected = point.slot === selectedPeqSlot;
        const color = typeof estackV4SelectedColor === 'function' ? estackV4SelectedColor() : '#59d5e3';
        ctx.save();
        ctx.beginPath();
        ctx.arc(point.x, point.y, selected ? 9 : 7, 0, Math.PI * 2);
        ctx.fillStyle = selected ? color : '#172022';
        ctx.fill();
        ctx.lineWidth = selected ? 2 : 1.25;
        ctx.strokeStyle = color;
        ctx.globalAlpha = selected ? 1 : .75;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = selected ? '#102124' : '#eef4f5';
        ctx.font = `${selected ? '700 ' : ''}10px Open Sans, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(point.slot + 1), point.x, point.y + .25);
        ctx.restore();
    }
};

function estackPeqHit(event, threshold = 20) {
    const canvas = document.getElementById('responseCanvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;

    for (const point of estackPeqPointPositions()) {
        const distance = Math.hypot(x - point.x, y - point.y);
        if (!best || distance < best.distance) best = { ...point, distance };
    }
    return best && best.distance <= threshold ? best : null;
}

let estackPeqDrag = null;
let estackPeqSuppressClick = false;

function estackInstallPeqGraphInteraction() {
    const canvas = document.getElementById('responseCanvas');
    if (!canvas || canvas.dataset.estackPeqInteraction === 'true') return;
    canvas.dataset.estackPeqInteraction = 'true';

    canvas.addEventListener('pointerdown', event => {
        if (activeModule !== 'peq' || event.button !== 0) return;
        const hit = estackPeqHit(event);
        if (!hit) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        estackPeqSuppressClick = true;
        estackSelectPeqSlotVisual(hit.slot);
        estackPeqDrag = {
            slot: hit.slot,
            entry: hit.entry,
            channel: selectedChannel,
            startX: event.clientX,
            startY: event.clientY,
            moved: false
        };
        try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
        canvas.classList.add('estack-v2-dragging');
    }, true);

    canvas.addEventListener('pointermove', event => {
        if (!estackPeqDrag || activeModule !== 'peq') return;
        event.preventDefault();
        event.stopImmediatePropagation();

        if (!estackPeqDrag.moved && Math.hypot(
            event.clientX - estackPeqDrag.startX,
            event.clientY - estackPeqDrag.startY
        ) < 2) return;

        const params = estackV2PointerToParams(event);
        const p = estackPeqDrag.entry[1].parameters || (estackPeqDrag.entry[1].parameters = {});
        p.freq = params.freq;
        p.gain = params.gain;
        estackPeqDrag.moved = true;
        estackPeqSetDisabled(selectedChannel, estackPeqDrag.slot, false);
        estackPeqStoreGain(selectedChannel, estackPeqDrag.slot, params.gain);
        drawGraph();
    }, true);

    const finish = async event => {
        if (!estackPeqDrag) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const drag = estackPeqDrag;
        estackPeqDrag = null;
        canvas.classList.remove('estack-v2-dragging');
        try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}

        if (drag.moved) await safeUpload(`${channelName()} PEQ ${drag.slot + 1} graph move`);
        renderAll(false);
    };
    canvas.addEventListener('pointerup', finish, true);
    canvas.addEventListener('pointercancel', finish, true);

    canvas.addEventListener('click', event => {
        if (!estackPeqSuppressClick && !estackPeqHit(event)) return;
        estackPeqSuppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    document.addEventListener('pointerdown', event => {
        const strip = event.target?.closest?.('.estack-peq-dynamic-strips > .estack-peq-strip');
        if (!strip || activeModule !== 'peq') return;
        const slot = Number(strip.dataset.peqSlot);
        if (!Number.isInteger(slot) || slot === selectedPeqSlot) return;
        estackSelectPeqSlotVisual(slot);
    }, true);
}

document.addEventListener('DOMContentLoaded', () => {
    estackInstallPeqGraphInteraction();
    requestAnimationFrame(() => {
        if (typeof drawGraph === 'function') drawGraph();
    });
});
