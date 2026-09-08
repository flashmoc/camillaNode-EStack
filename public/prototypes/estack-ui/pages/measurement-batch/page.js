(() => {
  'use strict';
  document.documentElement.dataset.prototypePage = 'measurement-batch';

  const $ = id => document.getElementById(id);
  const adapter = window.EStackPrototypeDSP;
  const fields = ['measurementInput', 'measurementWay', 'sweepStart', 'sweepEnd', 'sweepDuration', 'sweepAverages'];
  let running = false;
  let hydrated = false;

  function recipe() {
    return { input: $('measurementInput').value, way: $('measurementWay').value, start: Number($('sweepStart').value), end: Number($('sweepEnd').value), duration: Number($('sweepDuration').value), averages: Number($('sweepAverages').value) };
  }

  function applyRecipe(next = {}) {
    const value = { input: 'IN L', way: 'SUB', start: 20, end: 20000, duration: 8, averages: 4, ...next };
    $('measurementInput').value = value.input;
    $('measurementWay').value = value.way;
    $('sweepStart').value = value.start;
    $('sweepEnd').value = value.end;
    $('sweepDuration').value = value.duration;
    $('sweepAverages').value = value.averages;
  }

  function renderResult(result) {
    const hasResult = !!result;
    $('resultBadge').textContent = hasResult ? 'LOCAL RESULT' : 'NO CAPTURE';
    $('resultBadge').className = `ui-badge ${hasResult ? 'is-success' : 'is-muted'}`;
    $('resultLatency').textContent = hasResult ? `${result.latency.toFixed(2)} ms` : '—';
    $('resultPeak').textContent = hasResult ? `${result.peak.toFixed(1)} dBFS` : '—';
    $('resultPoints').textContent = hasResult ? String(result.points) : '—';
    $('resultSummary').textContent = hasResult ? `${result.input} → ${result.way} · ${result.start} Hz to ${result.end} Hz · ${result.averages} averages.` : 'Run the local mock to preview a measurement record.';
  }

  function renderRunState() {
    $('measurementState').textContent = running ? 'SIMULATING' : 'READY';
    $('measurementState').className = `ui-status ${running ? 'is-warning' : 'is-pending'}`;
    $('runMeasurement').disabled = running;
    $('measurementNote').textContent = running ? 'Building a local measurement record…' : 'No signal is sent to hardware.';
  }

  function persist() {
    const next = recipe();
    adapter.apply(config => { config.measurement = { ...(config.measurement || {}), recipe: next }; }, 'measurement recipe updated');
  }

  fields.forEach(id => $(id).addEventListener('change', persist));
  $('runMeasurement').addEventListener('click', () => {
    if (running) return;
    const next = recipe();
    if (!(next.start < next.end)) { $('measurementNote').textContent = 'Sweep end must be higher than sweep start.'; return; }
    running = true;
    renderRunState();
    window.setTimeout(() => {
      const result = { ...next, latency: 2.15 + next.averages * .08, peak: -18.4 + next.duration * .11, points: 256 * next.averages };
      adapter.apply(config => { config.measurement = { recipe: next, result }; }, 'mock measurement completed');
      running = false;
      renderRunState();
      renderResult(result);
    }, 650);
  });
  $('clearMeasurement').addEventListener('click', () => {
    adapter.apply(config => { config.measurement = { recipe: recipe(), result: null }; }, 'measurement result cleared');
    renderResult(null);
  });
  adapter.subscribe(config => {
    const measurement = config.measurement || {};
    if (!hydrated || measurement.recipe) applyRecipe(measurement.recipe);
    if (!running) renderResult(measurement.result || null);
    hydrated = true;
  });
  renderRunState();
})();
