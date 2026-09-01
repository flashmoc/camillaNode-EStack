const EStackChannels = {
    0: "SUB",
    1: "KICK",
    2: "MID L",
    3: "MID R",
    4: "HIGH L",
    5: "HIGH R"
};

const PEQ_COLORS = [318, 165, 215, 22, 88, 272, 48, 138];
const PEQ_SLOT_COUNT = 8;
const PEQ_DEFAULT_FREQ = [40, 80, 160, 315, 630, 1250, 4000, 10000];
const spectrumFreqs = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];

let DSP;
let selectedChannel = 0;
let activeModule = "crossover";
let selectedCrossover = "hpf";
let selectedPeqSlot = 0;
let systemEditEnabled = false;
let spectrumTimer;
let lastSpectrum = [];
let resizeTimer;

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

function setStatus(message, state = "info") {
    const el = document.getElementById("estackEqStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
}

function channelName(channel = selectedChannel) {
    return EStackChannels[channel] || `CH ${channel + 1}`;
}

function activeChannels() {
    return DSP.getActiveOutputChannels().filter(ch => ch >= 0 && ch <= 5);
}

function filterNames(channel = selectedChannel) {
    return DSP.getChannelFiltersList(channel);
}

function filterEntries(channel = selectedChannel) {
    return filterNames(channel)
        .map(name => [name, DSP.config?.filters?.[name]])
        .filter(([, filter]) => !!filter);
}

function isUserPeq(name, filter) {
    return name.startsWith("USER_") && filter?.type === "Biquad";
}

function getPeqEntries(channel = selectedChannel) {
    return filterEntries(channel).filter(([name, filter]) => isUserPeq(name, filter));
}

function getCrossoverEntries(channel = selectedChannel) {
    return filterEntries(channel).filter(([, filter]) => filter?.type === "BiquadCombo" && /pass/i.test(filter?.parameters?.type || ""));
}

function getCrossover(kind, channel = selectedChannel) {
    const token = kind === "hpf" ? "highpass" : "lowpass";
    return getCrossoverEntries(channel).find(([, filter]) => String(filter?.parameters?.type || "").toLowerCase().includes(token));
}

function getGainEntry(channel = selectedChannel) {
    return filterEntries(channel).find(([, filter]) => filter?.type === "Gain");
}

function getDelayEntry(channel = selectedChannel) {
    return filterEntries(channel).find(([, filter]) => filter?.type === "Delay");
}

function getLimiterEntries(channel = selectedChannel) {
    return filterEntries(channel).filter(([, filter]) => filter?.type === "Limiter");
}

function getProcessorEntries(channel = selectedChannel) {
    return (DSP.config?.pipeline || [])
        .filter(step => step?.type === "Processor" && stepChannels(step).includes(Number(channel)))
        .map(step => [step.name, DSP.config?.processors?.[step.name]])
        .filter(([, processor]) => !!processor);
}

function stepChannels(step) {
    if (Array.isArray(step?.channels)) return step.channels.map(Number);
    if (step?.channel !== undefined) return [Number(step.channel)];
    return [];
}

function channelsUsingFilter(name) {
    const result = [];
    for (const ch of activeChannels()) {
        if (filterNames(ch).includes(name)) result.push(ch);
    }
    return result;
}

function structuralFingerprint(config) {
    const pipeline = (config?.pipeline || []).map(step => {
        if (step?.type === "Filter") {
            return {
                type: step.type,
                channels: stepChannels(step),
                names: (step.names || []).filter(name => !String(name).startsWith("USER_"))
            };
        }
        return { type: step?.type, name: step?.name, channels: stepChannels(step) };
    });
    return JSON.stringify({
        pipeline,
        processors: Object.keys(config?.processors || {}).sort(),
        mixers: Object.keys(config?.mixers || {}).sort()
    });
}

async function safeUpload(reason) {
    const expectedStructure = structuralFingerprint(DSP.config);
    try {
        const ok = await DSP.uploadConfig();
        if (!ok) throw new Error("CamillaDSP rejected the configuration");
        await DSP.downloadConfig();
        if (structuralFingerprint(DSP.config) !== expectedStructure) {
            throw new Error("protected DSP structure changed unexpectedly");
        }
        setStatus(`${reason} · applied`, "ok");
        updateCount();
        drawGraph();
        return true;
    } catch (error) {
        console.error("E-Stack DSP upload failed", error);
        setStatus(`${reason} · ERROR: ${error?.message || error}`, "error");
        return false;
    }
}

function updateCount() {
    const el = document.getElementById("estackEqCount");
    if (el) el.textContent = `${Object.keys(DSP.config?.filters || {}).length} filters · CamillaDSP`;
}

function renderChannelTabs() {
    const root = document.getElementById("channelTabs");
    root.replaceChildren();
    for (const channel of activeChannels()) {
        const button = document.createElement("button");
        button.className = "venu-output-tab";
        button.classList.toggle("active", channel === selectedChannel);
        button.innerHTML = `<strong>${channelName(channel)}</strong><small>OUT ${channel + 1}</small>`;
        button.addEventListener("click", async () => {
            selectedChannel = channel;
            selectedCrossover = getCrossover("hpf") ? "hpf" : "lpf";
            selectedPeqSlot = 0;
            await DSP.downloadConfig();
            renderAll();
        });
        root.appendChild(button);
    }
}

function renderModuleTabs() {
    document.querySelectorAll("#moduleTabs button").forEach(button => {
        button.classList.toggle("active", button.dataset.module === activeModule);
        button.onclick = () => {
            activeModule = button.dataset.module;
            renderAll();
        };
    });
}

function renderHeader() {
    document.getElementById("selectedChannelTitle").textContent = channelName();
    document.getElementById("selectedChannelMeta").textContent = `OUT ${selectedChannel + 1}`;
    const titles = {
        crossover: ["Crossover", `${channelName()} · Output ${selectedChannel + 1}`],
        peq: ["Parametric EQ", `${channelName()} · 8 user bands`],
        output: ["Output", `${channelName()} · gain, polarity and alignment delay`],
        protection: ["Protection", `${channelName()} · limiter and dynamics`]
    };
    const [title, subtitle] = titles[activeModule];
    document.getElementById("moduleTitle").textContent = title;
    document.getElementById("moduleSubtitle").textContent = subtitle;

    const edit = document.getElementById("systemEditToggle");
    edit.setAttribute("aria-pressed", String(systemEditEnabled));
    edit.textContent = systemEditEnabled ? "EDITING SYSTEM" : "EDIT SYSTEM";
}

function renderBandSelector() {
    const root = document.getElementById("bandSelector");
    root.replaceChildren();

    if (activeModule === "crossover") {
        for (const [kind, label] of [["hpf", "HPF"], ["lpf", "LPF"]]) {
            const entry = getCrossover(kind);
            if (!entry) continue;
            const button = bandButton(label, kind === selectedCrossover, kind === "hpf" ? 24 : 185);
            button.addEventListener("click", () => {
                selectedCrossover = kind;
                renderAll();
            });
            root.appendChild(button);
        }
        return;
    }

    if (activeModule === "peq") {
        const slots = mapPeqSlots();
        for (let i = 0; i < PEQ_SLOT_COUNT; i++) {
            const entry = slots[i];
            const button = bandButton(entry ? String(i + 1) : `+ ${i + 1}`, i === selectedPeqSlot, PEQ_COLORS[i]);
            button.title = entry ? entry[0] : `Create PEQ band ${i + 1}`;
            button.addEventListener("click", async () => {
                selectedPeqSlot = i;
                renderAll();
            });
            root.appendChild(button);
        }
        return;
    }

    if (activeModule === "protection") {
        const limiters = getLimiterEntries();
        limiters.forEach(([name], index) => {
            const button = bandButton(`Limiter ${index + 1}`, index === 0, 4);
            button.title = name;
            root.appendChild(button);
        });
        const processors = getProcessorEntries();
        processors.forEach(([name], index) => {
            const button = bandButton(`Dynamics ${index + 1}`, false, 45);
            button.title = name;
            root.appendChild(button);
        });
        if (!limiters.length && !processors.length) {
            const info = document.createElement("span");
            info.textContent = "No protection module detected";
            info.style.opacity = ".5";
            root.appendChild(info);
        }
    }
}

function bandButton(label, active, hue) {
    const button = document.createElement("button");
    button.className = "venu-band-button";
    button.classList.toggle("active", active);
    button.textContent = label;
    button.style.setProperty("--band-color", `hsl(${hue}, 68%, 58%)`);
    return button;
}

function mapPeqSlots() {
    const slots = Array(PEQ_SLOT_COUNT).fill(null);
    const entries = getPeqEntries();
    const leftovers = [];

    for (const entry of entries) {
        const match = entry[0].match(/_PEQ_(\d{2})$/);
        if (match) {
            const index = Number(match[1]) - 1;
            if (index >= 0 && index < PEQ_SLOT_COUNT && !slots[index]) {
                slots[index] = entry;
                continue;
            }
        }
        leftovers.push(entry);
    }

    leftovers.sort((a, b) => Number(a[1]?.parameters?.freq || 0) - Number(b[1]?.parameters?.freq || 0));
    for (const entry of leftovers) {
        const empty = slots.findIndex(value => !value);
        if (empty < 0) break;
        slots[empty] = entry;
    }
    return slots;
}

function renderControls() {
    const root = document.getElementById("moduleControls");
    root.replaceChildren();

    if (activeModule === "crossover") renderCrossoverControls(root);
    else if (activeModule === "peq") renderPeqControls(root);
    else if (activeModule === "output") renderOutputControls(root);
    else renderProtectionControls(root);
}

function controlColumns(title, description) {
    const left = document.createElement("div");
    left.className = "venu-control-left";
    const h = document.createElement("h3");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = description;
    left.append(h, p);

    const right = document.createElement("div");
    right.className = "venu-control-right";
    return [left, right];
}

function renderCrossoverControls(root) {
    const entry = getCrossover(selectedCrossover) || getCrossover("hpf") || getCrossover("lpf");
    if (!entry) {
        const [left, right] = controlColumns("No crossover", "No BiquadCombo high-pass or low-pass filter is assigned to this output.");
        root.append(left, right);
        return;
    }

    const [name, filter] = entry;
    const p = filter.parameters || {};
    const kind = String(p.type || "").toLowerCase().includes("highpass") ? "hpf" : "lpf";
    selectedCrossover = kind;
    const linked = channelsUsingFilter(name).filter(ch => ch !== selectedChannel);
    const linkedText = linked.length ? ` Linked with ${linked.map(channelName).join(", ")}.` : "";
    const [left, right] = controlColumns(kind === "hpf" ? "High-Pass Filter" : "Low-Pass Filter", `${name}.${linkedText}`);

    if (!systemEditEnabled) {
        const warning = document.createElement("p");
        warning.className = "danger-note";
        warning.textContent = "Press EDIT SYSTEM to change crossover settings.";
        left.appendChild(warning);
    }

    const family = String(p.type || "").startsWith("Butterworth") ? "Butterworth" : "LinkwitzRiley";
    right.appendChild(makeSelectRow("Filter type", family, ["LinkwitzRiley", "Butterworth"], async value => {
        const suffix = kind === "hpf" ? "Highpass" : "Lowpass";
        p.type = `${value}${suffix}`;
        await safeUpload(`${channelName()} ${kind.toUpperCase()} type`);
        renderAll(false);
    }, !systemEditEnabled));

    const slopes = [12, 24, 36, 48];
    const currentSlope = Math.max(12, Number(p.order || 4) * 6);
    right.appendChild(makeSelectRow("Slope", currentSlope, slopes, async value => {
        p.order = Number(value) / 6;
        await safeUpload(`${channelName()} ${kind.toUpperCase()} slope`);
        renderAll(false);
    }, !systemEditEnabled, value => `${value} dB/oct`));

    right.appendChild(makeLogParamRow("Frequency", Number(p.freq || 100), 16, 20000, async value => {
        p.freq = Math.round(value * 10) / 10;
        await safeUpload(`${channelName()} ${kind.toUpperCase()} frequency`);
        renderAll(false);
    }, !systemEditEnabled, "Hz"));

    root.append(left, right);
}

function renderPeqControls(root) {
    const slots = mapPeqSlots();
    const entry = slots[selectedPeqSlot];
    const bandNo = selectedPeqSlot + 1;
    const [left, right] = controlColumns(`Band ${bandNo}`, entry ? entry[0] : "Unused PEQ slot");

    if (!entry) {
        const button = document.createElement("button");
        button.className = "venu-primary";
        button.textContent = `Create Band ${bandNo}`;
        button.addEventListener("click", () => createPeqBand(selectedPeqSlot));
        const wrap = document.createElement("div");
        wrap.className = "venu-choice-row";
        wrap.appendChild(button);
        right.appendChild(wrap);
        root.append(left, right);
        return;
    }

    const [name, filter] = entry;
    const p = filter.parameters || {};
    right.appendChild(makeSelectRow("Type", p.type || "Peaking", ["Peaking", "Lowshelf", "Highshelf"], async value => {
        p.type = value;
        await safeUpload(`${channelName()} PEQ ${bandNo} type`);
        renderAll(false);
    }, false, value => value === "Peaking" ? "Bell" : value === "Lowshelf" ? "Low Shelf" : "High Shelf"));

    right.appendChild(makeLogParamRow("Frequency", Number(p.freq || 1000), 20, 20000, async value => {
        p.freq = Math.round(value * 10) / 10;
        await safeUpload(`${channelName()} PEQ ${bandNo} frequency`);
        renderAll(false);
    }, false, "Hz"));

    right.appendChild(makeLinearParamRow("Gain", Number(p.gain || 0), -20, 20, .1, async value => {
        p.gain = Math.round(value * 10) / 10;
        await safeUpload(`${channelName()} PEQ ${bandNo} gain`);
        renderAll(false);
    }, false, "dB"));

    right.appendChild(makeLinearParamRow("Q", Number(p.q || 1), .1, 20, .01, async value => {
        p.q = Math.round(value * 100) / 100;
        await safeUpload(`${channelName()} PEQ ${bandNo} Q`);
        renderAll(false);
    }, false, ""));

    const actions = document.createElement("div");
    actions.className = "venu-choice-row";
    const flatten = document.createElement("button");
    flatten.className = "venu-choice";
    flatten.textContent = "0 dB";
    flatten.onclick = async () => {
        p.gain = 0;
        await safeUpload(`${channelName()} PEQ ${bandNo} flattened`);
        renderAll(false);
    };
    const remove = document.createElement("button");
    remove.className = "venu-danger";
    remove.textContent = "Delete Band";
    remove.onclick = async () => {
        if (!confirm(`Delete ${name}?`)) return;
        DSP.removeFilterFromChannelPipeline(name, selectedChannel);
        await safeUpload(`${channelName()} PEQ ${bandNo} deleted`);
        renderAll();
    };
    actions.append(flatten, remove);
    right.appendChild(actions);
    root.append(left, right);
}

async function createPeqBand(slot) {
    const slots = mapPeqSlots();
    if (slots[slot]) return;
    const name = `USER_CH${selectedChannel}_PEQ_${String(slot + 1).padStart(2, "0")}`;
    const obj = {
        [name]: {
            type: "Biquad",
            description: `E-Stack PEQ ${slot + 1} - ${channelName()}`,
            parameters: {
                type: "Peaking",
                freq: PEQ_DEFAULT_FREQ[slot],
                gain: 0,
                q: 1
            }
        }
    };
    DSP.addFilter(obj, selectedChannel);
    await safeUpload(`${channelName()} PEQ ${slot + 1} created`);
    selectedPeqSlot = slot;
    renderAll();
}

function renderOutputControls(root) {
    const gainEntry = getGainEntry();
    const delayEntry = getDelayEntry();
    const [left, right] = controlColumns(channelName(), "Output level, polarity, mute and driver-alignment delay.");

    if (!systemEditEnabled) {
        const warning = document.createElement("p");
        warning.className = "danger-note";
        warning.textContent = "Press EDIT SYSTEM to change output settings.";
        left.appendChild(warning);
    }

    if (gainEntry) {
        const [name, filter] = gainEntry;
        const p = filter.parameters || {};
        right.appendChild(makeLinearParamRow("Gain", Number(p.gain || 0), -60, 12, .1, async value => {
            p.gain = Math.round(value * 10) / 10;
            await safeUpload(`${channelName()} output gain`);
            renderAll(false);
        }, !systemEditEnabled, "dB"));

        const polarityRow = document.createElement("div");
        polarityRow.className = "venu-param-row";
        const label = document.createElement("label");
        label.textContent = "Polarity";
        const choices = document.createElement("div");
        choices.className = "venu-choice-row";
        const normal = choiceButton("Normal", !p.inverted, !systemEditEnabled);
        const inverted = choiceButton("Inverted", !!p.inverted, !systemEditEnabled);
        normal.onclick = async () => { p.inverted = false; await safeUpload(`${channelName()} polarity normal`); renderAll(false); };
        inverted.onclick = async () => { p.inverted = true; await safeUpload(`${channelName()} polarity inverted`); renderAll(false); };
        choices.append(normal, inverted);
        const spacer = document.createElement("span");
        polarityRow.append(label, choices, spacer);
        right.appendChild(polarityRow);

        const muteRow = document.createElement("div");
        muteRow.className = "venu-param-row";
        const muteLabel = document.createElement("label");
        muteLabel.textContent = "Mute";
        const muteChoices = document.createElement("div");
        muteChoices.className = "venu-choice-row";
        const unmuted = choiceButton("On", !p.mute, !systemEditEnabled);
        const muted = choiceButton("Muted", !!p.mute, !systemEditEnabled);
        unmuted.onclick = async () => { p.mute = false; await safeUpload(`${channelName()} unmuted`); renderAll(false); };
        muted.onclick = async () => { p.mute = true; await safeUpload(`${channelName()} muted`); renderAll(false); };
        muteChoices.append(unmuted, muted);
        muteRow.append(muteLabel, muteChoices, document.createElement("span"));
        right.appendChild(muteRow);
        left.querySelector("p").textContent += ` Gain filter: ${name}.`;
    }

    if (delayEntry) {
        const [name, filter] = delayEntry;
        const p = filter.parameters || {};
        const unit = p.unit || "ms";
        right.appendChild(makeLinearParamRow("Delay", Number(p.delay || 0), 0, unit === "ms" ? 100 : 50000, unit === "ms" ? .01 : 1, async value => {
            p.delay = Number(value);
            await safeUpload(`${channelName()} alignment delay`);
            renderAll(false);
        }, !systemEditEnabled, unit));
        left.querySelector("p").textContent += ` Delay filter: ${name}.`;
    }

    root.append(left, right);
}

function renderProtectionControls(root) {
    const limiters = getLimiterEntries();
    const processors = getProcessorEntries();
    const [left, right] = controlColumns("Protection", "Speaker protection is part of the system configuration. Changes require EDIT SYSTEM.");

    if (!systemEditEnabled) {
        const warning = document.createElement("p");
        warning.className = "danger-note";
        warning.textContent = "Protection remains locked against accidental changes.";
        left.appendChild(warning);
    }

    for (const [name, filter] of limiters) {
        const p = filter.parameters || {};
        right.appendChild(makeLinearParamRow("Limiter threshold", Number(p.clip_limit ?? -3), -60, 0, .1, async value => {
            p.clip_limit = Math.round(value * 10) / 10;
            await safeUpload(`${channelName()} limiter threshold`);
            renderAll(false);
        }, !systemEditEnabled, "dBFS", name));
    }

    if (processors.length) {
        const list = document.createElement("div");
        list.className = "venu-protection-list";
        for (const [name, processor] of processors) {
            const item = document.createElement("div");
            item.className = "venu-protection-item";
            const n = document.createElement("strong");
            n.textContent = name;
            const details = document.createElement("span");
            details.textContent = `${processor?.type || "Processor"} · ${summarizeObject(processor?.parameters || {})}`;
            item.append(n, details);
            list.appendChild(item);
        }
        right.appendChild(list);
    }

    if (!limiters.length && !processors.length) {
        const empty = document.createElement("div");
        empty.className = "venu-protection-list";
        empty.textContent = "No limiter or processor found on this output.";
        right.appendChild(empty);
    }

    root.append(left, right);
}

function summarizeObject(obj) {
    return Object.entries(obj).slice(0, 6).map(([key, value]) => `${key} ${typeof value === "object" ? "…" : value}`).join(" · ");
}

function choiceButton(text, active, disabled) {
    const button = document.createElement("button");
    button.className = "venu-choice";
    button.classList.toggle("active", active);
    button.textContent = text;
    button.disabled = disabled;
    return button;
}

function makeSelectRow(labelText, value, options, onChange, disabled = false, formatter = value => String(value)) {
    const row = document.createElement("div");
    row.className = "venu-param-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    const empty = document.createElement("span");
    const select = document.createElement("select");
    for (const optionValue of options) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = formatter(optionValue);
        select.appendChild(option);
    }
    select.value = value;
    select.disabled = disabled;
    select.addEventListener("change", () => onChange(select.value));
    row.append(label, empty, select);
    return row;
}

