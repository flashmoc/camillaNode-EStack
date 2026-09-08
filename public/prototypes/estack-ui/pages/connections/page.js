(() => {
  'use strict';
  document.documentElement.dataset.prototypePage = 'connections';

  const $ = id => document.getElementById(id);
  const adapter = window.EStackPrototypeDSP;
  const stateOutput = $('connectionState');

  function drawDetails(node, rows) {
    node.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      row.append(term, description);
      return row;
    }));
  }

  function render(config) {
    const active = !!config.connected;
    const transport = active ? 'Mock session active' : 'Local simulation';
    stateOutput.textContent = active ? 'MOCK SESSION' : 'LOCAL ONLY';
    stateOutput.className = `ui-status ${active ? 'is-success' : 'is-pending'}`;
    $('toggleMockSession').textContent = active ? 'END MOCK SESSION' : 'ENABLE MOCK SESSION';
    $('connectionNote').textContent = active
      ? 'A mock session is active; no DSP endpoint is involved.'
      : 'Ready for a future local adapter.';
    $('stateRevision').textContent = `R${config.revision || 1}`;
    drawDetails($('connectionDetails'), [
      ['TRANSPORT', transport],
      ['ENDPOINT', active ? 'local://estack-mock' : 'none'],
      ['CONFIG FLOW', 'shared prototype state'],
      ['REVISION', `R${config.revision || 1}`]
    ]);
    drawDetails($('captureDetails'), [
      ['DRIVER', config.devices.capture.type],
      ['DEVICE', config.devices.capture.device],
      ['CHANNELS', String(config.devices.capture.channels)]
    ]);
    drawDetails($('playbackDetails'), [
      ['DRIVER', config.devices.playback.type],
      ['DEVICE', config.devices.playback.device],
      ['CHANNELS', String(config.devices.playback.channels)]
    ]);
  }

  $('toggleMockSession').addEventListener('click', () => {
    const current = adapter.snapshot();
    adapter.setConnection(!current.connected, 'local-simulation');
  });
  $('resetMockSession').addEventListener('click', () => adapter.setConnection(false, 'local-simulation'));
  adapter.subscribe(render);
})();
