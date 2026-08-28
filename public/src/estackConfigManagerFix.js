// E-Stack configuration manager fixes.
// Makes the legacy dialog mobile-friendly/reliable and teaches it the E-Stack
// pages that live under /html/*.  Input-side presets are restored through the
// strict config guard so they cannot overwrite routing or speaker protection.

(function installEStackConfigManagerFix() {
    const GLOBAL_PREFIX = "GLOBAL_EQ_";
    const GLOBAL_STEP = "E-Stack global input EQ";
    const DELAY_FILTER = "ESTACK_INPUT_DELAY";
    const DELAY_STEP = "E-Stack input delay";
    const LOUDNESS_FILTER = "ESTACK_LOUDNESS";
    const LOUDNESS_STEP = "E-Stack loudness input stage";

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

    function relevantInputStep(step) {
        return step?.type === "Filter" && (
            step?.description === GLOBAL_STEP ||
            step?.description === DELAY_STEP ||
            (step.names || []).some(name => String(name).startsWith(GLOBAL_PREFIX) || name === DELAY_FILTER)
        );
    }

    function relevantLoudnessStep(step) {
        return step?.type === "Filter" && (
            step?.description === LOUDNESS_STEP ||
            (step.names || []).includes(LOUDNESS_FILTER)
        );
    }

    async function serializePage(page) {
        const DSP = window.DSP;
        if (!DSP) throw new Error("CamillaDSP is not connected");
        const frameDocument = document.getElementById("mainframe")?.contentWindow?.document;

        if (page === "connections") {
            return {
                server: frameDocument?.getElementById("server")?.value || "",
                port: frameDocument?.getElementById("port")?.value || "",
                spectrumPort: frameDocument?.getElementById("spectrumPort")?.value || ""
            };
        }

        await DSP.downloadConfig();
        const cfg = DSP.config;

        if (page === "loudness") {
            return {
                filter: clone(cfg.filters?.[LOUDNESS_FILTER] || null),
                step: clone((cfg.pipeline || []).find(relevantLoudnessStep) || null),
                preset: window.localStorage.getItem("estack.loudness.preset") || "reference"
            };
        }

        if (page === "input-processing") {
            const filters = {};
            for (const [name, filter] of Object.entries(cfg.filters || {})) {
                if (name.startsWith(GLOBAL_PREFIX) || name === DELAY_FILTER) filters[name] = clone(filter);
            }
            return {
                filters,
                steps: clone((cfg.pipeline || []).filter(relevantInputStep)),
                globalDisabled: Array.from({ length: 10 }, (_, slot) =>
                    window.localStorage.getItem(`estack.globalEq.disabled.${slot}`) === "true"
                )
            };
        }

        if (page === "basic") {
            const filters = {};
            for (const name of ["__subBass", "__bass", "__mids", "__upperMids", "__treble"]) {
                if (cfg.filters?.[name]) filters[name] = clone(cfg.filters[name]);
            }
            return {
                volume: await DSP.sendDSPMessage("GetVolume"),
                balance: await DSP.getBalance(),
                crossfeed: await DSP.getCrossfeed(),
                filters,
                mixers: clone(cfg.mixers)
            };
        }

        if (page === "equalizer") {
            return {
                title: cfg.title,
                filters: clone(cfg.filters),
                mixers: clone(cfg.mixers),
                pipeline: clone(cfg.pipeline)
            };
        }

        throw new Error(`Saving '${page || "this page"}' is not supported yet`);
    }

    function removeAllowedInputState(cfg) {
        for (const name of Object.keys(cfg.filters || {})) {
            if (name.startsWith(GLOBAL_PREFIX) || name === DELAY_FILTER) delete cfg.filters[name];
        }
        for (const step of (cfg.pipeline || [])) {
            if (step?.type !== "Filter" || !Array.isArray(step.names)) continue;
            step.names = step.names.filter(name => !String(name).startsWith(GLOBAL_PREFIX) && name !== DELAY_FILTER);
        }
        cfg.pipeline = (cfg.pipeline || []).filter(step => !(
            (step?.description === GLOBAL_STEP || step?.description === DELAY_STEP) && (step.names || []).length === 0
        ));
    }

    function insertStepsBeforeMixer(cfg, steps) {
        const mixerIndex = (cfg.pipeline || []).findIndex(step => step?.type === "Mixer");
        if (mixerIndex < 0) throw new Error("Mixer stage missing");
        const safeSteps = (steps || []).map(step => clone(step));
        cfg.pipeline.splice(mixerIndex, 0, ...safeSteps);
    }

    async function restoreInputProcessing(data) {
        const DSP = window.DSP;
        await DSP.downloadConfig();
        const before = DSP.estackConfigSnapshot?.() || clone(DSP.config);
        removeAllowedInputState(DSP.config);
        Object.assign(DSP.config.filters, clone(data?.filters || {}));
        insertStepsBeforeMixer(DSP.config, data?.steps || []);

        if (Array.isArray(data?.globalDisabled)) {
            data.globalDisabled.forEach((disabled, slot) => {
                window.localStorage.setItem(`estack.globalEq.disabled.${slot}`, String(!!disabled));
            });
        }

        await DSP.uploadConfigGuarded(before, {
            name: "Input Processing preset",
            allowedFilterNames: [DELAY_FILTER],
            allowedFilterPrefixes: [GLOBAL_PREFIX],
            allowedStepDescriptions: [GLOBAL_STEP, DELAY_STEP]
        });
        await DSP.downloadConfig();
    }

    async function restoreLoudness(data) {
        const DSP = window.DSP;
        await DSP.downloadConfig();
        const before = DSP.estackConfigSnapshot?.() || clone(DSP.config);

        for (const step of (DSP.config.pipeline || [])) {
            if (step?.type === "Filter" && Array.isArray(step.names)) {
                step.names = step.names.filter(name => name !== LOUDNESS_FILTER);
            }
        }
        DSP.config.pipeline = (DSP.config.pipeline || []).filter(step =>
            !(step?.description === LOUDNESS_STEP && (step.names || []).length === 0)
        );
        delete DSP.config.filters?.[LOUDNESS_FILTER];

        if (data?.filter && data?.step) {
            DSP.config.filters[LOUDNESS_FILTER] = clone(data.filter);
            insertStepsBeforeMixer(DSP.config, [data.step]);
        }

        await DSP.uploadConfigGuarded(before, {
            name: "Loudness preset",
            allowedFilterNames: [LOUDNESS_FILTER],
            allowedStepDescriptions: [LOUDNESS_STEP]
        });
        await DSP.downloadConfig();
        window.localStorage.setItem("estack.loudness.preset", data?.preset || "reference");
    }

    async function restoreLegacyPage(page, data, configName) {
        const DSP = window.DSP;
        const frameWindow = document.getElementById("mainframe")?.contentWindow;

        if (page === "connections") {
            const doc = frameWindow?.document;
            if (doc) {
                if (doc.getElementById("server")) doc.getElementById("server").value = data.server;
                if (doc.getElementById("port")) doc.getElementById("port").value = data.port;
                if (doc.getElementById("spectrumPort")) doc.getElementById("spectrumPort").value = data.spectrumPort;
            }
            return;
        }

        if (page === "basic") {
            await DSP.downloadConfig();
            if (Number.isFinite(Number(data.volume))) await DSP.sendDSPMessage({ SetVolume: Number(data.volume) });
            await DSP.setBalance(data.balance);
            await DSP.setCrossfeed(data.crossfeed);
            DSP.clearFilters();
            DSP.config.title = configName;
            DSP.addFilters(data.filters || {});
            await DSP.uploadConfig();
            await frameWindow?.loadData?.();
            return;
        }

        if (page === "equalizer") {
            await DSP.downloadConfig();
            // Keep current hardware routing. Legacy saved configs may contain an
            // old mixer snapshot; restoring it blindly is unsafe on E-Stack.
            DSP.clearFilters();
            DSP.config.title = configName;
            DSP.addFilters(data.filters || {});
            await DSP.uploadConfig();
            await frameWindow?.loadFiltersFromConfig?.();
            frameWindow?.plotConfig?.();
            return;
        }

        throw new Error(`Opening '${page || "this page"}' is not supported yet`);
    }

    window.getActivePage = activePage;

    window.showManageConfigs = async function() {
        const mod = document.getElementById("manageConfigs");
        const configList = document.getElementById("configList");
        const configName = document.getElementById("configName");
        const page = activePage();
        if (!mod || !configList || !configName) return;

        configName.value = "";
        configName.removeAttribute("configId");
        status(`Scope: ${page.replaceAll("-", " ")}`);
        try { await window.loadConfigs(page, configList); }
        catch (error) { status(`ERROR: ${error?.message || error}`, "error"); }

        configName.oninput = () => window.loadConfigs(page, configList, configName.value).catch(error => status(error.message, "error"));
        configName.onkeydown = event => {
            if (event.key === "Enter") {
                event.preventDefault();
                window.saveConfigurationClick();
            }
        };
        mod.showModal();
    };

    window.saveConfigurationClick = async function() {
        const page = activePage();
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
            const data = await serializePage(page);
            const record = { type: page, name, createdDate: new Date().toISOString(), data };
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

            await window.loadConfigs(page, configList);
            configName.value = "";
            configName.removeAttribute("configId");
            status(`'${name}' saved`, "ok");
        } catch (error) {
            console.error("Configuration save failed", error);
            status(`SAVE ERROR: ${error?.message || error}`, "error");
        }
    };

    window.openConfigurationClick = async function() {
        const page = activePage();
        const configName = document.getElementById("configName");
        const id = configName?.getAttribute("configId");
        if (!id) {
            status("Select a saved configuration first", "error");
            return;
        }

        try {
            status(`Opening '${configName.value}'…`, "busy");
            const config = await window.configsObject.getConfigByIdRemote(id);
            if (!config) throw new Error("Saved configuration not found");
            if (config.type !== page) throw new Error(`Preset belongs to ${config.type}`);

            if (page === "input-processing") await restoreInputProcessing(config.data);
            else if (page === "loudness") await restoreLoudness(config.data);
            else await restoreLegacyPage(page, config.data, configName.value);

            window.configsObject.saveLastConfigLocal(configName.value);
            status(`'${configName.value}' applied`, "ok");
            document.getElementById("manageConfigs")?.close();

            if (page === "input-processing" || page === "loudness") {
                const frame = document.getElementById("mainframe");
                if (frame) frame.src = frame.getAttribute("src") || frame.src;
            }
        } catch (error) {
            console.error("Configuration open failed", error);
            status(`OPEN ERROR: ${error?.message || error}`, "error");
        }
    };

    window.deleteConfigurationClick = async function() {
        const configName = document.getElementById("configName");
        const id = configName?.getAttribute("configId");
        const page = activePage();
        if (!id) {
            status("Select a saved configuration first", "error");
            return;
        }
        if (!confirm(`Delete '${configName.value}'?`)) return;

        try {
            status(`Deleting '${configName.value}'…`, "busy");
            const deleted = await window.configsObject.deleteRemote(id);
            if (!deleted) throw new Error("Configuration was not found");
            configName.value = "";
            configName.removeAttribute("configId");
            await window.loadConfigs(page, document.getElementById("configList"));
            status("Configuration deleted", "ok");
        } catch (error) {
            console.error("Configuration delete failed", error);
            status(`DELETE ERROR: ${error?.message || error}`, "error");
        }
    };
})();