function makeLinearParamRow(labelText, value, min, max, step, onChange, disabled = false, unit = "", detail = "") {
    const row = document.createElement("div");
    row.className = "venu-param-row";
    const label = document.createElement("label");
    label.textContent = detail ? `${labelText} · ${detail}` : labelText;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = clamp(value, min, max);
    slider.disabled = disabled;
    const number = document.createElement("input");
    number.type = "number";
    number.min = min;
    number.max = max;
    number.step = step;
    number.value = value;
    number.disabled = disabled;
    number.title = unit;

    slider.addEventListener("input", () => { number.value = slider.value; });
    slider.addEventListener("change", () => onChange(Number(slider.value)));
    number.addEventListener("change", () => {
        const next = clamp(Number(number.value), min, max);
        number.value = next;
        slider.value = next;
        onChange(next);
    });
    row.append(label, slider, number);
    return row;
}

function makeLogParamRow(labelText, value, min, max, onChange, disabled = false, unit = "") {
    const row = document.createElement("div");
    row.className = "venu-param-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 1000;
    slider.step = 1;
    slider.value = logToSlider(value, min, max);
    slider.disabled = disabled;
    const number = document.createElement("input");
    number.type = "number";
    number.min = min;
    number.max = max;
    number.step = 1;
    number.value = value;
    number.disabled = disabled;
    number.title = unit;

    slider.addEventListener("input", () => { number.value = Math.round(sliderToLog(Number(slider.value), min, max)); });
    slider.addEventListener("change", () => onChange(sliderToLog(Number(slider.value), min, max)));
    number.addEventListener("change", () => {
        const next = clamp(Number(number.value), min, max);
        number.value = next;
        slider.value = logToSlider(next, min, max);
        onChange(next);
    });
    row.append(label, slider, number);
    return row;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
}

