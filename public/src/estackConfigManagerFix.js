// E-Stack system configuration manager.
// The sidebar "Configurations" action stores/restores complete DSP processing
// snapshots independent of the page currently open. Hardware I/O devices and
// mixer routing remain owned by the live Raspberry configuration.

(function installEStackConfigManagerFix() {
    const SYSTEM_TYPE = "estack-system";
    const VERSION = 1;
    const CHANNELS = [0, 1, 2, 3, 4, 5];
    const PEQ_SLOTS = 10;
    const GLOBAL_SLOTS = 10;
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

    function activePage() {
        const frame = document.getElementById("mainframe");
        if (!frame) return "";
        let path = "";
        try { path = new URL(frame.src, window.location.href).pathname; }
        catch (_) { path = String(frame.getAttribute("src") || ""); }

        if (path.endsWith("/html/loudness.html")) return "loudness";
        if (path.endsWith("/html/global-eq.html")) return "input-processing";
        if (path.endsWith("/basic")) return "basic";
        if (path.endsWith("/equalizer")) return "equalizer";
        if (path.endsWith("/advanced")) return "advanced";
        if (path.endsWith("/preferences")) return "preferences";
        if (path.endsWith("/connections")) return "connections";
        return path.split("/").filter(Boolean).pop() || "";
    }

    function status(message, state = "info") {
        const dialog = document.getElementById("manageConfigs");
        if (!dialog) return;
        let el = document.getElementById("configManagerStatus");
        if (!el) {
            el = document.createElement("div");
            el.id = "configManagerStatus";
            el.style.cssText = "min-height:20px;margin:6px 0;font-size:12px;opacity:.75";
            const list = document.getElementById("configList");
            dialog.insertBefore(el, list || dialog.firstChild);
        }
        el.textContent = message;
        el.dataset.state = state;
        el.style.color = state === "error" ? "#ff9b9b" : state === "ok" ? "#7fd8b2" : state === "busy" ? "#ffd37a" : "";
    }

    function snapshotUiState() {
        const peq = [];
        for (const channel of CHANNELS) {
            for (let slot = 0; slot < PEQ_SLOTS; slot++) {
                peq.push({
                    channel,
                    slot,
                    disabled: window.localStorage.getItem(`estack.peq.disabled.${channel}.${slot}`) === "true",
                    lastGain: Number(window.localStorage.getItem(`estack.peq.lastgain.${channel}.${slot}`) || 0)
                });
            }
        }
        return {
            peq,
            globalDisabled: Array.from({ length: GLOBAL_SLOTS }, (_, slot) =>
                window.localStorage.getItem(`estack.globalEq.disabled.${slot}`) === "true"
            ),
            loudnessPreset: window.localStorage.getItem("estack.loudness.preset") || "reference"
        };
    }

    function restoreUiState(ui) {
        if (Array.isArray(ui?.peq)) {
            for (const item of ui.peq) {
                const channel = Number(item.channel);
                const slot = Number(item.slot);
                if (!CHANNELS.includes(channel) || slot < 0 || slot >= PEQ_SLOTS) continue;
                window.localStorage.setItem(`estack.peq.disabled.${channel}.${slot}`, String(!!item.disabled));
                window.localStorage.setItem(`estack.peq.lastgain.${channel}.${slot}`, String(Number(item.lastGain) || 0));
            }
        }
        if (Array.isArray(ui?.globalDisabled)) {
            ui.globalDisabled.slice(0, GLOBAL_SLOTS).forEach((disabled, slot) =>
                window.localStorage.setItem(`estack.globalEq.disabled.${slot}`, String(!!disabled))
            );
        }
        if (typeof ui?.loudnessPreset === "string") {
            window.localStorage.setItem("estack.loudness.preset", ui.loudnessPreset);
        }
    }

    function validateProcessingSnapshot(processing, liveMixers) {
        if (!processing || typeof processing !== "object") throw new Error("Invalid system configuration");
        if (!processing.filters || typeof processing.filters !== "object") throw new Error("Saved filters are missing");
        if (!Array.isArray(processing.pipeline)) throw new Error("Saved pipeline is missing");

        const filters = processing.filters;
        const processors = processing.processors || {};
        const mixerNames = new Set(Object.keys(liveMixers || {}));

        for (const step of processing.pipeline) {
            if (step?.type === "Mixer" && !mixerNames.has(step.name)) {
                throw new Error(`Saved configuration expects unavailable mixer '${step.name}'`);
            }
            if (step?.type === "Filter") {
                for (const name of (step.names || [])) {
                    if (!filters[name]) throw new Error(`Saved pipeline references missing filter '${name}'`);
                }
            }
            if (step?.type === "Processor") {
                for (const name of (step.names || [])) {
                    if (!processors[name]) throw new Error(`Saved pipeline references missing processor '${name}'`);
                }
            }
        }
    }

    async function serializeSystemConfiguration() {
        const DSP = window.DSP;
        if (!DSP) throw new Error("CamillaDSP is not connected");
        await DSP.downloadConfig();
        const cfg = DSP.config || {};

        return {
            version: VERSION,
            sourcePage: activePage(),
            processing: {
                title: cfg.title || "",
                filters: clone(cfg.filters || {}),
                pipeline: clone(cfg.pipeline || []),
                processors: clone(cfg.processors || {})
            },
            ui: snapshotUiState()
        };
    }

    async function restoreSystemConfiguration(data, configName) {
        const DSP = window.DSP;
        if (!DSP) throw new Error("CamillaDSP is not connected");
        if (!data?.processing) throw new Error("This is not a full E-Stack system configuration");

        await DSP.downloadConfig();
        validateProcessingSnapshot(data.processing, DSP.config?.mixers);

        // Intentionally preserve the live Raspberry hardware layer:
        // devices/chunksize/ALSA settings and mixer routing are not recalled.
        DSP.config.filters = clone(data.processing.filters || {});
        DSP.config.pipeline = clone(data.processing.pipeline || []);
        DSP.config.processors = clone(data.processing.processors || {});
        DSP.config.title = configName;

        await DSP.uploadConfig();
        await DSP.downloadConfig();
        restoreUiState(data.ui || {});

        const frame = document.getElementById("mainframe");
        if (frame) frame.src = frame.getAttribute("src") || frame.src;
    }

    window.getActivePage = activePage;

    window.showManageConfigs = async function() {
        const mod = document.getElementById("manageConfigs");
        const configList = document.getElementById("configList");
        const configName = document.getElementById("configName");
        if (!mod || !configList || !configName) return;

        configName.value = "";
        configName.removeAttribute("configId");
        status("SYSTEM CONFIG · all DSP processing · hardware routing preserved");
        try { await window.loadConfigs(SYSTEM_TYPE, configList); }
        catch (error) { status(`ERROR: ${error?.message || error}`, "error"); }

        configName.oninput = () => window.loadConfigs(SYSTEM_TYPE, configList, configName.value)
            .catch(error => status(error.message, "error"));
        configName.onkeydown = event => {
            if (event.key === "Enter") {
                event.preventDefault();
                window.saveConfigurationClick();
            }
        };
        mod.showModal();
    };

    window.saveConfigurationClick = async function() {
        const configName = document.getElementById("configName");
        const configList = document.getElementById("configList");
        const name = String(configName?.value || "").trim();
        if (name.length < 3) {
            status("Name must contain at least 3 characters", "error");
            configName?.focus();
            return;
        }

        try {
            status(`Saving full system configuration '${name}'…`, "busy");
            const data = await serializeSystemConfiguration();
            const record = {
                type: SYSTEM_TYPE,
                name,
                createdDate: new Date().toISOString(),
                data
            };
            try {
                await window.configsObject.saveConfigRemote(record, false);
            } catch (error) {
                const reason = Array.isArray(error) ? error[1] : null;
                if (reason !== "exists") throw error;
                if (!confirm(`'${name}' already exists. Replace it?`)) {
                    status("Save cancelled");
                    return;
                }
                await window.configsObject.saveConfigRemote(record, true);
            }

            await window.loadConfigs(SYSTEM_TYPE, configList);
            configName.value = "";
            configName.removeAttribute("configId");
            status(`'${name}' saved · XO / PEQ / gain / delay / polarity / phase / dynamics`, "ok");
        } catch (error) {
            console.error("System configuration save failed", error);
            status(`SAVE ERROR: ${error?.message || error}`, "error");
        }
    };

    window.openConfigurationClick = async function() {
        const configName = document.getElementById("configName");
        const id = configName?.getAttribute("configId");
        if (!id) {
            status("Select a saved system configuration first", "error");
            return;
        }

        try {
            status(`Applying full system configuration '${configName.value}'…`, "busy");
            const config = await window.configsObject.getConfigByIdRemote(id);
            if (!config) throw new Error("Saved configuration not found");
            if (config.type !== SYSTEM_TYPE) throw new Error("Legacy page preset cannot be opened as a system configuration");

            await restoreSystemConfiguration(config.data || {}, configName.value);
            window.configsObject.saveLastConfigLocal(configName.value);
            status(`'${configName.value}' applied`, "ok");
            document.getElementById("manageConfigs")?.close();
        } catch (error) {
            console.error("System configuration open failed", error);
            status(`OPEN ERROR: ${error?.message || error}`, "error");
        }
    };

    window.deleteConfigurationClick = async function() {
        const configName = document.getElementById("configName");
        const id = configName?.getAttribute("configId");
        if (!id) {
            status("Select a saved system configuration first", "error");
            return;
        }
        if (!confirm(`Delete '${configName.value}'?`)) return;

        try {
            status(`Deleting '${configName.value}'…`, "busy");
            const deleted = await window.configsObject.deleteRemote(id);
            if (!deleted) throw new Error("Configuration was not found");
            configName.value = "";
            configName.removeAttribute("configId");
            await window.loadConfigs(SYSTEM_TYPE, document.getElementById("configList"));
            status("System configuration deleted", "ok");
        } catch (error) {
            console.error("System configuration delete failed", error);
            status(`DELETE ERROR: ${error?.message || error}`, "error");
        }
    };
})();
