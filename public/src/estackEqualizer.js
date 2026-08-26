const EStackChannels = {
    0: "SUB",
    1: "KICK",
    2: "MID L",
    3: "MID R",
    4: "HIGH L",
    5: "HIGH R",
    6: "SPARE 7",
    7: "SPARE 8"
};

let DSP;
let selectedChannel = 0;
let spectrumTimer;

function waitForDSP() {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            if (window.parent?.DSP) {
                clearInterval(timer);
                resolve(window.parent.DSP);
            }
        }, 50);
    });
}

function esc(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function isUserFilter(name, filter) {
    return name.startsWith("USER_") && filter?.type === "Biquad";
}

function filterSummary(name, filter) {
    const p = filter?.parameters || {};
    if (!filter) return `${name} · missing definition`;

    if (filter.type === "BiquadCombo") {
        const freq = p.freq !== undefined ? ` · ${p.freq} Hz` : "";
        const order = p.order !== undefined ? ` · order ${p.order}` : "";
        return `${p.type || "BiquadCombo"}${freq}${order}`;
    }
    if (filter.type === "Biquad") {
        const freq = p.freq !== undefined ? ` · ${p.freq} Hz` : "";
        const gain = p.gain !== undefined ? ` · ${p.gain} dB` : "";
        const q = p.q !== undefined ? ` · Q ${p.q}` : "";
        return `${p.type || "Biquad"}${freq}${gain}${q}`;
    }
    if (filter.type === "Gain") return `Gain · ${p.gain ?? 0} dB${p.inverted ? " · inverted" : ""}${p.mute ? " · muted" : ""}`;
    if (filter.type === "Delay") return `Delay · ${p.delay ?? 0} ${p.unit || "ms"}`;
    if (filter.type === "Limiter") return `Limiter · clip ${p.clip_limit ?? "?"} dB`;
    return filter.type || "Unknown";
}

function makeSystemChip(name, filter) {
    const chip = document.createElement("div");
    chip.className = "estack-system-chip";
    chip.innerHTML = `<strong>${esc(name)}</strong><span>${esc(filterSummary(name, filter))}</span>`;
    return chip;
}

function userFilterRow(channel, name, filter) {
    const p = filter.parameters || {};
    const row = document.createElement("div");
    row.className = "estack-peq-row";
    row.dataset.filterName = name;

    const title = document.createElement("div");
    title.className = "estack-peq-name";
    title.textContent = name;

    const type = document.createElement("select");
    type.className = "estack-peq-type";
    for (const subtype of ["Peaking", "Lowshelf", "Highshelf"]) {
        const option = document.createElement("option");
        option.value = subtype;
        option.textContent = subtype;
        type.appendChild(option);
    }
    type.value = p.type || "Peaking";

    const freq = numberField("Hz", p.freq ?? 1000, 20, 20000, 1);
    const gain = numberField("dB", p.gain ?? 0, -18, 18, 0.1);
    const q = numberField("Q", p.q ?? 1, 0.1, 20, 0.01);

    const remove = document.createElement("button");
    remove.className = "estack-danger-button";
    remove.textContent = "Delete";

    row.append(title, labeled("Type", type), labeled("Freq", freq), labeled("Gain", gain), labeled("Q", q), remove);

    let updateTimer;
    const apply = () => {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(async () => {
            const target = DSP.config?.filters?.[name];
            if (!target || !isUserFilter(name, target)) return;
            target.parameters = target.parameters || {};
            target.parameters.type = type.value;
            target.parameters.freq = Number(freq.value);
            target.parameters.gain = Number(gain.value);
            target.parameters.q = Number(q.value);
            await safeUpload(`update ${name}`);
            setStatus(`${EStackChannels[channel] || `CH${channel}`}: ${name} updated.`, "ok");
        }, 180);
    };

    type.addEventListener("change", apply);
    freq.addEventListener("change", apply);
    gain.addEventListener("change", apply);
    q.addEventListener("change", apply);

    remove.addEventListener("click", async () => {
        if (!confirm(`Delete user EQ filter ${name}?`)) return;
        DSP.removeFilterFromChannelPipeline(name, channel);
        await safeUpload(`delete ${name}`);
        await renderChannels();
    });

    return row;
}

function numberField(unit, value, min, max, step) {
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = step;
    input.dataset.unit = unit;
    return input;
}

function labeled(label, control) {
    const wrap = document.createElement("label");
    wrap.className = "estack-field";
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(span, control);
    return wrap;
}

async function safeUpload(reason) {
    const beforeProcessors = JSON.stringify(DSP.config?.processors || {});
    const beforePipelineLength = DSP.config?.pipeline?.length || 0;
    const ok = await DSP.uploadConfig();
    if (!ok) throw new Error(`CamillaDSP rejected config during ${reason}`);
    if (JSON.stringify(DSP.config?.processors || {}) !== beforeProcessors || (DSP.config?.pipeline?.length || 0) < beforePipelineLength) {
        console.warn("E-Stack safety check: config structure changed during", reason);
    }
    return true;
}

function setStatus(message, state = "info") {
    const el = document.getElementById("estackEqStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
}

async function addUserFilter(channel = selectedChannel) {
    selectedChannel = Number(channel);
    const name = `USER_CH${selectedChannel}_PEQ_${Date.now().toString().slice(-6)}`;
    const obj = {
        [name]: {
            type: "Biquad",
            description: `E-Stack user PEQ - ${EStackChannels[selectedChannel] || `CH${selectedChannel}`}`,
            parameters: {
                type: "Peaking",
                freq: 1000,
                gain: 0,
                q: 1
            }
        }
    };
    DSP.addFilter(obj, selectedChannel);
    await safeUpload(`add ${name}`);
    setStatus(`${EStackChannels[selectedChannel] || `CH${selectedChannel}`}: user PEQ added.`, "ok");
    await renderChannels();
}

async function clearPEQ() {
    if (!confirm("Delete all USER_ PEQ filters? System crossovers, gains, delays and protection filters will be preserved.")) return;
    for (const channel of DSP.getActiveOutputChannels()) {
        const names = DSP.getChannelFiltersList(channel);
        for (const name of [...names]) {
            const filter = DSP.config?.filters?.[name];
            if (isUserFilter(name, filter)) DSP.removeFilterFromChannelPipeline(name, channel);
        }
    }
    await safeUpload("clear user PEQ");
    setStatus("All user PEQ filters removed. System DSP preserved.", "ok");
    await renderChannels();
}

async function resetPEQ() {
    let changed = false;
    for (const [name, filter] of Object.entries(DSP.config?.filters || {})) {
        if (!isUserFilter(name, filter)) continue;
        filter.parameters.gain = 0;
        changed = true;
    }
    if (changed) await safeUpload("reset user PEQ");
    setStatus(changed ? "User PEQ gains reset to 0 dB." : "No user PEQ filters to reset.", "ok");
    await renderChannels();
}

function sortAll() {
    renderChannels();
}

async function renderChannels() {
    await DSP.downloadConfig();
    const root = document.getElementById("estackChannels");
    root.replaceChildren();

    const active = DSP.getActiveOutputChannels().filter(ch => ch <= 5);
    for (const channel of active) {
        const card = document.createElement("section");
        card.className = "estack-channel-card";
        card.dataset.channel = channel;
        if (channel === selectedChannel) card.classList.add("selected");
        card.addEventListener("click", e => {
            if (e.target.closest("input,select,button")) return;
            selectedChannel = channel;
            document.querySelectorAll(".estack-channel-card").forEach(el => el.classList.toggle("selected", Number(el.dataset.channel) === selectedChannel));
        });

        const header = document.createElement("div");
        header.className = "estack-channel-header";
        const h = document.createElement("h2");
        h.textContent = EStackChannels[channel] || `Channel ${channel}`;
        const meta = document.createElement("span");
        meta.textContent = `OUT ${channel + 1}`;
        const add = document.createElement("button");
        add.className = "estack-primary-button";
        add.textContent = "+ PEQ";
        add.addEventListener("click", async e => {
            e.stopPropagation();
            await addUserFilter(channel);
        });
        header.append(h, meta, add);

        const names = DSP.getChannelFiltersList(channel);
        const system = [];
        const user = [];
        for (const name of names) {
            const filter = DSP.config?.filters?.[name];
            if (isUserFilter(name, filter)) user.push([name, filter]);
            else system.push([name, filter]);
        }

        const processors = (DSP.config?.pipeline || [])
            .filter(step => step?.type === "Processor" && Array.isArray(step.channels) && step.channels.map(Number).includes(channel))
            .map(step => [step.name, DSP.config?.processors?.[step.name]]);

        const systemBlock = document.createElement("div");
        systemBlock.className = "estack-system-block";
        const systemTitle = document.createElement("div");
        systemTitle.className = "estack-block-title";
        systemTitle.innerHTML = `<span>System DSP</span><small>locked · ${system.length} filters${processors.length ? ` · ${processors.length} processor${processors.length > 1 ? "s" : ""}` : ""}</small>`;
        const chips = document.createElement("div");
        chips.className = "estack-system-list";
        for (const [name, filter] of system) chips.appendChild(makeSystemChip(name, filter));
        for (const [name, processor] of processors) {
            const chip = document.createElement("div");
            chip.className = "estack-system-chip estack-processor-chip";
            chip.innerHTML = `<strong>${esc(name || "processor")}</strong><span>Processor · ${esc(processor?.type || processor?.parameters?.type || "protection")}</span>`;
            chips.appendChild(chip);
        }
        systemBlock.append(systemTitle, chips);

        const userBlock = document.createElement("div");
        userBlock.className = "estack-user-block";
        const userTitle = document.createElement("div");
        userTitle.className = "estack-block-title";
        userTitle.innerHTML = `<span>User EQ</span><small>${user.length ? `${user.length} editable` : "no PEQ yet"}</small>`;
        userBlock.appendChild(userTitle);
        if (user.length === 0) {
            const empty = document.createElement("div");
            empty.className = "estack-empty";
            empty.textContent = "No user PEQ on this output. Click + PEQ to add one without touching the crossover/protection chain.";
            userBlock.appendChild(empty);
        } else {
            user.sort((a, b) => Number(a[1]?.parameters?.freq || 0) - Number(b[1]?.parameters?.freq || 0));
            for (const [name, filter] of user) userBlock.appendChild(userFilterRow(channel, name, filter));
        }

        card.append(header, systemBlock, userBlock);
        root.appendChild(card);
    }

    const count = Object.keys(DSP.config?.filters || {}).length;
    document.getElementById("estackEqCount").textContent = `${count} total filters in CamillaDSP`;
}

const spectrumFreq = ['25', '30', '40', '50', '63', '80', '100', '125', '160', '200', '250', '315', '400', '500', '630', '800', '1K', '1.2K', '1.6K', '2K', '2.5K', '3.1K', '4K', '5K', '6.3K', '8K', '10K', '12K', '16K', '20K'];

function initSpectrum() {
    const spec = document.getElementById("spectrum");
    if (!spec) return;
    if (!window.parent.activeSettings?.enableSpectrum || !window.parent.activeSettings?.showEqualizerSpectrum) {
        spec.style.display = "none";
        return;
    }

    spec.style.display = "grid";
    spec.innerHTML = "";
    for (const f of spectrumFreq) {
        const bar = document.createElement("div");
        bar.className = "levelbar";
        bar.setAttribute("freq", f);
        for (let i = 0; i < 39; i++) {
            const box = document.createElement("div");
            box.className = "levelbox";
            bar.appendChild(box);
        }
        spec.appendChild(bar);
    }

    if (spectrumTimer) clearInterval(spectrumTimer);
    spectrumTimer = setInterval(async () => {
        try {
            const levels = await DSP.getSpectrumData();
            if (!Array.isArray(levels) || levels.length === 0) return;
            let idx = 0;
            spec.querySelectorAll(".levelbar").forEach(bar => {
                const level = Number(levels[idx] ?? -100);
                const normalized = Math.max(0, Math.min(39, Math.round((level + 100) / 2.5)));
                [...bar.children].forEach((box, i) => box.style.opacity = i < normalized ? 1 : 0);
                idx += 2;
            });
        } catch (err) {
            console.debug("Spectrum read failed", err);
        }
    }, 100);
}

async function estackEqualizerOnLoad() {
    DSP = await waitForDSP();
    window.DSP = DSP;
    await DSP.downloadConfig();
    selectedChannel = DSP.getActiveOutputChannels().find(ch => ch <= 5) ?? 0;
    await renderChannels();
    initSpectrum();
    setStatus("System DSP is locked. Only USER_ PEQ filters are editable here.", "info");
}

window.addNewFilter = () => addUserFilter(selectedChannel);
window.clearPEQ = clearPEQ;
window.resetPEQ = resetPEQ;
window.sortAll = sortAll;

document.addEventListener("DOMContentLoaded", estackEqualizerOnLoad);
