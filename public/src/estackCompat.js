// E-Stack compatibility layer for CamillaDSP 4.x.
//
// CamillaNode 2.0.38 was written for an older CamillaDSP pipeline schema where
// Filter pipeline steps used `channel: N`. CamillaDSP 4.x uses `channels: [N]`.
// This module keeps legacy configs readable while preserving modern CamillaDSP
// configs (including processors, routing, crossovers and protection filters).

function channelsForStep(step) {
    if (Array.isArray(step?.channels)) return step.channels.map(Number);
    if (step?.channel !== undefined && step?.channel !== null) return [Number(step.channel)];
    return [];
}

function stepHasChannel(step, channelNo) {
    return step?.type === "Filter" && channelsForStep(step).includes(Number(channelNo));
}

function filterType(config, name) {
    return config?.filters?.[name]?.type;
}

function insertBeforeLimiter(config, step, filterName) {
    if (!Array.isArray(step.names)) step.names = [];
    if (step.names.includes(filterName)) return;

    const limiterIndex = step.names.findIndex(name => filterType(config, name) === "Limiter");
    if (limiterIndex >= 0) step.names.splice(limiterIndex, 0, filterName);
    else step.names.push(filterName);
}

function firstMixerContext(config) {
    const pipeline = config?.pipeline || [];
    const index = pipeline.findIndex(step => step?.type === "Mixer");
    if (index < 0) return null;
    const step = pipeline[index];
    const mixer = config?.mixers?.[step.name];
    if (!mixer) return null;
    return { index, step, mixer };
}

function sourceChannelsForOutput(config, outputChannel) {
    const context = firstMixerContext(config);
    if (!context) return [];
    const mapping = (context.mixer?.mapping || []).find(map => Number(map?.dest) === Number(outputChannel));
    if (!mapping) return [];
    return [...new Set((mapping.sources || [])
        .map(source => Number(source?.channel))
        .filter(Number.isFinite))];
}

// A pre-mixer filter belongs to the effective output chain when that output is
// fed from one of the filtered input channels. This is important for E-Stack's
// Global EQ: it lives on INPUT L/R before routing, but acoustically affects all
// six routed outputs. Post-mixer steps still use normal output-channel matching.
function effectiveFilterStepsForOutput(config, outputChannel) {
    const pipeline = config?.pipeline || [];
    const context = firstMixerContext(config);
    if (!context) return pipeline.filter(step => stepHasChannel(step, outputChannel));

    const sources = new Set(sourceChannelsForOutput(config, outputChannel));
    const result = [];

    pipeline.forEach((step, index) => {
        if (step?.type !== "Filter") return;
        const stepChannels = channelsForStep(step);
        if (index < context.index) {
            if (stepChannels.some(channel => sources.has(channel))) result.push(step);
            return;
        }
        if (index > context.index && stepChannels.includes(Number(outputChannel))) result.push(step);
    });

    return result;
}

function pathItemKey(item) {
    if (!item) return "unknown";
    if (item.type === "filter") {
        const name = Object.keys(item).find(key => key !== "type") || "filter";
        return `filter:${name}`;
    }
    if (item.type === "processor") return `processor:${item.name || "processor"}`;
    if (item.type === "mixer") return `mixer:${JSON.stringify(item.sources || [])}`;
    return item.type || "item";
}

