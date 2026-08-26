const EStackControlChannels = {
    0: { name: "SUB", color: "#ff9f43" },
    1: { name: "KICK", color: "#ffd166" },
    2: { name: "MID L", color: "#29d3c2" },
    3: { name: "MID R", color: "#42a5f5" },
    4: { name: "HIGH L", color: "#a78bfa" },
    5: { name: "HIGH R", color: "#f472b6" }
};

let DSP;
let meterTimer;
let meterStrips = new Map();

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

function setMixerStatus(message, state = "info") {
    const el = document.getElementById("mixerStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.state = state;
}

function activeOutputs() {
    return DSP.getActiveOutputChannels().filter(ch => ch >= 0 && ch <= 5);
}

function gainEntryForChannel(channel) {
    const names = DSP.getChannelFiltersList(channel);
    for (const name of names) {
        const filter = DSP.config?.filters?.[name];
        if (filter?.type === "Gain") return [name, filter];
    }
    return null;
}

function protectedFingerprint(config) {
    return JSON.stringify({
        pipeline: config?.pipeline || [],
        processors: config?.processors || {},
        mixers: config?.mixers || {}
    });
}

async function updateOutputGain(channel, gain, mute = null) {
    const entry = gainEntryForChannel(channel);
    if (!entry) {
        setMixerStatus(`${EStackControlChannels[channel]?.name || `OUT ${channel + 1}`}: no Gain filter found`, "error");
        return false;
    }

    const [name, filter] = entry;
    const fingerprint = protectedFingerprint(DSP.config);
    filter.parameters = filter.parameters || {};
    filter.parameters.gain = Number(gain);
    if (mute !== null) filter.parameters.mute = !!mute;

    try {
        const ok = await DSP.uploadConfig();
        if (!ok) throw new Error("CamillaDSP rejected config");
        await DSP.downloadConfig();
        if (protectedFingerprint(DSP.config) !== fingerprint) {
            throw new Error("protected DSP structure changed");
        }
        setMixerStatus(`${EStackControlChannels[channel]?.name}: ${Number(gain).toFixed(1)} dB · applied`, "ok");
        return true;
    } catch (error) {
        console.error("Output gain update failed", error);
        setMixerStatus(`Gain update failed: ${error?.message || error}`, "error");
        return false;
    }
}

function makeMeter() {
    const meter = document.createElement("div");
    meter.className = "estack-level-meter";
    meter.innerHTML = `
        <div class="estack-meter-scale">
            <span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-40</span><span>-60</span>
        </div>
        <div class="estack-meter-track">
            <div class="estack-meter-fill"></div>
            <div class="estack-meter-peak"></div>
        </div>`;
    return meter;
}

function makeFader({ id, value, min, max, step, color, label, sublabel, onCommit, onMute, muted = false, isMaster = false }) {
    const strip = document.createElement("article");
    strip.className = `estack-mixer-strip${isMaster ? " master" : ""}`;
    strip.style.setProperty("--channel-color", color || "hsl(var(--bck-hue), 65%, 58%)");

    const head = document.createElement("div");
    head.className = "estack-strip-head";
    head.innerHTML = `<strong>${label}</strong><span>${sublabel || ""}</span>`;

    const meter = makeMeter();

    const faderWrap = document.createElement("div");
    faderWrap.className = "estack-fader-wrap";
    const fader = document.createElement("input");
    fader.id = id;
    fader.className = "estack-vertical-fader";
    fader.type = "range";
    fader.min = min;
    fader.max = max;
    fader.step = step;
    fader.value = value;

    const unity = document.createElement("div");
    unity.className = "estack-unity-mark";
    unity.title = "0 dB";
    faderWrap.append(fader, unity);

    const valueBox = document.createElement("div");
    valueBox.className = "estack-fader-value";
    valueBox.textContent = `${Number(value).toFixed(1)} dB`;

    fader.addEventListener("input", () => {
        valueBox.textContent = `${Number(fader.value).toFixed(1)} dB`;
    });
    fader.addEventListener("change", async () => {
        fader.disabled = true;
        try { await onCommit(Number(fader.value)); }
        finally { fader.disabled = false; }
    });

    const controls = document.createElement("div");
    controls.className = "estack-strip-actions";

    if (onMute) {
        const mute = document.createElement("button");
        mute.className = "estack-mute-button";
        mute.classList.toggle("active", muted);
        mute.textContent = muted ? "MUTED" : "MUTE";
        mute.addEventListener("click", async () => {
            mute.disabled = true;
            const next = !mute.classList.contains("active");
            const ok = await onMute(next, Number(fader.value));
            if (ok) {
                mute.classList.toggle("active", next);
                mute.textContent = next ? "MUTED" : "MUTE";
            }
            mute.disabled = false;
        });
        controls.appendChild(mute);
    }

    const center = document.createElement("div");
    center.className = "estack-strip-center";
    center.append(meter, faderWrap);

    strip.append(head, center, valueBox, controls);
    return { strip, meterFill: meter.querySelector(".estack-meter-fill"), meterPeak: meter.querySelector(".estack-meter-peak") };
}

function dbToMeterPercent(db) {
    const value = Math.max(-60, Math.min(0, Number(db)));
    return ((value + 60) / 60) * 100;
}

function updateMeterElement(parts, db) {
    if (!parts) return;
    const percent = dbToMeterPercent(db);
    parts.meterFill.style.height = `${percent}%`;
    parts.meterFill.dataset.zone = db > -3 ? "clip" : db > -10 ? "hot" : "normal";

    const peak = Math.max(-60, Math.min(0, Number(db)));
    parts.meterPeak.style.bottom = `${dbToMeterPercent(peak)}%`;
}

async function startMeters() {
    if (meterTimer) clearInterval(meterTimer);
    meterTimer = setInterval(async () => {
        try {
            if (!DSP?.connected) return;
            const peaks = await DSP.sendDSPMessage("GetPlaybackSignalPeak");
            if (!Array.isArray(peaks)) return;

            let masterPeak = -60;
            for (const channel of activeOutputs()) {
                const db = Number(peaks[channel] ?? -60);
                masterPeak = Math.max(masterPeak, db);
                updateMeterElement(meterStrips.get(channel), db);
            }
            updateMeterElement(meterStrips.get("master"), masterPeak);
        } catch (_) {}
    }, 120);
}

async function loadBasic() {
    DSP = await waitForDSP();
    await DSP.downloadConfig();

    const root = document.getElementById("estackMixerStrips");
    root.replaceChildren();
    meterStrips.clear();

    let masterValue = -20;
    try {
        const current = Number(await DSP.sendDSPMessage("GetVolume"));
        if (Number.isFinite(current)) masterValue = current;
    } catch (_) {}

    const master = makeFader({
        id: "masterVolume",
        value: masterValue,
        min: -90,
        max: 0,
        step: .5,
        color: "hsl(var(--bck-hue), 65%, 60%)",
        label: "MASTER",
        sublabel: "DSP volume",
        isMaster: true,
        onCommit: async gain => {
            await DSP.sendDSPMessage({ SetVolume: gain });
            setMixerStatus(`Master: ${gain.toFixed(1)} dB`, "ok");
        }
    });
    root.appendChild(master.strip);
    meterStrips.set("master", master);

    for (const channel of activeOutputs()) {
        const meta = EStackControlChannels[channel];
        const entry = gainEntryForChannel(channel);
        const gain = Number(entry?.[1]?.parameters?.gain ?? 0);
        const muted = !!entry?.[1]?.parameters?.mute;

        const parts = makeFader({
            id: `outputGain${channel}`,
            value: gain,
            min: -60,
            max: 12,
            step: .1,
            color: meta.color,
            label: meta.name,
            sublabel: `OUT ${channel + 1}${entry ? ` · ${entry[0]}` : " · no Gain filter"}`,
            muted,
            onCommit: value => updateOutputGain(channel, value),
            onMute: (mute, currentGain) => updateOutputGain(channel, currentGain, mute)
        });

        if (!entry) {
            parts.strip.classList.add("disabled");
            parts.strip.querySelector(".estack-vertical-fader").disabled = true;
            const mute = parts.strip.querySelector(".estack-mute-button");
            if (mute) mute.disabled = true;
        }

        root.appendChild(parts.strip);
        meterStrips.set(channel, parts);
    }

    setMixerStatus("Connected · output gain controls ready", "ok");
    startMeters();
}

window.addEventListener("beforeunload", () => {
    if (meterTimer) clearInterval(meterTimer);
});

document.addEventListener("DOMContentLoaded", loadBasic);
