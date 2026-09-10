(() => {
  'use strict';
  const M = window.EStackControlModel;
  function summarize({ config, peaks, load, master }) {
    const valid = value => typeof value === 'number' && Number.isFinite(value);
    const active = config ? { ...config, pipeline: (config.pipeline || []).filter(step => !step.bypassed) } : null;
    const channels = active ? M.activeOutputs(active) : [];
    const limits = channels.map(channel => ({ channel, hard: M.hardLimitForChannel(active, channel), muted: !!M.gainEntryForChannel(active, channel)?.filter?.parameters?.mute }));
    const protectedAll = limits.length > 0 && limits.every(item => item.hard && valid(item.hard.filter.parameters.clip_limit));
    const margins = limits.filter(item => !item.muted && item.hard && valid(peaks?.[item.channel]) && peaks[item.channel] > -90).map(item => item.hard.clip - peaks[item.channel]);
    const margin = margins.length ? Math.min(...margins) : null;
    const limiter = !channels.length ? 'unknown' : !protectedAll ? 'missing' : margin === null ? 'armed' : margin <= .1 ? 'limit' : margin <= 3 ? 'near' : 'armed';
    // Audio amplitude relative to the closest hard ceiling, not CPU utilization.
    const audioLoad = !protectedAll || !Array.isArray(peaks) || !channels.every(channel => valid(peaks[channel])) ? null : margin === null ? 0 : Math.min(100, 100 * 10 ** (-Math.max(0, margin) / 20));
    return { master: valid(master) ? master : null, cpuLoad: valid(load) && load >= 0 ? load : null, load: audioLoad, loadState: audioLoad === null ? 'unknown' : audioLoad >= 90 ? 'critical' : audioLoad >= 70 ? 'warning' : 'ok', margin, limiter };
  }
  window.EStackSystemStatus = Object.freeze({ summarize });
})();