export default function installEStackCompatibility(camillaDSP) {
    if (!camillaDSP || camillaDSP.__estackCompatInstalled) return camillaDSP;
    camillaDSP.__estackCompatInstalled = true;

    const p = camillaDSP.prototype;

    p._channelsForStep = channelsForStep;
    p._stepHasChannel = stepHasChannel;

    // Direct channel steps only. Mutation helpers intentionally use this direct
    // view so an output edit can never rewrite a pre-mixer input/global step.
    p.getFilterStepsForChannel = function(channelNo) {
        if (!Array.isArray(this.config?.pipeline)) return [];
        return this.config.pipeline.filter(step => stepHasChannel(step, channelNo));
    };

    p.getActiveOutputChannels = function() {
        const channels = new Set();
        const mixers = this.config?.mixers || {};

        for (const mixer of Object.values(mixers)) {
            for (const mapping of (mixer?.mapping || [])) {
                if (Number.isInteger(Number(mapping?.dest))) channels.add(Number(mapping.dest));
            }
        }

        // Prefer explicit mixer destinations: on E-Stack this avoids treating
        // unused DAC outputs as user-EQ channels.
        if (channels.size > 0) return [...channels].sort((a, b) => a - b);

        const count = Number(this.config?.devices?.playback?.channels || 0);
        return Array.from({ length: count }, (_, i) => i);
    };

    p.getChannelCount = function() {
        let maxChannel = -1;

        const playback = Number(this.config?.devices?.playback?.channels || 0);
        const capture = Number(this.config?.devices?.capture?.channels || 0);
        maxChannel = Math.max(maxChannel, playback - 1, capture - 1);

        for (const mixer of Object.values(this.config?.mixers || {})) {
            maxChannel = Math.max(
                maxChannel,
                Number(mixer?.channels?.in || 0) - 1,
                Number(mixer?.channels?.out || 0) - 1
            );
            for (const mapping of (mixer?.mapping || [])) {
                maxChannel = Math.max(maxChannel, Number(mapping?.dest ?? -1));
                for (const source of (mapping?.sources || [])) {
                    maxChannel = Math.max(maxChannel, Number(source?.channel ?? -1));
                }
            }
        }

        for (const step of (this.config?.pipeline || [])) {
            for (const channel of channelsForStep(step)) maxChannel = Math.max(maxChannel, channel);
        }

        return maxChannel + 1;
    };

    // Effective output-chain view. It includes pre-mixer filters inherited from
    // the routed input channels, then the direct post-mixer output filters.
    p.getChannelFiltersList = function(channelNo) {
        const names = [];
        for (const step of effectiveFilterStepsForOutput(this.config, channelNo)) {
            for (const name of (step.names || [])) {
                if (!names.includes(name)) names.push(name);
            }
        }
        return names;
    };

    // Preserve the complete CamillaDSP 4.x configuration. The upstream method
    // rebuilt a reduced object and reset `processors` to {}, which is unsafe for
    // a crossover/protection configuration such as E-Stack.
    p.getDefaultConfig = function(config) {
        if (!config || typeof config !== "object") config = {};
        if (!config.devices) config.devices = {};
        if (!config.filters) config.filters = {};
        if (!config.mixers) config.mixers = {};
        if (!Array.isArray(config.pipeline)) config.pipeline = [];
        if (!config.processors) config.processors = {};
        return config;
    };

    p.initAfterConnection = async function() {
        await this.downloadConfig();
        this.config = this.getDefaultConfig(this.config);
        return true;
    };

    p.addFilterToChannelPipeline = function(filter, channelNo) {
        const filterName = Object.keys(filter || {})[0];
        if (!filterName) return false;

        let steps = this.getFilterStepsForChannel(channelNo);

        if (steps.length === 0) {
            // Add a dedicated modern CamillaDSP 4.x Filter step. It is appended
            // after existing routing; this path is mainly a fallback because
            // E-Stack already has per-output Filter steps.
            const step = {
                type: "Filter",
                channels: [Number(channelNo)],
                names: [],
                description: `E-Stack user filters - channel ${channelNo}`,
                bypassed: false
            };
            this.config.pipeline.push(step);
            steps = [step];
        }

        // Prefer the last matching step. If it is shared by several channels and
        // this is a per-channel operation, split only this channel out so the
        // change cannot leak to another output.
        let step = steps[steps.length - 1];
        const stepChannels = channelsForStep(step);
        if (stepChannels.length > 1) {
            const idx = this.config.pipeline.indexOf(step);
            const remaining = stepChannels.filter(ch => ch !== Number(channelNo));
            if (remaining.length > 0) step.channels = remaining;

            step = {
                ...step,
                channels: [Number(channelNo)],
                names: [...(step.names || [])]
            };
            delete step.channel;
            this.config.pipeline.splice(idx + 1, 0, step);
        } else {
            step.channels = [Number(channelNo)];
            delete step.channel;
        }

        insertBeforeLimiter(this.config, step, filterName);
        return true;
    };

    p.removeFilterFromChannelPipeline = function(filterName, channelNo) {
        const steps = [...this.getFilterStepsForChannel(channelNo)];
        let changed = false;

        for (const original of steps) {
            if (!(original.names || []).includes(filterName)) continue;

            let step = original;
            const stepChannels = channelsForStep(original);
            if (stepChannels.length > 1) {
                const idx = this.config.pipeline.indexOf(original);
                original.channels = stepChannels.filter(ch => ch !== Number(channelNo));
                step = {
                    ...original,
                    channels: [Number(channelNo)],
                    names: [...(original.names || [])]
                };
                delete step.channel;
                this.config.pipeline.splice(idx + 1, 0, step);
            }

            step.names = (step.names || []).filter(name => name !== filterName);
            changed = true;
        }

        if (changed && !this.isFilterInPipeline(filterName)) delete this.config.filters[filterName];
        return changed;
    };

    p.isFilterInPipeline = function(filter) {
        const filterName = (filter && typeof filter === "object") ? Object.keys(filter)[0] : filter;
        if (!filterName) return false;
        return (this.config?.pipeline || []).some(step =>
            step?.type === "Filter" && Array.isArray(step.names) && step.names.includes(filterName)
        );
    };

    p.addFilterToAllChannels = function(filterJSON) {
        Object.assign(this.config.filters, filterJSON);
        const filterName = Object.keys(filterJSON || {})[0];
        if (!filterName) return false;

        // Add to every active E-Stack output. Shared Filter steps naturally get
        // the name only once.
        const visited = new Set();
        for (const channel of this.getActiveOutputChannels()) {
            const steps = this.getFilterStepsForChannel(channel);
            if (steps.length === 0) {
                this.addFilterToChannelPipeline(filterJSON, channel);
                continue;
            }
            const step = steps[steps.length - 1];
            if (visited.has(step)) continue;
            visited.add(step);
            insertBeforeLimiter(this.config, step, filterName);
        }
        return true;
    };

    p.clearFilters = function() {
        // CamillaNode's old implementation could remove crossover and protection
        // filters. In E-Stack mode, Clear only removes user-generated filters.
        const removable = Object.keys(this.config?.filters || {}).filter(name =>
            name.startsWith("__") || name.startsWith("USER_") || /^F\d+/.test(name)
        );
        for (const name of removable) {
            for (const channel of this.getActiveOutputChannels()) {
                this.removeFilterFromChannelPipeline(name, channel);
            }
        }
    };

    // The old split/merge functions replace the entire pipeline with a 2-channel
    // default pipeline. They must never run on the 2-in/6-out E-Stack graph.
    p.splitFiltersToChannels = function() {
        console.info("E-Stack: splitFiltersToChannels ignored to preserve the DSP pipeline.");
        return true;
    };

    p.mergeFilters = function() {
        console.info("E-Stack: mergeFilters ignored to preserve the DSP pipeline.");
        return true;
    };

    p.isSingleChannel = function() {
        const channels = this.getActiveOutputChannels();
        if (channels.length <= 1) return true;
        const first = this.getChannelFiltersList(channels[0]);
        return channels.slice(1).every(ch => {
            const current = this.getChannelFiltersList(ch);
            return current.length === first.length && first.every(name => current.includes(name));
        });
    };

    // The stock UI assumes a mixer named `recombine`. E-Stack has a routing
    // mixer instead. Keep these controls inert unless a compatible mixer exists.
    p.setBalance = function(bal) {
        const mixer = this.config?.mixers?.recombine;
        if (!mixer?.mapping?.[0]?.sources?.[0] || !mixer?.mapping?.[1]?.sources?.[0]) return false;
        mixer.mapping[0].sources[0].gain = -bal;
        mixer.mapping[1].sources[0].gain = bal;
        return true;
    };

    p.getBalance = function() {
        return Number(this.config?.mixers?.recombine?.mapping?.[1]?.sources?.[0]?.gain || 0);
    };

    p.setCrossfeed = function(crossfeedVal) {
        const mixer = this.config?.mixers?.recombine;
        if (!mixer?.mapping?.[0]?.sources?.[1] || !mixer?.mapping?.[1]?.sources?.[1]) return false;
        const mute = crossfeedVal <= -15;
        mixer.mapping[0].sources[1].mute = mute;
        mixer.mapping[1].sources[1].mute = mute;
        if (!mute) {
            mixer.mapping[0].sources[1].gain = crossfeedVal;
            mixer.mapping[1].sources[1].gain = crossfeedVal;
        }
        return true;
    };

    p.getCrossfeed = function() {
        const source = this.config?.mixers?.recombine?.mapping?.[0]?.sources?.[1];
        if (!source) return -15;
        return source.mute ? -15 : Number(source.gain || 0);
    };

    // Linearized/visual chain with routing inheritance. Snapshot source paths at
    // each Mixer, then propagate their pre-mixer filters to every destination.
    // This fixes the old visualization where INPUT L/R Global EQ appeared only
    // on SUB/KICK simply because those output numbers are also 0/1.
    p.linearizeConfig = function() {
        const channelCount = this.getChannelCount();
        const channels = Array.from({ length: channelCount }, () => []);
        for (let i = 0; i < channelCount; i++) {
            channels[i].push({ type: "input", device: this.config?.devices?.capture });
        }

        for (const pipe of (this.config?.pipeline || [])) {
            if (pipe.type === "Mixer") {
                const mixer = this.config?.mixers?.[pipe.name];
                const beforeMixer = channels.map(path => [...(path || [])]);

                for (const map of (mixer?.mapping || [])) {
                    const dest = Number(map.dest);
                    if (!Number.isFinite(dest)) continue;

                    const inherited = [];
                    const seen = new Set();
                    for (const source of (map.sources || [])) {
                        const sourcePath = beforeMixer[Number(source?.channel)] || [];
                        for (const item of sourcePath) {
                            if (item?.type === "input" || item?.type === "output") continue;
                            const key = pathItemKey(item);
                            if (seen.has(key)) continue;
                            seen.add(key);
                            inherited.push(item);
                        }
                    }

                    channels[dest] = [
                        { type: "input", device: this.config?.devices?.capture },
                        ...inherited,
                        { type: "mixer", sources: map.sources || [] }
                    ];
                }
            } else if (pipe.type === "Filter") {
                for (const channel of channelsForStep(pipe)) {
                    if (!channels[channel]) channels[channel] = [];
                    for (const filterName of (pipe.names || [])) {
                        channels[channel].push({
                            type: "filter",
                            [filterName]: this.config?.filters?.[filterName]
                        });
                    }
                }
            } else if (pipe.type === "Processor") {
                const processor = this.config?.processors?.[pipe.name];
                let processorChannels = channelsForStep(pipe);
                if (!processorChannels.length && Array.isArray(processor?.parameters?.process_channels)) {
                    processorChannels = processor.parameters.process_channels.map(Number);
                }
                for (const channel of processorChannels) {
                    if (!channels[channel]) channels[channel] = [];
                    channels[channel].push({
                        type: "processor",
                        name: pipe.name,
                        processor
                    });
                }
            }
        }

        for (let i = 0; i < channels.length; i++) {
            channels[i].push({ type: "output", device: this.config?.devices?.playback });
        }
        return channels;
    };

    return camillaDSP;
}