function logToSlider(value, min, max) {
    const v = clamp(value, min, max);
    return Math.round(1000 * Math.log(v / min) / Math.log(max / min));
}

function sliderToLog(value, min, max) {
    return min * Math.pow(max / min, clamp(value, 0, 1000) / 1000);
}

function renderAll(download = false) {
    const work = async () => {
        if (download) await DSP.downloadConfig();
        renderChannelTabs();
        renderModuleTabs();
        renderHeader();
        renderBandSelector();
        renderControls();
        updateCount();
        drawGraph();
    };
    work().catch(error => {
        console.error(error);
        setStatus(error?.message || String(error), "error");
    });
}

function canvasSetup() {
    const canvas = document.getElementById("responseCanvas");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(600, Math.round(rect.width));
    const height = Math.max(260, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas, ctx, width, height };
}

function drawGraph() {
    const { ctx, width, height } = canvasSetup();
    const margin = { left: 48, right: 18, top: 16, bottom: 30 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const range = graphRange();

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1d1f20";
    ctx.fillRect(0, 0, width, height);

    drawRta(ctx, margin, innerW, innerH, range);
    drawGrid(ctx, margin, innerW, innerH, range);

    const freqs = logFrequencies(20, 20000, 420);
    const systemFilters = filterEntries().filter(([, filter]) => ["BiquadCombo", "Gain"].includes(filter?.type));
    const peqEntries = getPeqEntries();

    if (activeModule === "peq") {
        const slots = mapPeqSlots();
        slots.forEach((entry, index) => {
            if (!entry) return;
            const curve = freqs.map(freq => filterDb(entry[1], freq));
            drawFilledCurve(ctx, freqs, curve, margin, innerW, innerH, range, `hsla(${PEQ_COLORS[index]},68%,58%,.25)`, `hsl(${PEQ_COLORS[index]},68%,62%)`, 1.4);
        });
        const total = freqs.map(freq => sumDb(systemFilters.concat(peqEntries), freq));
        drawCurve(ctx, freqs, total, margin, innerW, innerH, range, "rgba(245,245,245,.95)", 2.2);
    } else if (activeModule === "crossover") {
        const crossovers = getCrossoverEntries();
        const curve = freqs.map(freq => sumDb(crossovers, freq));
        drawFilledCurve(ctx, freqs, curve, margin, innerW, innerH, range, "hsla(25,68%,50%,.34)", "hsl(25,72%,62%)", 2.2);
        const total = freqs.map(freq => sumDb(systemFilters.concat(peqEntries), freq));
        drawCurve(ctx, freqs, total, margin, innerW, innerH, range, "rgba(245,245,245,.82)", 1.4);
    } else if (activeModule === "output") {
        const total = freqs.map(freq => sumDb(systemFilters.concat(peqEntries), freq));
        drawCurve(ctx, freqs, total, margin, innerW, innerH, range, "rgba(245,245,245,.95)", 2.2);
    } else {
        const total = freqs.map(freq => sumDb(systemFilters.concat(peqEntries), freq));
        drawCurve(ctx, freqs, total, margin, innerW, innerH, range, "rgba(245,245,245,.7)", 1.5);
        for (const [, limiter] of getLimiterEntries()) {
            const threshold = Number(limiter?.parameters?.clip_limit);
            if (Number.isFinite(threshold)) drawHorizontal(ctx, threshold, margin, innerW, innerH, range, "rgba(220,70,70,.9)");
        }
    }
}

function graphRange() {
    if (activeModule === "crossover") return { min: -60, max: 12, step: 10 };
    if (activeModule === "protection") return { min: -60, max: 6, step: 10 };
    return { min: -20, max: 20, step: 5 };
}

function drawGrid(ctx, margin, innerW, innerH, range) {
    ctx.font = "11px Arial";
    ctx.lineWidth = 1;
    const freqTicks = [20, 40, 80, 160, 315, 630, 1250, 2500, 5000, 10000, 20000];
    for (const freq of freqTicks) {
        const x = margin.left + freqToX(freq, innerW);
        ctx.strokeStyle = "rgba(255,255,255,.13)";
        ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + innerH); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.48)";
        ctx.textAlign = freq === 20 ? "left" : freq === 20000 ? "right" : "center";
        ctx.fillText(formatFreq(freq), x, margin.top + innerH + 18);
    }

    for (let db = Math.ceil(range.min / range.step) * range.step; db <= range.max; db += range.step) {
        const y = margin.top + dbToY(db, innerH, range);
        ctx.strokeStyle = db === 0 ? "rgba(255,255,255,.32)" : "rgba(255,255,255,.12)";
        ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + innerW, y); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.48)";
        ctx.textAlign = "right";
        ctx.fillText(`${db}`, margin.left - 7, y + 4);
    }
}

