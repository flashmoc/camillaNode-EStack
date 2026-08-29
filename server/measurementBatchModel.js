'use strict';

const WAY_DEFS = Object.freeze({
    SUB: Object.freeze({ key: 'SUB', channel: 0, label: 'SUB', out: 1 }),
    KICK: Object.freeze({ key: 'KICK', channel: 1, label: 'KICK', out: 2 }),
    MID_L: Object.freeze({ key: 'MID_L', channel: 2, label: 'MID L', out: 3 }),
    MID_R: Object.freeze({ key: 'MID_R', channel: 3, label: 'MID R', out: 4 }),
    HIGH_L: Object.freeze({ key: 'HIGH_L', channel: 4, label: 'HIGH L', out: 5 }),
    HIGH_R: Object.freeze({ key: 'HIGH_R', channel: 5, label: 'HIGH R', out: 6 })
});

const WAY_ALIASES = new Map([
    ['SUB', 'SUB'], ['SUBWOOFER', 'SUB'],
    ['KICK', 'KICK'],
    ['MIDL', 'MID_L'], ['MIDLEFT', 'MID_L'], ['MID_L', 'MID_L'],
    ['MIDR', 'MID_R'], ['MIDRIGHT', 'MID_R'], ['MID_R', 'MID_R'],
    ['HIGHL', 'HIGH_L'], ['HIGHLEFT', 'HIGH_L'], ['HIGH_L', 'HIGH_L'],
    ['HIGHR', 'HIGH_R'], ['HIGHRIGHT', 'HIGH_R'], ['HIGH_R', 'HIGH_R']
]);

const CROSSOVER_FAMILIES = new Set(['LinkwitzRiley', 'Butterworth']);
const MAX_STEPS = 500;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        const result = {};
        for (const key of Object.keys(value).sort()) result[key] = stable(value[key]);
        return result;
    }
    return value;
}

function boundedNumber(value, min, max, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new Error(`${label} must be between ${min} and ${max}`);
    }
    return number;
}

function optionalString(value, max, label) {
    if (value == null) return '';
    const text = String(value).trim();
    if (text.length > max) throw new Error(`${label} is too long`);
    return text;
}

function normalizeWayKey(value) {
    const raw = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const compact = raw.replace(/_/g, '');
    const canonical = WAY_ALIASES.get(raw) || WAY_ALIASES.get(compact);
    if (!canonical) throw new Error(`Unknown E-Stack way '${value}'`);
    return canonical;
}

function normalizeWayList(input, label = 'activeWays') {
    if (!Array.isArray(input) || !input.length) throw new Error(`${label} must contain at least one way`);
    return [...new Set(input.map(normalizeWayKey))];
}

function normalizeDisabledFilters(input, label = 'disabledFilters') {
    if (input == null) return [];
    if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
    const result = [];
    for (const item of input) {
        const name = String(item || '').trim();
        if (!name) throw new Error(`${label} contains an empty filter name`);
        if (name.length > 160) throw new Error(`${label} contains an invalid filter name`);
        if (!result.includes(name)) result.push(name);
    }
    return result;
}

function normalizeWayOverride(value, label) {
    if (value == null) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    const result = {};

    if (value.delayMs != null && value.delayOffsetMs != null) {
        throw new Error(`${label} cannot define both delayMs and delayOffsetMs`);
    }
    if (value.delayMs != null) result.delayMs = boundedNumber(value.delayMs, 0, 100, `${label}.delayMs`);
    if (value.delayOffsetMs != null) result.delayOffsetMs = boundedNumber(value.delayOffsetMs, -50, 50, `${label}.delayOffsetMs`);
    if (value.gainOffsetDb != null) result.gainOffsetDb = boundedNumber(value.gainOffsetDb, -60, 0, `${label}.gainOffsetDb`);

    if (value.polarity != null) {
        const polarity = String(value.polarity).trim().toLowerCase();
        if (!['normal', 'inverted'].includes(polarity)) throw new Error(`${label}.polarity must be normal or inverted`);
        result.polarity = polarity;
    }

    return result;
}

