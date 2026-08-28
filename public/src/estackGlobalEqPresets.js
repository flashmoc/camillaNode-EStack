// E-Stack Global EQ import/preset manager.
// Scope is deliberately limited to GLOBAL_EQ_01..10. Input Delay and all
// downstream routing/protection remain outside this module.

(() => {
    const PRESET_TYPE = "global-eq";
    const MAX_BANDS = 10;
    const DEFAULT_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    let selectedPresetId = null;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
    const clone = value => JSON.parse(JSON.stringify(value));

    function normalizeType(value) {
        const raw = String(value || "Peaking").trim().toLowerCase();
        if (["ls", "lsc", "low", "lowshelf", "low_shelf", "low-shelf"].includes(raw)) return "Lowshelf";
        if (["hs", "hsc", "high", "highshelf", "high_shelf", "high-shelf"].includes(raw)) return "Highshelf";
        return "Peaking";
    }

    function normalizeBand(raw, fallbackFreq) {
        const freq = clamp(raw?.freq ?? raw?.frequency ?? raw?.fc ?? fallbackFreq, 20, 20000);
        const gain = clamp(raw?.gain ?? raw?.db ?? 0, -20, 20);
        const q = clamp(raw?.q ?? raw?.Q ?? 0.7, 0.1, 20);
        const enabled = raw?.enabled === undefined ? raw?.on !== false : !!raw.enabled;
        return {
            type: normalizeType(raw?.type ?? raw?.filterType ?? raw?.kind),
            freq: Math.round(freq * 10) / 10,
            gain: Math.round(gain * 10) / 10,
            q: Math.round(q * 100) / 100,
            enabled
        };
    }

    function parseJson(text) {
        let parsed;
        try { parsed = JSON.parse(text); }
        catch (_) { return null; }

        if (Array.isArray(parsed)) {
            return parsed.map((band, i) => normalizeBand(band, DEFAULT_FREQS[i] || 1000));
        }
        if (Array.isArray(parsed?.bands)) {
            return parsed.bands.map((band, i) => normalizeBand(band, DEFAULT_FREQS[i] || 1000));
        }
        if (parsed?.filters && typeof parsed.filters === "object") {
            const names = Object.keys(parsed.filters)
                .filter(name => /^GLOBAL_EQ_\d+$/i.test(name))
                .sort((a, b) => Number(a.match(/\d+$/)?.[0]) - Number(b.match(/\d+$/)?.[0]));
            if (names.length) {
                return names.map((name, i) => {
                    const filter = parsed.filters[name] || {};
                    return normalizeBand(filter.parameters || filter, DEFAULT_FREQS[i] || 1000);
                });
            }
        }
        return null;
    }

    function parseApoLine(line) {
        const freq = line.match(/\bFc\s*=?\s*([-+]?\d*\.?\d+)\s*Hz\b/i);
        const gain = line.match(/\bGain\s*=?\s*([-+]?\d*\.?\d+)\s*dB\b/i);
        if (!freq || !gain) return null;

        const q = line.match(/\bQ\s*=?\s*([-+]?\d*\.?\d+)/i);
        const typeToken = line.match(/\b(PK|PEQ|LSC?|HSC?|LOWSHELF|HIGHSHELF)\b/i)?.[1] || "PK";
        return normalizeBand({
            type: typeToken,
            freq: Number(freq[1]),
            gain: Number(gain[1]),
            q: q ? Number(q[1]) : 0.7,
            enabled: !/\bOFF\b/i.test(line)
        }, 1000);
    }

    function parseTableLine(line) {
        const clean = line.replace(/#.*/, "").replace(/\/\/.*/, "").trim();
        if (!clean || /freq|frequency|gain/i.test(clean) && !/[-+]?\d/.test(clean)) return null;
        const numbers = clean.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)?.map(Number) || [];
        if (numbers.length < 3) return null;

        let start = 0;
        if (numbers.length >= 4 && Number.isInteger(numbers[0]) && numbers[0] >= 1 && numbers[0] <= 99 && numbers[1] >= 20) start = 1;
        const [freq, gain, q] = numbers.slice(start, start + 3);
        if (!(freq >= 20 && freq <= 20000) || !(gain >= -60 && gain <= 60) || !(q > 0 && q <= 100)) return null;

        const typeToken = clean.match(/\b(PK|PEQ|LSC?|HSC?|LOWSHELF|HIGHSHELF)\b/i)?.[1] || "PK";
        return normalizeBand({ type: typeToken, freq, gain, q, enabled: !/\bOFF\b/i.test(clean) }, freq);
    }

    function parseEqText(text) {
        const input = String(text || "").trim();
        if (!input) throw new Error("Paste an EQ or choose a file first");

        const jsonBands = parseJson(input);
        if (jsonBands?.length) return jsonBands.slice(0, MAX_BANDS);

        const lines = input.split(/\r?\n/);
        const apo = lines.map(parseApoLine).filter(Boolean);
        if (apo.length) return apo.slice(0, MAX_BANDS);

        const table = lines.map(parseTableLine).filter(Boolean);
        if (table.length) return table.slice(0, MAX_BANDS);

        throw new Error("Unsupported EQ format. Use REW/Equalizer APO, freq-gain-Q text/CSV, or E-Stack JSON.");
    }

    function currentBands() {
        const result = [];
        for (let slot = 0; slot < MAX_BANDS; slot++) {
            const filter = typeof window.globalEqFilter === "function" ? window.globalEqFilter(slot) : null;
            const p = filter?.parameters || {};
            result.push(normalizeBand({
                type: p.type || "Peaking",
                freq: p.freq ?? DEFAULT_FREQS[slot],
                gain: p.gain ?? 0,
                q: p.q ?? 0.7,
                enabled: typeof window.globalEqIsExplicitlyDisabled === "function"
                    ? !window.globalEqIsExplicitlyDisabled(slot)
                    : true
            }, DEFAULT_FREQS[slot]));
        }
        return result;
    }

    async function applyBands(inputBands, reason) {
        if (!window.globalEqDSP || typeof window.globalEqUpload !== "function") {
            throw new Error("Global EQ is not ready yet");
        }

        await window.globalEqDSP.downloadConfig();
        const bands = inputBands.slice(0, MAX_BANDS);

        for (let slot = 0; slot < MAX_BANDS; slot++) {
            const band = slot < bands.length
                ? normalizeBand(bands[slot], DEFAULT_FREQS[slot])
                : normalizeBand({ freq: DEFAULT_FREQS[slot], gain: 0, q: 0.7, type: "Peaking", enabled: true }, DEFAULT_FREQS[slot]);
            const filter = window.globalEqEnsureFilter(slot);
            filter.parameters = {
                type: band.type,
                freq: band.freq,
                gain: band.gain,
                q: band.q
            };
            window.globalEqSetExplicitlyDisabled(slot, !band.enabled);
            window.globalEqRemoveFromPipeline(slot);
        }

        for (let slot = 0; slot < MAX_BANDS; slot++) window.globalEqSyncBandPipeline(slot);
        const ok = await window.globalEqUpload(reason);
        if (!ok) throw new Error("CamillaDSP rejected the EQ");
        window.globalEqRender?.();
        return true;
    }

    function store() {
        const value = window.parent?.configsObject;
        if (!value) throw new Error("CamillaNode preset storage is unavailable");
        return value;
    }

    function ensureImportDialog() {
        let dialog = document.getElementById("globalEqImportDialog");
        if (dialog) return dialog;
        dialog = document.createElement("dialog");
        dialog.id = "globalEqImportDialog";
        dialog.className = "global-eq-tool-dialog";
        dialog.innerHTML = `
            <div class="global-eq-dialog-head"><strong>Import Global EQ</strong><button type="button" data-close>×</button></div>
            <p>Paste REW / Equalizer APO, CSV or <code>freq gain Q</code> text, or choose a TXT/CSV/JSON file.</p>
            <textarea id="globalEqImportText" spellcheck="false" placeholder="Filter 1: ON PK Fc 63 Hz Gain 2.5 dB Q 0.70\nFilter 2: ON PK Fc 125 Hz Gain -1.5 dB Q 1.00"></textarea>
            <input id="globalEqImportFile" type="file" accept=".txt,.csv,.tsv,.json,.eq,.peq,text/plain,application/json" hidden>
            <div id="globalEqImportStatus" class="global-eq-dialog-status"></div>
            <div class="global-eq-dialog-actions">
                <button type="button" data-file>CHOOSE FILE</button>
                <button type="button" data-cancel>CANCEL</button>
                <button type="button" class="primary" data-import>IMPORT EQ</button>
            </div>`;
        document.body.appendChild(dialog);

        const text = dialog.querySelector("#globalEqImportText");
        const file = dialog.querySelector("#globalEqImportFile");
        const status = dialog.querySelector("#globalEqImportStatus");
        dialog.querySelector("[data-file]").onclick = () => file.click();
        dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
        dialog.querySelector("[data-close]").onclick = () => dialog.close();
        file.onchange = async () => {
            const selected = file.files?.[0];
            if (!selected) return;
            text.value = await selected.text();
            status.textContent = `${selected.name} loaded`;
            status.dataset.state = "ok";
        };
        dialog.querySelector("[data-import]").onclick = async () => {
            try {
                status.textContent = "Parsing and applying EQ…";
                status.dataset.state = "busy";
                const bands = parseEqText(text.value);
                await applyBands(bands, `Imported Global EQ (${bands.length} band${bands.length === 1 ? "" : "s"})`);
                status.textContent = `${bands.length} band${bands.length === 1 ? "" : "s"} imported`;
                status.dataset.state = "ok";
                setTimeout(() => dialog.close(), 350);
            } catch (error) {
                status.textContent = error?.message || String(error);
                status.dataset.state = "error";
            }
        };
        return dialog;
    }

    function ensurePresetDialog() {
        let dialog = document.getElementById("globalEqPresetDialog");
        if (dialog) return dialog;
        dialog = document.createElement("dialog");
        dialog.id = "globalEqPresetDialog";
        dialog.className = "global-eq-tool-dialog global-eq-preset-dialog";
        dialog.innerHTML = `
            <div class="global-eq-dialog-head"><strong>Global EQ Presets</strong><button type="button" data-close>×</button></div>
            <div class="global-eq-preset-name-row"><input id="globalEqPresetName" type="text" autocomplete="off" placeholder="Preset name"><button type="button" data-save>SAVE CURRENT EQ</button></div>
            <div id="globalEqPresetList" class="global-eq-preset-list"></div>
            <div id="globalEqPresetStatus" class="global-eq-dialog-status"></div>
            <div class="global-eq-dialog-actions">
                <button type="button" data-delete>DELETE</button>
                <button type="button" data-close-bottom>CLOSE</button>
                <button type="button" class="primary" data-load>LOAD EQ</button>
            </div>`;
        document.body.appendChild(dialog);

        dialog.querySelector("[data-close]").onclick = () => dialog.close();
        dialog.querySelector("[data-close-bottom]").onclick = () => dialog.close();
        dialog.querySelector("[data-save]").onclick = savePreset;
        dialog.querySelector("[data-load]").onclick = loadSelectedPreset;
        dialog.querySelector("[data-delete]").onclick = deleteSelectedPreset;
        return dialog;
    }

    function presetStatus(message, state = "info") {
        const el = document.getElementById("globalEqPresetStatus");
        if (!el) return;
        el.textContent = message;
        el.dataset.state = state;
    }

    async function refreshPresetList() {
        const dialog = ensurePresetDialog();
        const list = dialog.querySelector("#globalEqPresetList");
        const records = await store().loadConfigsRemote(PRESET_TYPE, true);
        list.replaceChildren();
        selectedPresetId = null;

        if (!records.length) {
            const empty = document.createElement("div");
            empty.className = "global-eq-preset-empty";
            empty.textContent = "No saved Global EQ presets yet.";
            list.appendChild(empty);
            return;
        }

        for (const record of records) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "global-eq-preset-item";
            button.dataset.id = String(record.id);
            button.innerHTML = `<strong></strong><span></span>`;
            button.querySelector("strong").textContent = record.name;
            const count = Array.isArray(record.data?.bands) ? record.data.bands.length : 0;
            button.querySelector("span").textContent = `${count || 10} bands`;
            button.onclick = () => {
                selectedPresetId = String(record.id);
                list.querySelectorAll(".global-eq-preset-item").forEach(item => item.classList.toggle("selected", item === button));
                dialog.querySelector("#globalEqPresetName").value = record.name;
                presetStatus(`Selected '${record.name}'`);
            };
            list.appendChild(button);
        }
    }

    async function savePreset() {
        const dialog = ensurePresetDialog();
        const nameInput = dialog.querySelector("#globalEqPresetName");
        const name = String(nameInput.value || "").trim();
        if (name.length < 2) {
            presetStatus("Enter a preset name", "error");
            nameInput.focus();
            return;
        }

        const record = {
            type: PRESET_TYPE,
            name,
            createdDate: new Date().toISOString(),
            data: {
                format: "estack-global-eq-v1",
                bands: clone(currentBands())
            }
        };

        try {
            presetStatus(`Saving '${name}'…`, "busy");
            try {
                await store().saveConfigRemote(record, false);
            } catch (error) {
                const exists = Array.isArray(error) && error[1] === "exists";
                if (!exists) throw error;
                if (!confirm(`'${name}' already exists. Replace it?`)) {
                    presetStatus("Save cancelled");
                    return;
                }
                await store().saveConfigRemote(record, true);
            }
            await refreshPresetList();
            presetStatus(`'${name}' saved`, "ok");
        } catch (error) {
            presetStatus(`SAVE ERROR: ${error?.message || error}`, "error");
        }
    }

    async function loadSelectedPreset() {
        if (!selectedPresetId) {
            presetStatus("Select a preset first", "error");
            return;
        }
        try {
            presetStatus("Loading EQ…", "busy");
            const record = await store().getConfigByIdRemote(selectedPresetId);
            if (!record || record.type !== PRESET_TYPE || !Array.isArray(record.data?.bands)) throw new Error("Invalid Global EQ preset");
            await applyBands(record.data.bands, `Global EQ preset '${record.name}'`);
            presetStatus(`'${record.name}' applied`, "ok");
            setTimeout(() => document.getElementById("globalEqPresetDialog")?.close(), 350);
        } catch (error) {
            presetStatus(`LOAD ERROR: ${error?.message || error}`, "error");
        }
    }

    async function deleteSelectedPreset() {
        if (!selectedPresetId) {
            presetStatus("Select a preset first", "error");
            return;
        }
        const record = await store().getConfigByIdRemote(selectedPresetId);
        if (!record) return;
        if (!confirm(`Delete '${record.name}'?`)) return;
        try {
            await store().deleteRemote(selectedPresetId);
            await refreshPresetList();
            presetStatus(`'${record.name}' deleted`, "ok");
        } catch (error) {
            presetStatus(`DELETE ERROR: ${error?.message || error}`, "error");
        }
    }

    function installToolbar() {
        const head = document.querySelector(".global-v2-eq-head");
        const reset = document.getElementById("globalEqResetAll");
        if (!head || !reset || head.querySelector(".global-eq-preset-actions")) return false;

        const actions = document.createElement("div");
        actions.className = "global-eq-preset-actions";
        const importButton = document.createElement("button");
        importButton.type = "button";
        importButton.className = "global-eq-tool-button";
        importButton.textContent = "IMPORT EQ";
        importButton.onclick = () => ensureImportDialog().showModal();

        const presetsButton = document.createElement("button");
        presetsButton.type = "button";
        presetsButton.className = "global-eq-tool-button";
        presetsButton.textContent = "EQ PRESETS";
        presetsButton.onclick = async () => {
            const dialog = ensurePresetDialog();
            dialog.querySelector("#globalEqPresetName").value = "";
            presetStatus("Loading presets…", "busy");
            dialog.showModal();
            try {
                await refreshPresetList();
                presetStatus("Select a preset or save the current EQ");
            } catch (error) {
                presetStatus(`ERROR: ${error?.message || error}`, "error");
            }
        };

        actions.append(importButton, presetsButton, reset);
        head.appendChild(actions);
        return true;
    }

    function start() {
        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            if (installToolbar() || attempts > 50) clearInterval(timer);
        }, 100);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
})();
