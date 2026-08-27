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
