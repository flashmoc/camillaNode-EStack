'use strict';

const FILTER_NAME = 'ESTACK_LOUDNESS';
const STEP_DESCRIPTION = 'E-Stack loudness input stage';
const FADER_NAME = 'Aux1';
const REFERENCE_LEVEL_DB = -10;

const PRESETS = Object.freeze({
    reference: Object.freeze({ key: 'reference', name: 'REFERENCE', disabled: true, lowBoost: 0, highBoost: 0 }),
    home: Object.freeze({ key: 'home', name: 'HOME', lowBoost: 6, highBoost: 2.5 }),
    punch: Object.freeze({ key: 'punch', name: 'PUNCH', lowBoost: 8, highBoost: 2.5 }),
    night: Object.freeze({ key: 'night', name: 'NIGHT', lowBoost: 4, highBoost: 1.5 }),
    outdoor: Object.freeze({ key: 'outdoor', name: 'OUTDOOR', lowBoost: 3, highBoost: 2.5 }),
    maxspl: Object.freeze({ key: 'maxspl', name: 'MAX SPL', disabled: true, lowBoost: 0, highBoost: 0 })
});

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

function preset(key) {
    return PRESETS[String(key || '').trim().toLowerCase()] || null;
}

function captureChannels(config) {
    const count = Math.max(1, Number(config?.devices?.capture?.channels || 2));
    return Array.from({ length: Math.min(2, count) }, (_, index) => index);
}

function firstMixerIndex(config) {
    return (config?.pipeline || []).findIndex(step => step?.type === 'Mixer');
}

function loudnessStep(config) {
    return (config?.pipeline || []).find(step =>
        step?.type === 'Filter' && (
            step?.description === STEP_DESCRIPTION ||
            (step.names || []).includes(FILTER_NAME)
        )
    ) || null;
}

function removeStage(config) {
    const pipeline = config.pipeline || [];
    for (const step of pipeline) {
        if (step?.type !== 'Filter' || !Array.isArray(step.names)) continue;
        step.names = step.names.filter(name => name !== FILTER_NAME);
    }
    config.pipeline = pipeline.filter(step =>
        !(step?.type === 'Filter' && step?.description === STEP_DESCRIPTION && (step.names || []).length === 0)
    );
    if (config.filters) delete config.filters[FILTER_NAME];
}

function ensureStage(config) {
    const pipeline = config.pipeline || (config.pipeline = []);
    let step = loudnessStep(config);
    let mixerIndex = firstMixerIndex(config);
    if (mixerIndex < 0) throw new Error('No Mixer stage found');

    if (!step) {
        step = {
            type: 'Filter',
            channels: captureChannels(config),
            names: [FILTER_NAME],
            description: STEP_DESCRIPTION,
            bypassed: false
        };
        pipeline.splice(mixerIndex, 0, step);
        return step;
    }

    const currentIndex = pipeline.indexOf(step);
    if (currentIndex >= mixerIndex) {
        pipeline.splice(currentIndex, 1);
        mixerIndex = firstMixerIndex(config);
        pipeline.splice(mixerIndex, 0, step);
    }

    step.channels = captureChannels(config);
    delete step.channel;
    step.names = [FILTER_NAME];
    step.description = STEP_DESCRIPTION;
    step.bypassed = false;
    return step;
}

function applyPreset(config, key) {
    const selected = preset(key);
    if (!selected) throw new Error(`Unknown loudness preset '${key}'`);

    const next = clone(config || {});
    if (!next.filters) next.filters = {};

    if (selected.disabled) {
        removeStage(next);
    } else {
        next.filters[FILTER_NAME] = {
            type: 'Loudness',
            description: `E-Stack loudness · ${selected.name}`,
            parameters: {
                fader: FADER_NAME,
                reference_level: REFERENCE_LEVEL_DB,
                high_boost: selected.highBoost,
                low_boost: selected.lowBoost,
                attenuate_mid: false
            }
        };
        ensureStage(next);
    }

    return next;
}

function isEnabled(config) {
    const filter = config?.filters?.[FILTER_NAME];
    return filter?.type === 'Loudness' && !!loudnessStep(config);
}

function detectPreset(config, disabledHint = 'reference') {
    const filter = config?.filters?.[FILTER_NAME];
    if (!filter || filter.type !== 'Loudness' || !loudnessStep(config)) {
        return disabledHint === 'maxspl' ? 'maxspl' : 'reference';
    }

    const parameters = filter.parameters || {};
    for (const item of Object.values(PRESETS)) {
        if (item.disabled) continue;
        if (
            Math.abs(Number(parameters.low_boost) - item.lowBoost) < 0.05 &&
            Math.abs(Number(parameters.high_boost) - item.highBoost) < 0.05 &&
            parameters.fader === FADER_NAME
        ) return item.key;
    }

    return 'custom';
}

function stripLoudness(config) {
    const stripped = clone(config || {});
    removeStage(stripped);
    return stripped;
}

function assertOnlyLoudnessChanged(before, after) {
    const left = JSON.stringify(stable(stripLoudness(before)));
    const right = JSON.stringify(stable(stripLoudness(after)));
    if (left !== right) throw new Error('Loudness guard rejected a non-loudness DSP change');
}

function validateApplied(config, key) {
    const selected = preset(key);
    if (!selected) throw new Error(`Unknown loudness preset '${key}'`);

    if (selected.disabled) {
        if (config?.filters?.[FILTER_NAME] || loudnessStep(config)) {
            throw new Error('Loudness disable validation failed');
        }
        return;
    }

    const step = loudnessStep(config);
    const mixerIndex = firstMixerIndex(config);
    const filter = config?.filters?.[FILTER_NAME];
    if (!step || mixerIndex < 0 || config.pipeline.indexOf(step) >= mixerIndex) {
        throw new Error('Loudness stage is not before routing');
    }
    if (
        filter?.type !== 'Loudness' ||
        filter?.parameters?.fader !== FADER_NAME ||
        filter?.parameters?.attenuate_mid !== false ||
        Math.abs(Number(filter?.parameters?.low_boost) - selected.lowBoost) >= 0.05 ||
        Math.abs(Number(filter?.parameters?.high_boost) - selected.highBoost) >= 0.05
    ) {
        throw new Error('Loudness preset validation failed');
    }
}

module.exports = {
    FILTER_NAME,
    STEP_DESCRIPTION,
    FADER_NAME,
    REFERENCE_LEVEL_DB,
    PRESETS,
    preset,
    applyPreset,
    detectPreset,
    isEnabled,
    assertOnlyLoudnessChanged,
    validateApplied
};