function normalizeCrossoverSide(input, side, label) {
    if (input == null) return null;
    const value = typeof input === 'number' ? { freqHz: input } : input;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}.${side} must be a number or object`);

    const result = {};
    const rawFreq = value.freqHz ?? value.freq;
    if (rawFreq != null) result.freqHz = boundedNumber(rawFreq, 10, 24000, `${label}.${side}.freqHz`);

    if (value.family != null) {
        const family = String(value.family).trim();
        if (!CROSSOVER_FAMILIES.has(family)) {
            throw new Error(`${label}.${side}.family must be LinkwitzRiley or Butterworth`);
        }
        result.family = family;
    }

    if (value.order != null) {
        const order = boundedNumber(value.order, 1, 16, `${label}.${side}.order`);
        if (!Number.isInteger(order)) throw new Error(`${label}.${side}.order must be an integer`);
        if (result.family === 'LinkwitzRiley' && order % 2 !== 0) {
            throw new Error(`${label}.${side}.order must be even for LinkwitzRiley`);
        }
        result.order = order;
    }

    if (!Object.keys(result).length) throw new Error(`${label}.${side} has no crossover parameters`);
    return result;
}

function normalizeCrossoverOverride(value, label) {
    if (value == null) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    const result = {};

    const hpf = value.hpf ?? (value.hpfHz != null ? { freqHz: value.hpfHz } : null);
    const lpf = value.lpf ?? (value.lpfHz != null ? { freqHz: value.lpfHz } : null);
    if (hpf != null) result.hpf = normalizeCrossoverSide(hpf, 'hpf', label);
    if (lpf != null) result.lpf = normalizeCrossoverSide(lpf, 'lpf', label);
    if (!Object.keys(result).length) throw new Error(`${label} has no hpf/lpf override`);
    return result;
}

function normalizeRew(value, stepId, stepName) {
    if (value == null) {
        return { measurementName: `${stepId}_${stepName}`.replace(/\s+/g, '_').slice(0, 120) };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('rew must be an object');
    const result = {};
    result.measurementName = optionalString(value.measurementName || `${stepId}_${stepName}`.replace(/\s+/g, '_'), 120, 'rew.measurementName');
    if (!result.measurementName) result.measurementName = stepId;

    const hasStart = value.startHz != null;
    const hasEnd = value.endHz != null;
    if (hasStart !== hasEnd) throw new Error('rew.startHz and rew.endHz must be provided together');
    if (hasStart) {
        result.startHz = boundedNumber(value.startHz, 5, 24000, 'rew.startHz');
        result.endHz = boundedNumber(value.endHz, 5, 24000, 'rew.endHz');
        if (result.endHz <= result.startHz) throw new Error('rew.endHz must be above rew.startHz');
    }
    if (value.levelDbfs != null) result.levelDbfs = boundedNumber(value.levelDbfs, -80, 0, 'rew.levelDbfs');
    if (value.timingReference != null) result.timingReference = !!value.timingReference;
    if (value.notes != null) result.notes = optionalString(value.notes, 800, 'rew.notes');
    return result;
}

function normalizeBatch(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Measurement batch must be a JSON object');
    const version = Number(input.version ?? 1);
    if (version !== 1) throw new Error(`Unsupported measurement batch version '${input.version}'`);

    const name = optionalString(input.name, 120, 'Batch name');
    if (!name) throw new Error('Batch name is required');
    const description = optionalString(input.description, 1200, 'Batch description');
    if (!Array.isArray(input.steps) || !input.steps.length) throw new Error('Batch must contain at least one measurement step');
    if (input.steps.length > MAX_STEPS) throw new Error(`Batch cannot exceed ${MAX_STEPS} steps`);

    const rawDefaults = input.defaults && typeof input.defaults === 'object' && !Array.isArray(input.defaults) ? input.defaults : {};
    const defaults = {
        muteUnlisted: rawDefaults.muteUnlisted !== false,
        settleMs: rawDefaults.settleMs == null ? 500 : Math.round(boundedNumber(rawDefaults.settleMs, 0, 5000, 'defaults.settleMs')),
        disabledFilters: normalizeDisabledFilters(rawDefaults.disabledFilters, 'defaults.disabledFilters')
    };

    const ids = new Set();
    const steps = input.steps.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Step ${index + 1} must be an object`);
        const id = optionalString(raw.id || `M${String(index + 1).padStart(2, '0')}`, 64, `Step ${index + 1} id`);
        if (!id) throw new Error(`Step ${index + 1} id is required`);
        if (ids.has(id)) throw new Error(`Duplicate step id '${id}'`);
        ids.add(id);

        const stepName = optionalString(raw.name || id, 160, `Step ${id} name`);
        const instruction = optionalString(raw.instruction, 1000, `Step ${id} instruction`);
        const position = optionalString(raw.position, 240, `Step ${id} position`);
        const activeWays = normalizeWayList(raw.activeWays, `Step ${id} activeWays`);

        const ways = {};
        if (raw.ways != null) {
            if (!raw.ways || typeof raw.ways !== 'object' || Array.isArray(raw.ways)) throw new Error(`Step ${id} ways must be an object`);
            for (const [rawKey, value] of Object.entries(raw.ways)) {
                const key = normalizeWayKey(rawKey);
                ways[key] = normalizeWayOverride(value, `Step ${id} ways.${key}`);
            }
        }

        const crossovers = {};
        if (raw.crossovers != null) {
            if (!raw.crossovers || typeof raw.crossovers !== 'object' || Array.isArray(raw.crossovers)) throw new Error(`Step ${id} crossovers must be an object`);
            for (const [rawKey, value] of Object.entries(raw.crossovers)) {
                const key = normalizeWayKey(rawKey);
                crossovers[key] = normalizeCrossoverOverride(value, `Step ${id} crossovers.${key}`);
            }
        }

        return {
            id,
            name: stepName,
            instruction,
            position,
            activeWays,
            ways,
            crossovers,
            disabledFilters: normalizeDisabledFilters(raw.disabledFilters, `Step ${id} disabledFilters`),
            rew: normalizeRew(raw.rew, id, stepName)
        };
    });

    return {
        schema: 'estack.measurement-batch',
        version: 1,
        name,
        description,
        defaults,
        steps
    };
}

