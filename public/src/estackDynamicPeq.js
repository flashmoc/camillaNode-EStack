// Dynamic PEQ rack for Output Processing.
// Only existing USER_ PEQ bands are rendered. New bands are created explicitly
// with + ADD PEQ, instead of reserving ten empty strips on screen.

function estackDynamicFirstEmptySlot() {
    const slots = mapPeqSlots();
    return slots.findIndex(entry => !entry);
}

async function estackDynamicDeletePeq(slot, entry) {
    if (!entry) return;
    const [name] = entry;

    DSP.removeFilterFromChannelPipeline(name, selectedChannel);
    try {
        if (DSP.config?.filters?.[name]) delete DSP.config.filters[name];
    } catch (_) {}

    try {
        window.localStorage.removeItem(estackPeqDisabledKey(selectedChannel, slot));
        window.localStorage.removeItem(estackPeqStoredGainKey(selectedChannel, slot));
    } catch (_) {}

    await safeUpload(`${channelName()} PEQ ${slot + 1} deleted`);

    const remaining = mapPeqSlots();
    const next = remaining.findIndex(Boolean);
    selectedPeqSlot = next >= 0 ? next : 0;
    renderAll(false);
}

function estackDynamicDecorateStrip(slot, entry) {
    const strip = estackRenderPeqStrip(slot, entry);
    strip.dataset.peqSlot = String(slot);
    if (!entry) return strip;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "estack-peq-delete";
    remove.textContent = "DELETE";
    remove.title = `Delete PEQ ${slot + 1}`;
    remove.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        estackDynamicDeletePeq(slot, entry);
    });
    strip.appendChild(remove);
    return strip;
}

estackRenderPeqRack = function(root) {
    root.classList.add("estack-peq-rack-mode", "estack-peq-dynamic-mode");

    const consoleEl = document.createElement("div");
    consoleEl.className = "estack-peq-console estack-eq8-console";

    const xovers = document.createElement("aside");
    xovers.className = "estack-peq-xovers";
    xovers.append(estackRenderPeqCrossover("hpf"), estackRenderPeqCrossover("lpf"));

    const eq = document.createElement("section");
    eq.className = "estack-peq-equalizer";

    const eqHead = document.createElement("header");
    eqHead.className = "estack-peq-eq-head";

    const title = document.createElement("div");
    const slots = mapPeqSlots();
    const active = slots
        .map((entry, slot) => ({ entry, slot }))
        .filter(item => !!item.entry);
    title.innerHTML = `<strong>PARAMETRIC EQ</strong><span>${channelName()} · ${active.length} band${active.length === 1 ? "" : "s"}</span>`;

    const add = document.createElement("button");
    add.type = "button";
    add.className = "estack-peq-add-button";
    add.textContent = "+ ADD PEQ";
    const empty = estackDynamicFirstEmptySlot();
    add.disabled = empty < 0;
    add.title = empty < 0 ? `Maximum ${ESTACK_PEQ_COUNT} PEQ bands reached` : "Create a new PEQ band";
    add.addEventListener("click", async () => {
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

    const strips = document.createElement("div");
    strips.className = "estack-peq-strips estack-peq-dynamic-strips";

    if (active.length) {
        for (const { entry, slot } of active) {
            strips.appendChild(estackDynamicDecorateStrip(slot, entry));
        }
    } else {
        const emptyState = document.createElement("div");
        emptyState.className = "estack-peq-empty-state";
        emptyState.innerHTML = `<strong>No user PEQ</strong><span>Use + ADD PEQ to create the first band.</span>`;
        strips.appendChild(emptyState);
    }

    eq.append(eqHead, strips);
    consoleEl.append(xovers, eq, estackEq8AnalyzerPanel());
    root.appendChild(consoleEl);
};

// Graph points must follow the same dynamic model: only existing PEQs are
// selectable/draggable. Empty slots are created only with + ADD PEQ.
estackFixedPeqPointPositions = function() {
    const canvas = document.getElementById("responseCanvas");
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const margin = { left: 50, right: 18, top: 18, bottom: 31 };
    const innerW = rect.width - margin.left - margin.right;
    const innerH = rect.height - margin.top - margin.bottom;
    const range = graphRange();
    const slots = mapPeqSlots();
    const points = [];

    slots.forEach((entry, slot) => {
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
};

if (typeof estackV2PointPositions === "function") {
    estackV2PointPositions = estackFixedPeqPointPositions;
}

estackSelectPeqSlotVisual = function(slot) {
    selectedPeqSlot = Number(slot);
    document.querySelectorAll(".estack-peq-dynamic-strips > .estack-peq-strip").forEach(strip => {
        strip.classList.toggle("selected", Number(strip.dataset.peqSlot) === selectedPeqSlot);
    });
    drawGraph();
};

// The normal V4 renderer calls this after every graph redraw. Render only
// existing user bands so the graph and the rack always tell the same story.
estackDrawPeqMarkers = function() {
    const canvas = document.getElementById("responseCanvas");
    if (!canvas || activeModule !== "peq") return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // canvasSetup already scales the drawing context for DPR, so coordinates
    // here remain CSS pixels. Keep this guard for canvases drawn without it.
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;

    const points = estackFixedPeqPointPositions();
    for (const point of points) {
        const selected = point.slot === selectedPeqSlot;
        const color = typeof estackV4SelectedColor === "function" ? estackV4SelectedColor() : "#59d5e3";
        ctx.save();
        ctx.beginPath();
        ctx.arc(point.x, point.y, selected ? 9 : 7, 0, Math.PI * 2);
        ctx.fillStyle = selected ? color : "#172022";
        ctx.fill();
        ctx.lineWidth = selected ? 2 : 1.25;
        ctx.strokeStyle = color;
        ctx.globalAlpha = selected ? 1 : .75;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = selected ? "#102124" : "#eef4f5";
        ctx.font = `${selected ? "700 " : ""}10px Open Sans, Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(point.slot + 1), point.x, point.y + .25);
        ctx.restore();
    }
};
