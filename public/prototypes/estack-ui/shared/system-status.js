(() => {
  'use strict';
  const B = window.EStackDSPBridge;
  const $ = selector => document.querySelector(selector);
  const status = $('.shell-context .ui-status');
  const load = $('[data-shell-load]');
  const limiter = $('[data-shell-limiters]');
  const labels = { unknown: 'UNKNOWN', missing: 'MISSING', armed: 'ARMED', near: 'NEAR LIMIT', limit: 'AT LIMIT' };
  let timer, stopped = false;
  function render(snapshot, connected) {
    status.textContent = connected ? 'DSP ONLINE' : B.mode === 'local' ? 'LOCAL PREVIEW' : 'DSP OFFLINE';
    status.className = `ui-status ${connected ? 'is-success' : 'is-muted'}`;
    load.textContent = snapshot.load === null ? '— %' : `${snapshot.load.toFixed(1)} %`;
    load.parentElement.dataset.state = snapshot.loadState;
    limiter.textContent = labels[snapshot.limiter];
    limiter.parentElement.dataset.state = ['limit', 'missing'].includes(snapshot.limiter) ? 'critical' : snapshot.limiter === 'near' ? 'warning' : snapshot.limiter === 'armed' ? 'ok' : 'unknown';
    $('[data-shell-master]').textContent = snapshot.master === null ? '— dB' : `${snapshot.master.toFixed(1)} dB`;
    $('[data-shell-headroom]').textContent = snapshot.margin === null ? '— dB' : `${Math.max(0, snapshot.margin).toFixed(1)} dB`;
  }
  const empty = () => window.EStackSystemStatus.summarize({});
  async function poll() {
    if (stopped) return;
    const stale = setTimeout(() => render(empty(), false), 3500);
    try {
      const results = await Promise.allSettled(['GetConfigJson', 'GetPlaybackSignalPeak', 'GetProcessingLoad', 'GetVolume'].map(command => B.command(command, 1200)));
      const [config, peaks, load, master] = results.map(result => result.status === 'fulfilled' ? result.value : null);
      if (!config || !Array.isArray(peaks) || typeof master !== 'number') throw new Error('Telemetry unavailable');
      render(window.EStackSystemStatus.summarize({ config, peaks, load, master }), true);
    } catch (_) { render(empty(), false); }
    clearTimeout(stale);
    if (!stopped) timer = setTimeout(poll, 1000);
  }
  render(empty(), false);
  if (B.mode === 'camillanode') poll();
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); B.disconnect(); });
  window.addEventListener('pageshow', event => { if (event.persisted && B.mode === 'camillanode') { stopped = false; poll(); } });
})();
