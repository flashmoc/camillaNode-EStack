// E-Stack processor visibility compatibility.
// CamillaDSP Processor pipeline steps may omit `channels` and instead declare
// the actual channel(s) inside the processor definition, e.g.
// processors.<name>.parameters.process_channels.
// Older CamillaNode renderers only looked at pipelineStep.channels, which made
// valid E-Stack compressor protection invisible in both Advanced and Protection.

(function () {
    function processorChannels(step, dsp) {
        if (Array.isArray(step?.channels) && step.channels.length) {
            return step.channels.map(Number);
        }
        if (step?.channel !== undefined && step?.channel !== null) {
            return [Number(step.channel)];
        }
        if (step?.type !== "Processor") return [];

        const processor = dsp?.config?.processors?.[step.name];
        const p = processor?.parameters || {};
        const channels = p.process_channels || p.monitor_channels || [];
        return Array.isArray(channels) ? channels.map(Number) : [];
    }

    // Equalizer / Protection page: replace the legacy channel resolver so the
    // existing getProcessorEntries() immediately sees compressor processors.
    if (typeof window.stepChannels === "function") {
        window.stepChannels = function (step) {
            if (step?.type === "Processor") {
                return processorChannels(step, window.DSP || window.parent?.DSP);
            }
            if (Array.isArray(step?.channels)) return step.channels.map(Number);
            if (step?.channel !== undefined && step?.channel !== null) return [Number(step.channel)];
            return [];
        };
    }

    // Advanced page: keep the stock pipeline rendering and then inject the
    // missing processor node into each affected channel. Insert it immediately
    // before the hard limiter when present, matching the real pipeline order.
    if (typeof window.loadPipeline === "function") {
        const originalLoadPipeline = window.loadPipeline;

        window.loadPipeline = async function (element, DSP) {
            const result = await originalLoadPipeline(element, DSP);

            const pipeline = DSP?.config?.pipeline || [];
            const processors = DSP?.config?.processors || {};
            const channelRows = [...element.querySelectorAll(".pipelineChannel")];

            for (const step of pipeline) {
                if (step?.type !== "Processor" || !step.name) continue;
                const processor = processors[step.name];
                if (!processor) continue;

                const channels = processorChannels(step, DSP);
                for (const channel of channels) {
                    const row = channelRows.find(el => Number(el.getAttribute("channel")) === Number(channel));
                    if (!row) continue;
                    if (row.querySelector(`[data-estack-processor="${CSS.escape(step.name)}"]`)) continue;

                    const node = document.createElement("div");
                    node.className = "pipelineElement processorNode";
                    node.setAttribute("nodeType", "processor");
                    node.setAttribute("data-estack-processor", step.name);

                    const p = processor.parameters || {};
                    const details = [
                        step.name,
                        processor.type || "Processor"
                    ];
                    if (p.threshold !== undefined) details.push(`Threshold ${p.threshold}dB`);
                    if (p.factor !== undefined) details.push(`Ratio ${p.factor}:1`);
                    if (p.attack !== undefined) details.push(`Attack ${p.attack}s`);
                    if (p.release !== undefined) details.push(`Release ${p.release}s`);
                    node.innerText = details.join("\n");

                    const limiterNode = [...row.querySelectorAll(".pipelineElement")].find(el =>
                        /hard_limit/i.test(el.id || el.textContent || "")
                    );
                    if (limiterNode) row.insertBefore(node, limiterNode);
                    else row.appendChild(node);
                }
            }

            return result;
        };
    }
})();