function firstMixerIndex(config) {
    return (config?.pipeline || []).findIndex(step => step?.type === 'Mixer');
}

function wayFilterNames(config, channel) {
    const pipeline = config?.pipeline || [];
    const mixerIndex = firstMixerIndex(config);
    if (mixerIndex < 0) throw new Error('Measurement Batch requires a Mixer stage in the DSP pipeline');
    const names = [];
    for (let index = mixerIndex + 1; index < pipeline.length; index += 1) {
        const step = pipeline[index];
        if (step?.type !== 'Filter') continue;
        const channels = Array.isArray(step.channels)
            ? step.channels.map(Number)
            : step.channel != null ? [Number(step.channel)] : [];
        if (!channels.includes(channel)) continue;
        for (const name of step.names || []) if (!names.includes(name)) names.push(name);
    }
    return names;
}

function uniqueWayFilter(config, wayKey, predicate, label) {
    const def = WAY_DEFS[wayKey];
    const matches = wayFilterNames(config, def.channel)
        .filter(name => predicate(config?.filters?.[name], name));
    if (matches.length !== 1) {
        throw new Error(`${def.label} requires exactly one ${label} filter after routing; found ${matches.length}`);
    }
    return matches[0];
}

function gainFilterName(config, wayKey) {
    return uniqueWayFilter(config, wayKey, filter => filter?.type === 'Gain', 'Gain');
}

function delayFilterName(config, wayKey) {
    return uniqueWayFilter(config, wayKey, filter => filter?.type === 'Delay', 'Delay');
}

function crossoverFilterName(config, wayKey, side) {
    const suffix = side === 'hpf' ? /Highpass$/ : /Lowpass$/;
    return uniqueWayFilter(
        config,
        wayKey,
        filter => filter?.type === 'BiquadCombo' && suffix.test(String(filter?.parameters?.type || '')),
        side.toUpperCase()
    );
}

function disableFilter(config, filterName) {
    if (!config?.filters?.[filterName]) throw new Error(`Cannot disable missing filter '${filterName}'`);
    const pipeline = config.pipeline || [];
    for (const step of pipeline) {
        if (step?.type !== 'Filter' || !Array.isArray(step.names)) continue;
        step.names = step.names.filter(name => name !== filterName);
    }
    config.pipeline = pipeline.filter(step => !(step?.type === 'Filter' && Array.isArray(step.names) && step.names.length === 0));
}

function applyCrossoverSpec(filter, spec, side) {
    if (!filter || filter.type !== 'BiquadCombo') throw new Error(`Target ${side.toUpperCase()} is not a BiquadCombo`);
    filter.parameters = filter.parameters || {};
    if (spec.freqHz != null) filter.parameters.freq = spec.freqHz;
    if (spec.family) filter.parameters.type = `${spec.family}${side === 'hpf' ? 'Highpass' : 'Lowpass'}`;
    if (spec.order != null) filter.parameters.order = spec.order;

    if (String(filter.parameters.type || '').startsWith('LinkwitzRiley') && Number(filter.parameters.order) % 2 !== 0) {
        throw new Error('Linkwitz-Riley crossover order must be even');
    }
}

