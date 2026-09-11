// Development-only shell state. Never loaded with transport=camillanode.
(() => {
  if (new URLSearchParams(location.search).get('transport') === 'camillanode') return;
  const frame = document.querySelector('#pageFrame');
  const clone = value => JSON.parse(JSON.stringify(value));
  let prototypeDspState = {
    connected: false,
    transport: 'local-simulation',
    devices: { capture: { type: 'ALSA', device: 'Loopback capture', channels: 2 }, playback: { type: 'ALSA', device: 'E-Stack 6-way', channels: 6 } },
    pipeline: [{ type: 'Filter', channels: [0, 1], description: 'E-Stack input stage' }, { type: 'Mixer', description: 'E-Stack routing' }, { type: 'Filter', channels: [0, 1, 2, 3, 4, 5], description: 'E-Stack output processing' }],
    filters: {}, processors: {}, volume: -12, revision: 1
  };
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    const detail = event.data;
    if (detail?.type === 'estack-prototype-dsp-register') {
      frame.contentWindow?.postMessage({ type: 'estack-prototype-dsp-state', state: clone(prototypeDspState), reason: 'initial shell state' }, window.location.origin);
      return;
    }
    if (detail?.type === 'estack-prototype-dsp-apply' && detail.state) {
      prototypeDspState = clone(detail.state);
      prototypeDspState.revision = Number(prototypeDspState.revision || 0) + 1;
      frame.contentWindow?.postMessage({ type: 'estack-prototype-dsp-state', state: clone(prototypeDspState), reason: detail.reason || 'local change' }, window.location.origin);
      return;
    }
  });

})();
