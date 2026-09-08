(() => {
  'use strict';
  document.documentElement.dataset.prototypePage = 'connections';

  const $ = id => document.getElementById(id);
  const bridge = window.EStackDSPBridge;
  const adapter = window.EStackPrototypeDSP;
  let runtime = null;
  let config = null;
  let busy = false;

  function details(node, rows) {
    node.replaceChildren(...rows.map(([termText, valueText]) => {
      const row = document.createElement('div'); const term = document.createElement('dt'); const value = document.createElement('dd');
      term.textContent = termText; value.textContent = valueText; row.append(term, value); return row;
    }));
  }

  function configDetails() {
    const capture = config?.devices?.capture || config?.capture || null;
    const playback = config?.devices?.playback || config?.playback || null;
    details($('captureDetails'), capture ? [['TYPE', capture.type || 'ALSA'], ['DEVICE', capture.device || 'Configured device'], ['CHANNELS', String(capture.channels || '—')]] : [['TYPE', '—'], ['DEVICE', 'Connect to inspect'], ['CHANNELS', '—']]);
    details($('playbackDetails'), playback ? [['TYPE', playback.type || 'ALSA'], ['DEVICE', playback.device || 'Configured device'], ['CHANNELS', String(playback.channels || '—')]] : [['TYPE', '—'], ['DEVICE', 'Connect to inspect'], ['CHANNELS', '—']]);
  }

  function render(snapshot = {}) {
    const real = bridge.mode === 'camillanode';
    const connected = !!bridge.connected;
    $('connectionState').textContent = !real ? 'LOCAL MODEL' : connected ? 'DSP CONNECTED' : snapshot.phase === 'connecting' ? 'CONNECTING' : 'API READY';
    $('connectionState').className = `ui-status ${connected ? 'is-success' : real ? 'is-warning' : 'is-pending'}`;
    $('proxyState').textContent = connected ? 'ONLINE' : real ? 'READY' : 'STANDBY';
    $('runtimeState').textContent = runtime?.mode ? String(runtime.mode).toUpperCase() : real ? 'API' : 'LOCAL';
    $('connectDsp').disabled = busy || !real || connected;
    $('disconnectDsp').disabled = busy || !connected;
    $('refreshRuntime').disabled = busy || !connected;
    $('connectionNote').textContent = !real ? 'Add ?transport=camillanode on the E-Stack DSP URL to enable the existing CamillaNode proxy.' : connected ? 'Read-only runtime inspection is active. Processing changes remain owned by their workspace.' : 'Ready to open the same /ws/dsp proxy used by CamillaNode E-Stack.';
    details($('connectionDetails'), [
      ['MODE', real ? 'CamillaNode product mode' : 'Local product preview'],
      ['BROWSER ENDPOINT', real ? bridge.endpoint : 'none'],
      ['CAMILLANODE PROXY', real ? '/ws/dsp' : 'disabled'],
      ['CAMILLADSP TARGET', real ? '127.0.0.1:1234 (server-side)' : 'none'],
      ['RUNTIME API', real ? '/api/runtime' : 'disabled']
    ]);
    configDetails();
  }

  async function inspect() {
    runtime = await bridge.api('/api/runtime');
    config = await bridge.command('GetConfigJson');
  }

  async function connect() {
    if (busy) return; busy = true; render();
    try { await bridge.connect(); await inspect(); }
    catch (error) { $('connectionNote').textContent = error.message; }
    finally { busy = false; render(); }
  }

  $('connectDsp').addEventListener('click', connect);
  $('disconnectDsp').addEventListener('click', () => { bridge.disconnect(); runtime = null; config = null; render(); });
  $('refreshRuntime').addEventListener('click', async () => { if (busy) return; busy = true; render(); try { await inspect(); } catch (error) { $('connectionNote').textContent = error.message; } finally { busy = false; render(); } });
  bridge.subscribe(render);
  adapter.subscribe(() => render());
  render();
})();
