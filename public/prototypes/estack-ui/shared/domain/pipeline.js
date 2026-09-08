(() => {
  'use strict';

  const numeric = value => Number.isInteger(Number(value)) ? Number(value) : null;

  // CamillaDSP 4.x uses `channels: [0]`; older saved configurations use
  // `channel: 0`. Product domain services always consume this normalized view.
  function channelsForStep(step) {
    if (Array.isArray(step?.channels)) return [...new Set(step.channels.map(numeric).filter(Number.isInteger))];
    const channel = numeric(step?.channel);
    return channel === null ? [] : [channel];
  }
  function stepHasChannel(step, channel) { return step?.type === 'Filter' && channelsForStep(step).includes(Number(channel)); }
  function firstMixerContext(config) {
    const index = (config?.pipeline || []).findIndex(step => step?.type === 'Mixer');
    if (index < 0) return null;
    const step = config.pipeline[index]; const mixer = config?.mixers?.[step?.name];
    return mixer ? { index, step, mixer } : null;
  }
  function activeOutputChannels(config) {
    const context = firstMixerContext(config);
    const destinations = new Set((context?.mixer?.mapping || []).map(item => numeric(item?.dest)).filter(Number.isInteger));
    if (destinations.size) return [...destinations].sort((a, b) => a - b);
    const playback = Number(config?.devices?.playback?.channels || 0);
    return Array.from({ length: Math.max(0, playback) }, (_, channel) => channel);
  }
  function directPostMixerFilterSteps(config, channel) {
    const context = firstMixerContext(config); const pipeline = config?.pipeline || [];
    const start = context ? context.index + 1 : 0;
    return pipeline.slice(start).filter(step => stepHasChannel(step, channel));
  }
  function directPostMixerFilterNames(config, channel) {
    return directPostMixerFilterSteps(config, channel).flatMap(step => Array.isArray(step?.names) ? step.names.map(String) : []);
  }
  window.EStackPipeline = Object.freeze({ channelsForStep, stepHasChannel, firstMixerContext, activeOutputChannels, directPostMixerFilterSteps, directPostMixerFilterNames });
})();
