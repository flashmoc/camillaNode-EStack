(function () {
    function formatDeviceNode(kind, component) {
        const cfg = window.parent?.DSP?.config?.devices || {};
        const cfgDevice = kind === "input" ? (cfg.capture || {}) : (cfg.playback || {});
        const dev = component?.device || {};
        const merged = { ...cfgDevice, ...dev };
        const type = String(merged.type || "Device");
        const lines = [kind.toUpperCase(), type];

        if (type === "SignalGenerator") {
            const signal = { ...(cfgDevice.signal || {}), ...(dev.signal || {}) };
            if (signal.type) lines.push(String(signal.type));
            if (signal.freq !== undefined) lines.push(`${signal.freq} Hz`);
            if (signal.level !== undefined) lines.push(`${signal.level} dBFS`);
        } else if (type === "ALSA") {
            if (merged.device) lines.push(String(merged.device));
            if (merged.format) lines.push(String(merged.format));
        } else if (type === "File") {
            if (merged.filename) lines.push(String(merged.filename));
            if (merged.format) lines.push(String(merged.format));
        } else {
            if (merged.device) lines.push(String(merged.device));
            else if (merged.filename) lines.push(String(merged.filename));
            if (merged.format) lines.push(String(merged.format));
        }

        if (merged.channels !== undefined) lines.push(`${merged.channels} ch`);
        return lines.filter(v => v !== "undefined" && v !== "null").join("\n");
    }

    function relabelAdvancedDevices() {
        const channels = window.channels;
        if (!Array.isArray(channels)) return;
        const rows = document.querySelectorAll("#pipelineContainer .pipelineChannel");

        rows.forEach((row, channelIndex) => {
            const components = channels[channelIndex] || [];
            const inputComponent = components.find(c => c?.type === "input");
            const outputComponent = components.find(c => c?.type === "output");
            const inputNode = row.querySelector(".inputNode");
            const outputNode = row.querySelector(".outputNode");

            if (inputNode && inputComponent) inputNode.innerText = formatDeviceNode("input", inputComponent);
            if (outputNode && outputComponent) outputNode.innerText = formatDeviceNode("output", outputComponent);
        });
    }

    function install() {
        const container = document.getElementById("pipelineContainer");
        if (!container) return;

        const observer = new MutationObserver(() => {
            requestAnimationFrame(relabelAdvancedDevices);
        });
        observer.observe(container, { childList: true, subtree: true });

        setTimeout(relabelAdvancedDevices, 100);
        setTimeout(relabelAdvancedDevices, 500);
    }

    document.addEventListener("DOMContentLoaded", install);
})();