function drawRta(ctx, margin, innerW, innerH, range) {
    if (!lastSpectrum.length || !window.parent.activeSettings?.enableSpectrum || !window.parent.activeSettings?.showEqualizerSpectrum) return;
    ctx.save();
    ctx.fillStyle = "rgba(55, 190, 165, .11)";
    for (let i = 0; i < Math.min(lastSpectrum.length, spectrumFreqs.length); i++) {
        const freq = spectrumFreqs[i];
        const next = spectrumFreqs[Math.min(i + 1, spectrumFreqs.length - 1)] * 1.03;
        const x1 = margin.left + freqToX(Math.max(20, freq / 1.08), innerW);
        const x2 = margin.left + freqToX(Math.min(20000, next), innerW);
        const level = clamp(lastSpectrum[i], -100, 0);
        const normalized = (level + 100) / 100;
        const h = innerH * normalized;
        ctx.fillRect(x1, margin.top + innerH - h, Math.max(1, x2 - x1 - 1), h);
    }
    ctx.restore();
}

function drawCurve(ctx, freqs, values, margin, innerW, innerH, range, color, lineWidth) {
    ctx.beginPath();
    values.forEach((db, index) => {
        const x = margin.left + freqToX(freqs[index], innerW);
        const y = margin.top + dbToY(clamp(db, range.min - 10, range.max + 10), innerH, range);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}

function drawFilledCurve(ctx, freqs, values, margin, innerW, innerH, range, fill, stroke, lineWidth) {
    const zeroY = margin.top + dbToY(0, innerH, range);
    ctx.beginPath();
    values.forEach((db, index) => {
        const x = margin.left + freqToX(freqs[index], innerW);
        const y = margin.top + dbToY(clamp(db, range.min - 10, range.max + 10), innerH, range);
        if (index === 0) ctx.moveTo(x, zeroY);
        ctx.lineTo(x, y);
    });
    ctx.lineTo(margin.left + innerW, zeroY);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    drawCurve(ctx, freqs, values, margin, innerW, innerH, range, stroke, lineWidth);
}

function drawHorizontal(ctx, db, margin, innerW, innerH, range, color) {
    const y = margin.top + dbToY(db, innerH, range);
    ctx.strokeStyle = color;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + innerW, y); ctx.stroke();
    ctx.setLineDash([]);
}

function freqToX(freq, width) {
    return width * Math.log(freq / 20) / Math.log(20000 / 20);
}

function dbToY(db, height, range) {
    return height * (range.max - db) / (range.max - range.min);
}

function formatFreq(freq) {
    if (freq >= 1000) return `${Number((freq / 1000).toFixed(freq >= 10000 ? 0 : 1))}k`;
    return String(freq);
}

function logFrequencies(min, max, count) {
    return Array.from({ length: count }, (_, i) => min * Math.pow(max / min, i / (count - 1)));
}

function sumDb(entries, freq) {
    return entries.reduce((sum, [, filter]) => sum + filterDb(filter, freq), 0);
}

function filterDb(filter, freq) {
    if (!filter) return 0;
    if (filter.type === "Gain") return Number(filter.parameters?.gain || 0);
    if (filter.type === "BiquadCombo") return comboDb(filter.parameters || {}, freq);
    if (filter.type === "Biquad") return rbjDb(filter.parameters || {}, freq);
    return 0;
}

function comboDb(p, freq) {
    const fc = Math.max(1, Number(p.freq || 1000));
    const order = Math.max(1, Number(p.order || 2));
    const type = String(p.type || "");
    const highpass = type.toLowerCase().includes("highpass");
    const lowpass = type.toLowerCase().includes("lowpass");
    if (!highpass && !lowpass) return 0;
    const ratio = lowpass ? freq / fc : fc / freq;
    let magnitude;
    if (type.startsWith("LinkwitzRiley")) {
        magnitude = 1 / (1 + Math.pow(ratio, order));
    } else {
        magnitude = 1 / Math.sqrt(1 + Math.pow(ratio, 2 * order));
    }
    return 20 * Math.log10(Math.max(1e-6, magnitude));
}

function rbjDb(p, freq) {
    const type = String(p.type || "Peaking");
    const f0 = clamp(Number(p.freq || 1000), 5, 23000);
    const gain = Number(p.gain || 0);
    const Q = Math.max(.05, Number(p.q || 1));
    const fs = Number(DSP.config?.devices?.samplerate || 48000);
    const w0 = 2 * Math.PI * f0 / fs;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    const A = Math.pow(10, gain / 40);
    let b0=1,b1=0,b2=0,a0=1,a1=0,a2=0;

    if (type === "Peaking") {
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else if (type === "Lowshelf" || type === "Highshelf") {
        const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
        if (type === "Lowshelf") {
            b0 = A*((A+1)-(A-1)*cw+twoSqrtAAlpha);
            b1 = 2*A*((A-1)-(A+1)*cw);
            b2 = A*((A+1)-(A-1)*cw-twoSqrtAAlpha);
            a0 = (A+1)+(A-1)*cw+twoSqrtAAlpha;
            a1 = -2*((A-1)+(A+1)*cw);
            a2 = (A+1)+(A-1)*cw-twoSqrtAAlpha;
        } else {
            b0 = A*((A+1)+(A-1)*cw+twoSqrtAAlpha);
            b1 = -2*A*((A-1)+(A+1)*cw);
            b2 = A*((A+1)+(A-1)*cw-twoSqrtAAlpha);
            a0 = (A+1)-(A-1)*cw+twoSqrtAAlpha;
            a1 = 2*((A-1)-(A+1)*cw);
            a2 = (A+1)-(A-1)*cw-twoSqrtAAlpha;
        }
    } else {
        return 0;
    }

    b0/=a0; b1/=a0; b2/=a0; a1/=a0; a2/=a0;
    const w = 2 * Math.PI * freq / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2*w), s2 = Math.sin(2*w);
    const nr = b0 + b1*c1 + b2*c2;
    const ni = -b1*s1 - b2*s2;
    const dr = 1 + a1*c1 + a2*c2;
    const di = -a1*s1 - a2*s2;
    const mag = Math.sqrt((nr*nr + ni*ni) / Math.max(1e-20, dr*dr + di*di));
    return 20 * Math.log10(Math.max(1e-8, mag));
}

function startSpectrum() {
    if (spectrumTimer) clearInterval(spectrumTimer);
    spectrumTimer = setInterval(async () => {
        try {
            if (!DSP?.spectrum_connected) return;
            const levels = await DSP.getSpectrumData();
            if (!Array.isArray(levels)) return;
            lastSpectrum = [];
            for (let i = 0; i < spectrumFreqs.length; i++) lastSpectrum.push(Number(levels[i * 2] ?? -100));
            drawGraph();
        } catch (_) {}
    }, 120);
}

async function clearPEQ() {
    if (!confirm("Delete all USER_ PEQ filters on all E-Stack outputs?")) return;
    for (const channel of activeChannels()) {
        for (const [name, filter] of [...getPeqEntries(channel)]) {
            if (isUserPeq(name, filter)) DSP.removeFilterFromChannelPipeline(name, channel);
        }
    }
    await safeUpload("All user PEQ cleared");
    renderAll();
}

async function resetPEQ() {
    let changed = false;
    for (const channel of activeChannels()) {
        for (const [, filter] of getPeqEntries(channel)) {
            filter.parameters.gain = 0;
            changed = true;
        }
    }
    if (changed) await safeUpload("All user PEQ flattened");
    renderAll();
}

function sortAll() {
    activeModule = "peq";
    renderAll();
}

async function addNewFilter() {
    activeModule = "peq";
    const slots = mapPeqSlots();
    const empty = slots.findIndex(entry => !entry);
    selectedPeqSlot = empty >= 0 ? empty : selectedPeqSlot;
    if (empty >= 0) await createPeqBand(empty);
    else renderAll();
}

async function estackEqualizerOnLoad() {
    DSP = await waitForDSP();
    window.DSP = DSP;
    await DSP.downloadConfig();
    selectedChannel = activeChannels()[0] ?? 0;

    document.getElementById("systemEditToggle").addEventListener("click", () => {
        if (!systemEditEnabled) {
            const ok = confirm("Enable system editing? This allows changes to crossovers, output gain/delay/polarity and limiter thresholds. PEQ editing does not require this mode.");
            if (!ok) return;
        }
        systemEditEnabled = !systemEditEnabled;
        renderAll();
    });

    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(drawGraph, 120);
    });

    renderAll();
    startSpectrum();
    setStatus("Select an output, then edit Crossover / PEQ / Output / Protection. System parameters are locked until EDIT SYSTEM is enabled.", "info");
}

window.addNewFilter = addNewFilter;
window.clearPEQ = clearPEQ;
window.resetPEQ = resetPEQ;
window.sortAll = sortAll;

document.addEventListener("DOMContentLoaded", estackEqualizerOnLoad);