function applyStep(baselineConfig, batch, stepOrIndex) {
    const normalized = batch?.schema === 'estack.measurement-batch' ? batch : normalizeBatch(batch);
    const step = typeof stepOrIndex === 'number' ? normalized.steps[stepOrIndex] : stepOrIndex;
    if (!step) throw new Error('Measurement step not found');

    const next = clone(baselineConfig || {});
    if (!next.filters || !Array.isArray(next.pipeline)) throw new Error('Current CamillaDSP processing configuration is incomplete');

    if (normalized.defaults.muteUnlisted) {
        const active = new Set(step.activeWays);
        for (const wayKey of Object.keys(WAY_DEFS)) {
            const name = gainFilterName(next, wayKey);
            const filter = next.filters[name];
            filter.parameters = filter.parameters || {};
            filter.parameters.mute = !active.has(wayKey);
        }
    } else {
        for (const wayKey of step.activeWays) {
            const name = gainFilterName(next, wayKey);
            next.filters[name].parameters = next.filters[name].parameters || {};
            next.filters[name].parameters.mute = false;
        }
    }

    for (const filterName of [...normalized.defaults.disabledFilters, ...step.disabledFilters]) {
        disableFilter(next, filterName);
    }

    for (const [wayKey, override] of Object.entries(step.ways || {})) {
        if (override.delayMs != null || override.delayOffsetMs != null) {
            const name = delayFilterName(next, wayKey);
            const baseline = baselineConfig?.filters?.[name];
            const baseDelay = Number(baseline?.parameters?.delay);
            if (!Number.isFinite(baseDelay)) throw new Error(`${WAY_DEFS[wayKey].label} baseline delay is invalid`);
            const delay = override.delayMs != null ? override.delayMs : baseDelay + override.delayOffsetMs;
            if (delay < 0 || delay > 100) throw new Error(`${WAY_DEFS[wayKey].label} resulting delay ${delay} ms is outside 0..100 ms`);
            next.filters[name].parameters.delay = delay;
            if (!next.filters[name].parameters.unit) next.filters[name].parameters.unit = 'ms';
        }

        if (override.polarity) {
            const name = gainFilterName(next, wayKey);
            next.filters[name].parameters.inverted = override.polarity === 'inverted';
        }

        if (override.gainOffsetDb != null) {
            const name = gainFilterName(next, wayKey);
            const baselineGain = Number(baselineConfig?.filters?.[name]?.parameters?.gain);
            if (!Number.isFinite(baselineGain)) throw new Error(`${WAY_DEFS[wayKey].label} baseline gain is invalid`);
            next.filters[name].parameters.gain = baselineGain + override.gainOffsetDb;
            next.filters[name].parameters.scale = 'dB';
        }
    }

    const requestedCrossovers = new Map();
    for (const [wayKey, crossover] of Object.entries(step.crossovers || {})) {
        for (const side of ['hpf', 'lpf']) {
            const spec = crossover[side];
            if (!spec) continue;
            const name = crossoverFilterName(next, wayKey, side);
            const canonical = JSON.stringify(stable(spec));
            if (requestedCrossovers.has(name) && requestedCrossovers.get(name) !== canonical) {
                throw new Error(`Conflicting crossover overrides target shared filter '${name}'`);
            }
            requestedCrossovers.set(name, canonical);
            applyCrossoverSpec(next.filters[name], spec, side);
        }
    }

    return next;
}

function processingOf(config) {
    return {
        filters: clone(config?.filters || {}),
        pipeline: clone(config?.pipeline || []),
        processors: clone(config?.processors || {})
    };
}

function mergeProcessingIntoLive(liveConfig, targetConfig) {
    const next = clone(liveConfig || {});
    const processing = processingOf(targetConfig);
    next.filters = processing.filters;
    next.pipeline = processing.pipeline;
    next.processors = processing.processors;
    return next;
}

function sameProcessing(a, b) {
    return JSON.stringify(stable(processingOf(a))) === JSON.stringify(stable(processingOf(b)));
}

function describeStep(step, index, total) {
    if (!step) return null;
    const ways = step.activeWays.map(key => WAY_DEFS[key]?.label || key).join(' + ');
    const rew = step.rew || {};
    const sweep = Number.isFinite(Number(rew.startHz)) && Number.isFinite(Number(rew.endHz))
        ? `${Number(rew.startHz)}–${Number(rew.endHz)} Hz`
        : null;
    return {
        index,
        number: index + 1,
        total,
        id: step.id,
        name: step.name,
        instruction: step.instruction,
        position: step.position,
        activeWays: [...step.activeWays],
        activeWayLabels: step.activeWays.map(key => WAY_DEFS[key]?.label || key),
        ways: clone(step.ways || {}),
        crossovers: clone(step.crossovers || {}),
        disabledFilters: [...(step.disabledFilters || [])],
        rew: clone(rew),
        summary: `${step.id} · ${step.name} · ${ways}${sweep ? ` · ${sweep}` : ''}`
    };
}

module.exports = {
    WAY_DEFS,
    normalizeWayKey,
    normalizeBatch,
    applyStep,
    processingOf,
    mergeProcessingIntoLive,
    sameProcessing,
    describeStep,
    clone
};
