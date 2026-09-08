(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const listeners = new Set();
  const initialState = () => ({
    connected: false,
    transport: 'local-simulation',
    devices: { capture: { type: 'ALSA', device: 'Loopback capture', channels: 2 }, playback: { type: 'ALSA', device: 'E-Stack 6-way', channels: 6 } },
    pipeline: [{ type: 'Filter', channels: [0, 1], description: 'E-Stack input stage' }, { type: 'Mixer', description: 'E-Stack routing' }, { type: 'Filter', channels: [0, 1, 2, 3, 4, 5], description: 'E-Stack output processing' }],
    filters: {}, processors: {}, volume: -12, revision: 1
  });
  let state = initialState();
  const parentShell = window.parent !== window;
  const notify = reason => listeners.forEach(listener => listener(clone(state), reason));
  const publish = reason => {
    state.revision += 1;
    if (parentShell) window.parent.postMessage({ type: 'estack-prototype-dsp-apply', state: clone(state), reason }, window.location.origin);
    notify(reason);
  };
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    const detail = event.data;
    if (!detail || detail.type !== 'estack-prototype-dsp-state' || !detail.state) return;
    state = clone(detail.state);
    notify(detail.reason || 'synchronised state');
  });
  window.EStackPrototypeDSP = Object.freeze({
    snapshot: () => clone(state),
    subscribe(listener) { listeners.add(listener); listener(clone(state), 'initial'); return () => listeners.delete(listener); },
    apply(mutator, reason = 'local change') { const next = clone(state); mutator(next); state = next; publish(reason); return clone(state); },
    setConnection(connected, transport = 'local-simulation') { state = { ...state, connected: !!connected, transport }; publish(connected ? 'connected' : 'disconnected'); },
    reset() { state = { ...initialState(), revision: state.revision }; publish('reset'); }
  });
  if (parentShell) window.parent.postMessage({ type: 'estack-prototype-dsp-register' }, window.location.origin);
})();
