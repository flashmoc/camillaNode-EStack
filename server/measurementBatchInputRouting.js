'use strict';

/*
 * Optional Measurement Batch capture-input routing.
 *
 * Batch files use one-based physical numbering (IN1..IN8). CamillaDSP mixer
 * source channels are zero-based, so measurementInput: 4 routes channel 3.
 * The batch session already captures the complete live config. This module
 * extends the batch-owned temporary state to include mixer routing while still
 * leaving hardware devices under the live CamillaDSP configuration.
 */

module.exports = function installMeasurementBatchInputRouting(model) {
    if (!model || typeof model !== 'object') throw new Error('Measurement Batch model is required');
    if (model.__measurementInputRoutingInstalled) return model;

    const original = {
        normalizeBatch: model.normalizeBatch,
        applyStep: model.applyStep,
        processingOf: model.processingOf,
        mergeProcessingIntoLive: model.mergeProcessingIntoLive,
        sameProcessing: model.sameProcessing
    };
    const clone = model.clone || (value => value == null ? value : JSON.parse(JSON.stringify(value)));

    function stable(value) {
        if (Array.isArray(value)) return value.map(stable);
        if (value && typeof value === 'object') {
            const result = {};
            for (const key of Object.keys(value).sort()) result[key] = stable(value[key]);
            return result;
        }
        return value;
    }

    function normalizeMeasurementInput(value) {
        if (value == null || value === '') return null;
        const input = Number(value);
        if (!Number.isInteger(input) || input < 1 || input > 8) {
            throw new Error('defaults.measurementInput must be an integer from 1 to 8 (physical IN1..IN8)');
        }
        return input;
    }

    function firstMixer(config) {
        const step = (config?.pipeline || []).find(item => item?.type === 'Mixer');
        if (!step?.name) throw new Error('Measurement input routing requires a named Mixer stage');
        const mixer = config?.mixers?.[step.name];
        if (!mixer || !Array.isArray(mixer.mapping)) {
            throw new Error(`Measurement input routing cannot edit mixer '${step.name}'`);
        }
        return [step.name, mixer];
    }

    function inputChannelCount(config, mixer) {
        const mixerInputs = Number(mixer?.channels?.in);
        if (Number.isInteger(mixerInputs) && mixerInputs > 0) return mixerInputs;
        const captureInputs = Number(config?.devices?.capture?.channels);
        if (Number.isInteger(captureInputs) && captureInputs > 0) return captureInputs;
        throw new Error('Cannot determine the number of CamillaDSP capture inputs');
    }

    function routeMeasurementInput(config, measurementInput) {
        const physicalInput = normalizeMeasurementInput(measurementInput);
        if (physicalInput == null) return config;

        const [, mixer] = firstMixer(config);
        const inputCount = inputChannelCount(config, mixer);
        if (physicalInput > inputCount) {
            throw new Error(`IN${physicalInput} is unavailable: the active mixer/capture exposes ${inputCount} inputs`);
        }

        const sourceChannel = physicalInput - 1;
        const routedDestinations = new Set();
        for (const mapping of mixer.mapping) {
            const dest = Number(mapping?.dest);
            if (!Number.isInteger(dest) || dest < 0 || dest > 5) continue;

            mapping.sources = [{
                channel: sourceChannel,
                gain: 0,
                scale: 'dB',
                inverted: false
            }];
            routedDestinations.add(dest);
        }

        const missing = [0, 1, 2, 3, 4, 5].filter(dest => !routedDestinations.has(dest));
        if (missing.length) {
            throw new Error(`Measurement input routing is missing E-Stack mixer destinations ${missing.map(dest => `OUT${dest + 1}`).join(', ')}`);
        }
        return config;
    }

    function canonicalMixerRouting(mixers) {
        const result = {};
        for (const [name, mixer] of Object.entries(mixers || {})) {
            result[name] = {
                channels: {
                    in: Number(mixer?.channels?.in || 0),
                    out: Number(mixer?.channels?.out || 0)
                },
                mapping: (mixer?.mapping || []).map(mapping => ({
                    dest: Number(mapping?.dest),
                    sources: (mapping?.sources || []).map(source => ({
                        channel: Number(source?.channel),
                        gain: Number(source?.gain ?? 0),
                        scale: source?.scale || 'dB',
                        inverted: !!source?.inverted
                    }))
                }))
            };
        }
        return stable(result);
    }

    model.normalizeBatch = function normalizeBatchWithMeasurementInput(input) {
        const normalized = original.normalizeBatch(input);
        const raw = input?.defaults?.measurementInput;
        if (raw != null && raw !== '') {
            normalized.defaults.measurementInput = normalizeMeasurementInput(raw);
        }
        return normalized;
    };

    model.applyStep = function applyStepWithMeasurementInput(baselineConfig, batchInput, stepOrIndex) {
        const batch = model.normalizeBatch(batchInput);
        const next = original.applyStep(baselineConfig, batch, stepOrIndex);
        if (batch.defaults.measurementInput != null) {
            routeMeasurementInput(next, batch.defaults.measurementInput);
        }
        return next;
    };

    model.processingOf = function processingWithMixer(config) {
        return {
            filters: clone(config?.filters || {}),
            pipeline: clone(config?.pipeline || []),
            processors: clone(config?.processors || {}),
            mixers: clone(config?.mixers || {})
        };
    };

    model.mergeProcessingIntoLive = function mergeProcessingWithMixer(liveConfig, targetConfig) {
        const next = clone(liveConfig || {});
        const processing = model.processingOf(targetConfig);
        next.filters = processing.filters;
        next.pipeline = processing.pipeline;
        next.processors = processing.processors;
        next.mixers = processing.mixers;
        return next;
    };

    model.sameProcessing = function sameProcessingWithMixer(a, b) {
        const pa = model.processingOf(a);
        const pb = model.processingOf(b);
        const coreA = stable({ filters: pa.filters, pipeline: pa.pipeline, processors: pa.processors });
        const coreB = stable({ filters: pb.filters, pipeline: pb.pipeline, processors: pb.processors });
        if (JSON.stringify(coreA) !== JSON.stringify(coreB)) return false;
        return JSON.stringify(canonicalMixerRouting(pa.mixers)) === JSON.stringify(canonicalMixerRouting(pb.mixers));
    };

    model.routeMeasurementInput = routeMeasurementInput;
    model.canonicalMixerRouting = canonicalMixerRouting;
    Object.defineProperty(model, '__measurementInputRoutingInstalled', { value: true });
    return model;
};
