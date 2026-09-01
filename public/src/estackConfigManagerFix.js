// E-Stack system configuration manager.
// The sidebar "System Configurations" action stores/restores complete DSP
// processing snapshots independent of the page currently open. Hardware I/O
// devices and mixer routing remain owned by the live Raspberry configuration.

(function installEStackConfigManagerFix() {
    const SYSTEM_TYPE = "estack-system";
    const VERSION = 1;
    const CHANNELS = [0, 1, 2, 3, 4, 5];
    const PEQ_SLOTS = 10;
    const GLOBAL_SLOTS = 10;
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    let startupPoll = null;

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

    async function apiJson(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            cache: "no-store"
        });
        let body = {};
        try { body = await response.json(); }
        catch (_) {}
        if (!response.ok) throw new Error(body.reason || `Request failed (${response.status})`);
        return body;
    }

    function presetIndicatorText(state) {
        if (state?.activeOrigin !== "system") return "PRESET · Hardware YAML";
        const name = state.activeName || "Unknown";
        if (state.activeMissing) return `PRESET · ${name} · MISSING`;
        if (state.dirty === true) return `PRESET · ${name} · MODIFIED`;
        if (state.dirty === null) return `PRESET · ${name} · ?`;
        return `PRESET · ${name}`;
    }

    function startupText(state) {
        if (!state) return "Startup: —";
        if (state.resolutionError) return `Startup ERROR: ${state.resolutionError}`;
        if (state.mode === "specific") return `Startup: ${state.resolvedName || state.configName || "selected preset"}`;
        if (state.mode === "last") return `Startup: LAST USED → ${state.resolvedName || state.lastUsedName || "none"}`;
        return "Startup: Hardware YAML";
    }

    function renderStartupState(state) {
        const indicator = document.getElementById("presetInd");
        if (indicator) {
            indicator.textContent = presetIndicatorText(state);
            indicator.dataset.state = state?.dirty === true || state?.activeMissing ? "warning" : "ok";
            indicator.title = `${presetIndicatorText(state)} · ${startupText(state)}`;
        }

        const startupStatus = document.getElementById("startupConfigStatus");
        if (startupStatus) {
            startupStatus.textContent = startupText(state);
            startupStatus.dataset.state = state?.resolutionError ? "error" : "ok";
        }
    }

    async function refreshStartupState() {
        try {
            const state = await apiJson("/api/startup-config");
            renderStartupState(state);
            return state;
        } catch (error) {
            const indicator = document.getElementById("presetInd");
            if (indicator) {
                indicator.textContent = "PRESET · unavailable";
                indicator.dataset.state = "error";
                indicator.title = error.message;
            }
            const startupStatus = document.getElementById("startupConfigStatus");
            if (startupStatus) {
                startupStatus.textContent = `Startup status unavailable: ${error.message}`;
                startupStatus.dataset.state = "error";
            }
            return null;
        }
    }

    async function markActiveConfiguration(record) {
        if (!record?.id && !record?.name) return;
        await apiJson("/api/startup-config/active", {
            method: "POST",
            body: JSON.stringify({ configId: record.id, configName: record.name })
        });
        await refreshStartupState();
    }

    async function setStartupMode(mode) {
        const payload = { mode };
        if (mode === "specific") {
            const configName = document.getElementById("configName");
            const id = configName?.getAttribute("configId");
            const name = String(configName?.value || "").trim();
            if (!id) {
                status("Select a System Configuration first", "error");
                return;
            }
            payload.configId = id;
            payload.configName = name;
        }

        try {
            const result = await apiJson("/api/startup-config", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            renderStartupState(result);
            status(startupText(result), "ok");
        } catch (error) {
            status(`STARTUP ERROR: ${error.message}`, "error");
        }
    }

    function ensureStartupControls() {
        const dialog = document.getElementById("manageConfigs");
        const list = document.getElementById("configList");
        if (!dialog || !list || document.getElementById("startupConfigControls")) return;

        const wrapper = document.createElement("div");
        wrapper.id = "startupConfigControls";

        const label = document.createElement("div");
        label.id = "startupConfigStatus";
        label.textContent = "Startup: —";
        wrapper.appendChild(label);

        const buttons = document.createElement("div");
        buttons.className = "startupConfigButtons";
        const definitions = [
            ["Hardware YAML", "yaml"],
            ["Last used", "last"],
            ["Selected preset", "specific"]
        ];
        for (const [text, mode] of definitions) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = text;
            button.addEventListener("click", () => setStartupMode(mode));
            buttons.appendChild(button);
        }
        wrapper.appendChild(buttons);
        dialog.insertBefore(wrapper, list);
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
    window.refreshSystemPresetIndicator = refreshStartupState;

    window.showManageConfigs = async function() {
        const mod = document.getElementById("manageConfigs");
        const configList = document.getElementById("configList");
        const configName = document.getElementById("configName");
        if (!mod || !configList || !configName) return;

        ensureStartupControls();
        configName.value = "";
        configName.removeAttribute("configId");
        status("SYSTEM CONFIG · all DSP processing · hardware routing preserved");
        try {
            await Promise.all([
                window.loadConfigs(SYSTEM_TYPE, configList),
                refreshStartupState()
            ]);
        } catch (error) {
            status(`ERROR: ${error?.message || error}`, "error");
        }

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

            await markActiveConfiguration(record);
            await window.loadConfigs(SYSTEM_TYPE, configList);
            configName.value = "";
            configName.removeAttribute("configId");
            status(`'${name}' saved · now active`, "ok");
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
            await markActiveConfiguration(config);
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
            await refreshStartupState();
            status("System configuration deleted", "ok");
        } catch (error) {
            console.error("System configuration delete failed", error);
            status(`DELETE ERROR: ${error?.message || error}`, "error");
        }
    };

    window.addEventListener("DOMContentLoaded", () => {
        ensureStartupControls();
        refreshStartupState();
        if (startupPoll) clearInterval(startupPoll);
        startupPoll = setInterval(refreshStartupState, 6000);
    }, { once: true });
})();
