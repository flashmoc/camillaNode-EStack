// E-Stack safe Output Processing presets.
//
// The legacy configuration manager stored the complete DSP graph for the
// equalizer page. Restoring such a snapshot can overwrite crossovers, limiters,
// processors or routing. This wrapper scopes Output Processing presets to:
//   - USER_* Biquad PEQ definitions + their active output assignments
//   - existing post-mixer Gain / Delay filter definitions
// Everything else remains owned by the live hardware configuration.

(function installSafeOutputPresets() {
    const USER_PREFIX = "USER_";
    const CHANNELS = [0, 1, 2, 3, 4, 5];
    const PEQ_SLOTS = 10;
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

    const baseSave = window.saveConfigurationClick;
    const baseOpen = window.openConfigurationClick;

    function isOutputPage() {
        return typeof window.getActivePage === "function" && window.getActivePage() === "equalizer";
    }

    function status(message, state = "info") {
        let el = document.getElementById("configManagerStatus");
        const dialog = document.getElementById("manageConfigs");
        if (!dialog) return;
        if (!el) {
            el = document.createElement("div");
            el.id = "configManagerStatus";
            el.style.cssText = "min-height:20px;margin:6px 0;font-size:12px;opacity:.75";
            dialog.insertBefore(el, document.getElementById("configList") || dialog.firstChild);
        }
        el.textContent = message;
        el.dataset.state = state;
        el.style.color = state === "error" ? "#ff9b9b" : state === "ok" ? "#7fd8b2" : state === "busy" ? "#ffd37a" : "";
    }

    function stepChannels(step) {
        if (Array.isArray(step?.channels)) return step.channels.map(Number);
        if (step?.channel !== undefined && step?.channel !== null) return [Number(step.channel)];
        return [];
    }

    function firstMixerIndex(cfg) {
        return (cfg?.pipeline || []).findIndex(step => step?.type === "Mixer");
    }

    function postMixerFilterSteps(cfg) {
        const mixerIndex = firstMixerIndex(cfg);
        if (mixerIndex < 0) return [];
        return (cfg.pipeline || [])
            .map((step, index) => ({ step, index }))
            .filter(item => item.index > mixerIndex && item.step?.type === "Filter");
    }

    function safeFixedOutputNames(cfg) {
        const names = new Set();
        for (const { step } of postMixerFilterSteps(cfg)) {
            if (!stepChannels(step).some(channel => CHANNELS.includes(channel))) continue;
            for (const name of (step.names || [])) {
                const type = cfg?.filters?.[name]?.type;
                if (type === "Gain" || type === "Delay") names.add(name);
            }
        }
        return names;
    }

    function userAssignmentsFromPipeline(cfg) {
        const result = [];
        for (const { step } of postMixerFilterSteps(cfg)) {
            const channels = stepChannels(step).filter(channel => CHANNELS.includes(channel));
            if (!channels.length) continue;
            for (const name of (step.names || [])) {
                if (!String(name).startsWith(USER_PREFIX)) continue;
                result.push({ name, channels: [...channels] });
            }
        }
        return result;
    }

    function peqStateSnapshot() {
        const result = [];
        for (const channel of CHANNELS) {
            for (let slot = 0; slot < PEQ_SLOTS; slot++) {
                result.push({
                    channel,
                    slot,
                    disabled: window.localStorage.getItem(`estack.peq.disabled.${channel}.${slot}`) === "true",
                    lastGain: Number(window.localStorage.getItem(`estack.peq.lastgain.${channel}.${slot}`) || 0)
                });
            }
        }
        return result;
    }

    async function serializeOutputPreset() {
        const DSP = window.DSP;
        if (!DSP) throw new Error("CamillaDSP is not connected");
        await DSP.downloadConfig();
        const cfg = DSP.config;
        const fixedNames = safeFixedOutputNames(cfg);
        const filters = {};

        for (const [name, filter] of Object.entries(cfg.filters || {})) {
            if (String(name).startsWith(USER_PREFIX) && filter?.type === "Biquad") {
                filters[name] = clone(filter);
            } else if (fixedNames.has(name) && ["Gain", "Delay"].includes(filter?.type)) {
                filters[name] = clone(filter);
            }
        }

        return {
            version: 2,
            title: cfg.title || "",
            filters,
            assignments: userAssignmentsFromPipeline(cfg),
            peqState: peqStateSnapshot()
        };
    }

    function assignmentsFromSaved(data) {
        if (Array.isArray(data?.assignments)) return clone(data.assignments);
        // Backward compatibility: old equalizer presets stored the full pipeline.
        if (!Array.isArray(data?.pipeline)) return [];
        const result = [];
        for (const step of data.pipeline) {
            if (step?.type !== "Filter") continue;
            const channels = stepChannels(step).filter(channel => CHANNELS.includes(channel));
            for (const name of (step.names || [])) {
                if (String(name).startsWith(USER_PREFIX)) result.push({ name, channels: [...channels] });
            }
        }
        return result;
    }

    function detachAllUserPeq(cfg) {
        for (const step of (cfg.pipeline || [])) {
            if (step?.type !== "Filter" || !Array.isArray(step.names)) continue;
            step.names = step.names.filter(name => !String(name).startsWith(USER_PREFIX));
        }
        for (const name of Object.keys(cfg.filters || {})) {
            if (String(name).startsWith(USER_PREFIX)) delete cfg.filters[name];
        }
    }

    function outputStepForChannel(cfg, channel) {
        const steps = postMixerFilterSteps(cfg)
            .filter(({ step }) => stepChannels(step).includes(Number(channel)))
            .map(item => item.step);
        if (!steps.length) return null;

        const withGain = steps.find(step => (step.names || []).some(name => cfg?.filters?.[name]?.type === "Gain"));
        if (withGain) return withGain;
        const withDelay = steps.find(step => (step.names || []).some(name => cfg?.filters?.[name]?.type === "Delay"));
        if (withDelay) return withDelay;
        return steps[0];
    }

    function attachUserBeforeGain(cfg, name, channel) {
        const step = outputStepForChannel(cfg, channel);
        if (!step) throw new Error(`No output filter stage found for channel ${channel + 1}`);
        if (!Array.isArray(step.names)) step.names = [];
        step.names = step.names.filter(item => item !== name);

        let index = step.names.findIndex(item => cfg?.filters?.[item]?.type === "Gain");
        if (index < 0) index = step.names.findIndex(item => cfg?.filters?.[item]?.type === "Delay");
        if (index < 0) index = step.names.findIndex(item => cfg?.filters?.[item]?.type === "Limiter");
        if (index < 0) index = step.names.length;
        step.names.splice(index, 0, name);
    }

    function savedUserFilters(data) {
        const result = {};
        for (const [name, filter] of Object.entries(data?.filters || {})) {
            if (String(name).startsWith(USER_PREFIX) && filter?.type === "Biquad") result[name] = clone(filter);
        }
        return result;
    }

    function restorePeqLocalState(data, userFilters, assignments) {
        const assignmentNames = new Set(assignments.map(item => item.name));
        const savedState = Array.isArray(data?.peqState) ? data.peqState : null;

        if (savedState) {
            for (const item of savedState) {
                const channel = Number(item.channel);
                const slot = Number(item.slot);
                if (!CHANNELS.includes(channel) || slot < 0 || slot >= PEQ_SLOTS) continue;
                window.localStorage.setItem(`estack.peq.disabled.${channel}.${slot}`, String(!!item.disabled));
                window.localStorage.setItem(`estack.peq.lastgain.${channel}.${slot}`, String(Number(item.lastGain) || 0));
            }
            return;
        }

        // Old preset: infer disabled state from pipeline membership. Neutral
        // filters are treated as enabled-but-bypassed rather than disabled.
        for (const channel of CHANNELS) {
            for (let slot = 0; slot < PEQ_SLOTS; slot++) {
                const stableName = `USER_CH${channel}_PEQ_${String(slot + 1).padStart(2, "0")}`;
                const filter = userFilters[stableName];
                const gain = Number(filter?.parameters?.gain || 0);
                const disabled = !!filter && Math.abs(gain) >= .05 && !assignmentNames.has(stableName);
                window.localStorage.setItem(`estack.peq.disabled.${channel}.${slot}`, String(disabled));
                window.localStorage.setItem(`estack.peq.lastgain.${channel}.${slot}`, String(gain));
            }
        }
    }

    async function restoreOutputPreset(data, configName) {
        const DSP = window.DSP;
        await DSP.downloadConfig();
        const before = DSP.estackConfigSnapshot?.() || clone(DSP.config);
        const currentFixed = safeFixedOutputNames(DSP.config);
        const allowedExact = [...currentFixed];
        const userFilters = savedUserFilters(data);
        const assignments = assignmentsFromSaved(data)
            .filter(item => userFilters[item.name])
            .map(item => ({
                name: item.name,
                channels: (item.channels || []).map(Number).filter(channel => CHANNELS.includes(channel))
            }));

        detachAllUserPeq(DSP.config);
        Object.assign(DSP.config.filters, userFilters);

        // Fixed output Gain/Delay: update the definition only if that same stage
        // exists in the current hardware graph and the filter type still matches.
        for (const name of currentFixed) {
            const current = DSP.config.filters?.[name];
            const saved = data?.filters?.[name];
            if (!current || !saved) continue;
            if (!["Gain", "Delay"].includes(current.type) || saved.type !== current.type) continue;
            DSP.config.filters[name] = clone(saved);
        }

        for (const assignment of assignments) {
            for (const channel of assignment.channels) attachUserBeforeGain(DSP.config, assignment.name, channel);
        }
        restorePeqLocalState(data, userFilters, assignments);
        DSP.config.title = configName;

        if (typeof DSP.uploadConfigGuarded !== "function") throw new Error("E-Stack config guard is unavailable");
        await DSP.uploadConfigGuarded(before, {
            name: "Output Processing preset",
            allowedFilterNames: allowedExact,
            allowedFilterPrefixes: [USER_PREFIX]
        });
        await DSP.downloadConfig();
    }

    window.saveConfigurationClick = async function() {
        if (!isOutputPage()) return baseSave?.();

        const configName = document.getElementById("configName");
        const configList = document.getElementById("configList");
        const name = String(configName?.value || "").trim();
        if (name.length < 3) {
            status("Name must contain at least 3 characters", "error");
            configName?.focus();
            return;
        }

        try {
            status(`Saving '${name}'…`, "busy");
            const data = await serializeOutputPreset();
            const record = { type: "equalizer", name, createdDate: new Date().toISOString(), data };
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

            await window.loadConfigs("equalizer", configList);
            configName.value = "";
            configName.removeAttribute("configId");
            status(`'${name}' saved · USER EQ + output Gain/Delay`, "ok");
        } catch (error) {
            console.error("Safe Output Processing preset save failed", error);
            status(`SAVE ERROR: ${error?.message || error}`, "error");
        }
    };

    window.openConfigurationClick = async function() {
        if (!isOutputPage()) return baseOpen?.();

        const configName = document.getElementById("configName");
        const id = configName?.getAttribute("configId");
        if (!id) {
            status("Select a saved configuration first", "error");
            return;
        }

        try {
            status(`Opening '${configName.value}' safely…`, "busy");
            const config = await window.configsObject.getConfigByIdRemote(id);
            if (!config) throw new Error("Saved configuration not found");
            if (config.type !== "equalizer") throw new Error(`Preset belongs to ${config.type}`);

            await restoreOutputPreset(config.data || {}, configName.value);
            window.configsObject.saveLastConfigLocal(configName.value);
            status(`'${configName.value}' applied · protected graph unchanged`, "ok");
            document.getElementById("manageConfigs")?.close();

            const frame = document.getElementById("mainframe");
            if (frame) frame.src = frame.src;
        } catch (error) {
            console.error("Safe Output Processing preset open failed", error);
            status(`OPEN ERROR: ${error?.message || error}`, "error");
        }
    };
})();
