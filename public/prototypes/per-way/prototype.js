(() => {
  'use strict';
  const fixture = window.EStackPrototypeFixtures;
  const clone = value => JSON.parse(JSON.stringify(value));
  const state = { system: clone(fixture.system), ways: clone(fixture.ways), selected: 1, compare: '0', graphMode: 'magnitude', analyzer: true, transaction: 'applied', scenario: 'normal', snapshot: null };
  state.snapshot = clone(state.ways);
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const selectedWay = () => state.ways.find(item => item.id === state.selected);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
  const round = (value, decimals = 1) => { const factor = 10 ** decimals; return Math.round(Number(value) * factor) / factor; };
  const formatDb = value => `${Number(value).toFixed(1)} dB`;
  const formatFreq = value => Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(Number(value) >= 10000 ? 0 : 2).replace(/\.00$/, '')} kHz` : `${Math.round(Number(value))} Hz`;

  function markModified() { if (state.scenario === 'disconnected') return; state.transaction = 'modified'; renderTransaction(); }

  function renderSystem() {
    const context = $('#systemContext');
    const dsp = context.querySelector('[data-role="dsp-state"]');
    const preset = context.querySelector('[data-role="preset-state"]');
    const clip = context.querySelector('[data-role="clip-state"]');
    const limit = context.querySelector('[data-role="limit-state"]');
    const disconnected = state.scenario === 'disconnected';
    const critical = state.scenario === 'critical';
    const warning = state.scenario === 'warning';
    dsp.className = `status-chip ${disconnected ? 'critical' : 'ok'}`;
    dsp.innerHTML = `<i></i> ${disconnected ? 'DSP MOCK DISCONNECTED' : 'DSP MOCK ONLINE'}`;
    preset.className = `status-chip ${state.transaction === 'modified' || state.scenario === 'dirty' ? 'warning' : ''}`;
    preset.textContent = `${state.system.preset} · ${state.transaction === 'modified' || state.scenario === 'dirty' ? 'DIRTY' : 'SAVED'}`;
    clip.className = `status-chip ${critical ? 'critical' : ''}`;
    clip.textContent = critical ? 'CLIPPING' : 'NO CLIP';
    limit.className = `status-chip ${warning || critical ? 'warning' : ''}`;
    limit.textContent = critical ? 'LIMITING HARD' : warning ? 'LIMITER ACTIVE' : 'LIMITERS ARMED';
    document.body.dataset.scenario = state.scenario;
    $$('main button, main input, main select').forEach(control => { control.disabled = state.scenario === 'disabled' || state.scenario === 'disconnected'; });
  }

  function renderWays() {
    const root = $('#waySelector'); root.replaceChildren();
    state.ways.forEach(way => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `way-tile ${way.id === state.selected ? 'active' : ''} ${way.mute ? 'muted' : ''}`;
      button.style.setProperty('--way-color', way.color);
      button.setAttribute('aria-pressed', String(way.id === state.selected));
      button.innerHTML = `<div class="way-title"><i></i><strong>${way.name}</strong><span>${way.mute ? 'MUTED' : way.limiter === 'active' ? 'LIMIT' : 'ON'}</span></div><div class="way-values"><span>${way.gain.toFixed(1)} dB</span><span>${way.headroom.toFixed(1)} HR</span></div><div class="way-meter" aria-label="${way.name} simulated level ${way.level.toFixed(1)} dBFS"><span style="--meter:${Math.max(3, Math.min(100, 100 + way.level * 2.2))}%"></span></div>`;
      button.addEventListener('click', () => { state.selected = way.id; state.transaction = 'applied'; renderAll(); });
      root.appendChild(button);
    });
  }

  function renderActiveSummary() {
    const way = selectedWay(); const summary = $('#activeWaySummary'); summary.style.setProperty('--way-color', way.color);
    summary.innerHTML = `<div><i></i><strong>${way.name}</strong></div><span>${formatDb(way.gain)}</span><span>${way.delay.toFixed(2)} ms</span><span>${way.polarity.toUpperCase()}</span><span>${way.headroom.toFixed(1)} dB HR</span><b>${way.mute ? 'MUTED' : 'ACTIVE'}</b>`;
  }

  function renderCompare() {
    const select = $('#compareWay'); const current = state.compare; select.replaceChildren();
    const none = document.createElement('option'); none.value = 'none'; none.textContent = 'None'; select.appendChild(none);
    state.ways.filter(item => item.id !== state.selected).forEach(way => { const option = document.createElement('option'); option.value = String(way.id); option.textContent = way.name; select.appendChild(option); });
    select.value = current === String(state.selected) ? 'none' : current; state.compare = select.value;
  }

  function renderOutput() {
    const way = selectedWay(); $('#outputMeta').textContent = `${way.name} · mock values`;
    $('#gainInput').value = way.gain; $('#gainRange').value = way.gain; $('#delayInput').value = way.delay.toFixed(2);
    const samples = way.delay * fixture.sampleRate / 1000; const distance = way.delay * fixture.speedOfSound / 1000;
    $('#delaySecondary').textContent = `${samples.toFixed(1)} samples · ${distance.toFixed(3)} m`;
    $('#phaseInput').value = way.phase.toFixed(1); $('#phaseRange').value = way.phase;
    const phaseRef = way.lpf.enabled ? way.lpf.freq : way.hpf.freq; $('#phaseReference').textContent = `Reference ${formatFreq(phaseRef)}`;
    $$('#polarityControl button').forEach(button => { const active = button.dataset.value === way.polarity; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('#muteButton').classList.toggle('active-danger', way.mute); $('#muteButton').textContent = way.mute ? 'Unmute' : 'Mute';
    $('#bypassButton').classList.toggle('active-warning', way.bypass); $('#bypassButton').textContent = way.bypass ? 'Bypassed' : 'Bypass';
    $('#limiterEnabled').checked = way.limiter !== 'off'; $('#limiterThreshold').value = way.threshold.toFixed(1);
    const prot = $('#protectionState'); const detail = $('#protectionDetail');
    if (state.scenario === 'critical') { prot.textContent = 'CRITICAL'; prot.className = 'critical-text'; detail.textContent = '0.3 dB headroom · clipping simulated'; }
    else if (state.scenario === 'warning') { prot.textContent = 'LIMITING'; prot.className = 'warning-text'; detail.textContent = '1.2 dB headroom · limiter active'; }
    else { prot.textContent = 'NORMAL'; prot.className = 'ok-text'; detail.textContent = `${way.headroom.toFixed(1)} dB headroom`; }
  }

  function renderTransaction() {
    const chip = $('#transactionState'); const value = state.scenario === 'pending' ? 'pending' : state.scenario === 'dirty' ? 'modified' : state.transaction;
    chip.className = `transaction ${value}`; chip.textContent = value.toUpperCase();
  }

  function renderPeq() {
    const way = selectedWay(); $('#peqMeta').textContent = `${way.name} · ${way.peq.length} mock bands`; const editor = $('#peqEditor'); editor.replaceChildren();
    way.peq.forEach((band, index) => {
      const row = document.createElement('div'); row.className = `peq-row ${band.enabled ? '' : 'bypassed'}`; row.dataset.bandId = band.id;
      row.innerHTML = `<strong class="band-number">${band.id}</strong><button type="button" class="peq-power ${band.enabled ? 'active' : ''}" aria-pressed="${band.enabled}" aria-label="${band.enabled ? 'Bypass' : 'Enable'} PEQ band ${band.id}">${band.enabled ? 'ON' : 'OFF'}</button><label><span>TYPE</span><select class="peq-type"><option>Peaking</option><option>Lowshelf</option><option>Highshelf</option></select></label><label><span>FREQUENCY</span><div class="value-unit"><input class="peq-freq" type="number" min="20" max="20000" step="1" value="${band.freq}"><span>Hz</span></div></label><label><span>GAIN</span><div class="value-unit"><input class="peq-gain" type="number" min="-15" max="15" step="0.1" value="${band.gain}"><span>dB</span></div></label><label><span>Q</span><input class="peq-q" type="number" min="0.1" max="20" step="0.01" value="${band.q}"></label><button type="button" class="remove-band quiet" aria-label="Remove PEQ band ${band.id}">×</button>`;
      row.querySelector('.peq-type').value = band.type;
      row.querySelector('.peq-power').addEventListener('click', () => { band.enabled = !band.enabled; markModified(); renderPeq(); drawGraph(); });
      row.querySelector('.peq-type').addEventListener('change', event => { band.type = event.target.value; markModified(); drawGraph(); });
      row.querySelector('.peq-freq').addEventListener('change', event => { band.freq = clamp(event.target.value, 20, 20000); event.target.value = band.freq; markModified(); drawGraph(); });
      row.querySelector('.peq-gain').addEventListener('change', event => { band.gain = round(clamp(event.target.value, -15, 15), 1); event.target.value = band.gain; markModified(); drawGraph(); });
      row.querySelector('.peq-q').addEventListener('change', event => { band.q = round(clamp(event.target.value, 0.1, 20), 2); event.target.value = band.q; markModified(); drawGraph(); });
      row.querySelector('.remove-band').addEventListener('click', () => { if (way.peq.length <= 1) return; way.peq.splice(index, 1); way.peq.forEach((item, i) => { item.id = i + 1; }); markModified(); renderPeq(); drawGraph(); });
      editor.appendChild(row);
    });
  }

  function crossoverBlock(kind, data) {
    const article = document.createElement('article'); article.className = `crossover-block ${data.enabled ? '' : 'bypassed'}`; article.dataset.kind = kind;
    article.innerHTML = `<div class="crossover-title"><strong>${kind === 'hpf' ? 'HIGH PASS' : 'LOW PASS'}</strong><button type="button" class="xo-power ${data.enabled ? 'active' : ''}" aria-pressed="${data.enabled}">${data.enabled ? 'ON' : 'BYPASS'}</button></div><label>TYPE<select class="xo-type"><option>LR</option><option>BW</option></select></label><label>FREQUENCY<div class="precise-control compact"><input class="xo-range" type="range" min="20" max="20000" step="1"><div class="value-unit"><input class="xo-freq" type="number" min="20" max="20000" step="1"><span>Hz</span></div></div></label><label>SLOPE<select class="xo-slope"><option value="12">12 dB/oct</option><option value="18">18 dB/oct</option><option value="24">24 dB/oct</option><option value="36">36 dB/oct</option><option value="48">48 dB/oct</option></select></label>`;
    article.querySelector('.xo-type').value = data.type; article.querySelector('.xo-freq').value = data.freq; article.querySelector('.xo-range').value = data.freq; article.querySelector('.xo-slope').value = String(data.slope);
    article.querySelector('.xo-power').addEventListener('click', () => { data.enabled = !data.enabled; markModified(); renderCrossover(); drawGraph(); });
    article.querySelector('.xo-type').addEventListener('change', event => { data.type = event.target.value; markModified(); });
    const updateFreq = event => { data.freq = clamp(event.target.value, 20, 20000); article.querySelector('.xo-freq').value = data.freq; article.querySelector('.xo-range').value = data.freq; markModified(); drawGraph(); };
    article.querySelector('.xo-freq').addEventListener('change', updateFreq); article.querySelector('.xo-range').addEventListener('input', updateFreq); article.querySelector('.xo-slope').addEventListener('change', event => { data.slope = Number(event.target.value); markModified(); drawGraph(); });
    return article;
  }

  function renderCrossover() { const way = selectedWay(); const root = $('#crossoverEditor'); root.replaceChildren(crossoverBlock('hpf', way.hpf), crossoverBlock('lpf', way.lpf)); }
  function frequencyToX(freq, width, left) { return left + Math.log10(freq / 20) / Math.log10(20000 / 20) * width; }
  function filterShape(freq, edge, highPass, slope) { const octaves = Math.log2(Math.max(1e-6, freq / edge)); const sign = highPass ? octaves : -octaves; return sign >= 0 ? 0 : Math.max(-54, sign * slope); }
  function peqGainAt(freq, band) { if (!band.enabled) return 0; const x = Math.log2(freq / band.freq); if (band.type === 'Lowshelf') return band.gain / (1 + Math.exp(5 * x)); if (band.type === 'Highshelf') return band.gain / (1 + Math.exp(-5 * x)); const width = Math.max(0.08, 1 / band.q); return band.gain * Math.exp(-(x * x) / (2 * width * width)); }
  function responseAt(freq, way) { let value = way.gain; if (way.hpf.enabled) value += filterShape(freq, way.hpf.freq, true, way.hpf.slope); if (way.lpf.enabled) value += filterShape(freq, way.lpf.freq, false, way.lpf.slope); way.peq.forEach(band => { value += peqGainAt(freq, band); }); return value; }
  function phaseAt(freq, way) { const centre = way.lpf.enabled ? way.lpf.freq : way.hpf.freq; const x = Math.log2(freq / centre); return Math.max(-180, Math.min(180, -80 * Math.tanh(x * 0.8) + way.phase)); }
  function analyzerAt(freq, way) { return responseAt(freq, way) - 18 + Math.sin(Math.log(freq) * 7.1 + way.id) * 2.4 + Math.sin(Math.log(freq) * 13.7) * 1.2; }

  function drawCurve(ctx, way, plot, mode, alpha = 1, width = 2) {
    ctx.save(); ctx.strokeStyle = way.color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.beginPath();
    for (let i = 0; i <= 360; i++) { const t = i / 360; const freq = 20 * (1000 ** t); const x = plot.left + t * plot.width; const raw = mode === 'phase' ? phaseAt(freq, way) : responseAt(freq, way); const y = mode === 'phase' ? plot.top + (180 - raw) / 360 * plot.height : plot.top + (18 - raw) / 78 * plot.height; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke(); ctx.restore();
  }

  function drawGraph() {
    const canvas = $('#responseGraph'); const rect = canvas.getBoundingClientRect(); const scale = window.devicePixelRatio || 1; const width = Math.max(320, rect.width); const height = Math.max(220, rect.height);
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale); const ctx = canvas.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, width, height);
    const plot = { left: 48, right: 16, top: 18, bottom: 28 }; plot.width = width - plot.left - plot.right; plot.height = height - plot.top - plot.bottom;
    const text = getComputedStyle(document.body).getPropertyValue('--prototype-muted').trim() || 'rgba(235,242,244,.58)'; const way = selectedWay(); ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; ctx.fillStyle = text; ctx.lineWidth = 1;
    [20,30,50,80,100,200,500,1000,2000,5000,10000,20000].forEach(freq => { const x = frequencyToX(freq, plot.width, plot.left); ctx.strokeStyle = [20,100,1000,10000,20000].includes(freq) ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.top + plot.height); ctx.stroke(); ctx.textAlign = freq === 20 ? 'left' : freq === 20000 ? 'right' : 'center'; ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : String(freq), x, height - 8); });
    const phaseMode = state.graphMode === 'phase' || state.graphMode === 'xo'; const yTicks = phaseMode ? [180,90,0,-90,-180] : [12,0,-12,-24,-36,-48,-60];
    yTicks.forEach(value => { const y = phaseMode ? plot.top + (180 - value) / 360 * plot.height : plot.top + (18 - value) / 78 * plot.height; ctx.strokeStyle = value === 0 ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.left + plot.width, y); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(`${value}${phaseMode ? '°' : ''}`, plot.left - 7, y + 4); });
    if (state.graphMode === 'magnitude') {
      drawCurve(ctx, way, plot, 'magnitude', way.mute ? .35 : 1, 2.2);
      if (state.compare !== 'none') { const compare = state.ways.find(item => String(item.id) === state.compare); if (compare) drawCurve(ctx, compare, plot, 'magnitude', .45, 1.6); }
      if (state.analyzer) { ctx.save(); ctx.strokeStyle = 'rgba(245,248,249,.50)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i <= 260; i++) { const t = i / 260; const freq = 20 * (1000 ** t); const x = plot.left + t * plot.width; const y = plot.top + (18 - analyzerAt(freq, way)) / 78 * plot.height; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); ctx.restore(); }
    } else {
      drawCurve(ctx, way, plot, 'phase', 1, 2.2);
      if (state.graphMode === 'xo') { const compare = state.compare !== 'none' ? state.ways.find(item => String(item.id) === state.compare) : state.ways[Math.max(0, way.id - 1)]; if (compare && compare.id !== way.id) drawCurve(ctx, compare, plot, 'phase', .62, 1.8); const edge = way.hpf.enabled ? way.hpf.freq : way.lpf.freq; const x = frequencyToX(edge, plot.width, plot.left); ctx.save(); ctx.setLineDash([5,4]); ctx.strokeStyle = 'rgba(255,255,255,.46)'; ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.top + plot.height); ctx.stroke(); ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(edge)} Hz`, x, plot.top + 12); ctx.restore(); }
    }
    const modeText = state.graphMode === 'magnitude' ? 'Magnitude · mock transfer + analyzer' : state.graphMode === 'phase' ? 'Phase · theoretical mock trace' : 'XO Align · mock electrical phase comparison';
    $('#graphReadout').innerHTML = `<span><i style="background:${way.color}"></i><strong>${way.name}</strong> ${modeText}</span><span>HPF ${way.hpf.enabled ? formatFreq(way.hpf.freq) : 'bypassed'} · LPF ${way.lpf.enabled ? formatFreq(way.lpf.freq) : 'bypassed'}</span>`;
  }

  function renderAll() { renderSystem(); renderWays(); renderActiveSummary(); renderCompare(); renderOutput(); renderPeq(); renderCrossover(); renderTransaction(); drawGraph(); }

  function bindStaticControls() {
    $('#scenarioSelect').addEventListener('change', event => { state.scenario = event.target.value; renderAll(); });
    $('#compareWay').addEventListener('change', event => { state.compare = event.target.value; drawGraph(); });
    $('#analyzerToggle').addEventListener('change', event => { state.analyzer = event.target.checked; drawGraph(); });
    $$('#graphModes button').forEach(button => button.addEventListener('click', () => { state.graphMode = button.dataset.mode; $$('#graphModes button').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); drawGraph(); }));
    const bindNumber = (id, property, min, max, decimals, rangeId) => { const input = $(id); const range = rangeId ? $(rangeId) : null; const update = value => { const way = selectedWay(); way[property] = round(clamp(value, min, max), decimals); input.value = way[property]; if (range) range.value = way[property]; markModified(); renderOutput(); renderWays(); renderActiveSummary(); drawGraph(); }; input.addEventListener('change', () => update(input.value)); range?.addEventListener('input', () => update(range.value)); };
    bindNumber('#gainInput', 'gain', -60, 12, 1, '#gainRange'); bindNumber('#delayInput', 'delay', 0, 100, 2, null); bindNumber('#phaseInput', 'phase', -179, 0, 1, '#phaseRange');
    $$('[data-nudge="delay"]').forEach(button => button.addEventListener('click', () => { const way = selectedWay(); way.delay = round(clamp(way.delay + Number(button.dataset.delta), 0, 100), 2); markModified(); renderOutput(); renderActiveSummary(); }));
    $$('#polarityControl button').forEach(button => button.addEventListener('click', () => { selectedWay().polarity = button.dataset.value; markModified(); renderOutput(); renderActiveSummary(); }));
    $('#muteButton').addEventListener('click', () => { selectedWay().mute = !selectedWay().mute; markModified(); renderAll(); });
    $('#bypassButton').addEventListener('click', () => { selectedWay().bypass = !selectedWay().bypass; markModified(); renderOutput(); });
    $('#limiterEnabled').addEventListener('change', event => { selectedWay().limiter = event.target.checked ? 'normal' : 'off'; markModified(); });
    $('#limiterThreshold').addEventListener('change', event => { selectedWay().threshold = round(clamp(event.target.value, -30, 0), 1); markModified(); });
    ['#attackInput','#releaseInput','#ratioInput'].forEach(id => $(id).addEventListener('change', markModified));
    $('#masterLevel').addEventListener('change', event => { state.system.master = round(clamp(event.target.value, -80, 6), 1); event.target.value = state.system.master.toFixed(1); markModified(); });
    $('#addPeqButton').addEventListener('click', () => { const way = selectedWay(); if (way.peq.length >= 10) return; way.peq.push({ id: way.peq.length + 1, enabled: true, type: 'Peaking', freq: 1000, gain: 0, q: 1.0 }); markModified(); renderPeq(); drawGraph(); });
    $('#applyButton').addEventListener('click', () => { if (state.scenario === 'disconnected') return; state.transaction = 'pending'; renderTransaction(); window.setTimeout(() => { state.snapshot = clone(state.ways); state.transaction = 'applied'; if (state.scenario === 'pending') state.scenario = 'normal'; $('#scenarioSelect').value = state.scenario; renderAll(); }, 450); });
    $('#revertButton').addEventListener('click', () => { state.ways = clone(state.snapshot); state.transaction = 'applied'; renderAll(); });
    let resizeFrame = 0; window.addEventListener('resize', () => { window.cancelAnimationFrame(resizeFrame); resizeFrame = window.requestAnimationFrame(drawGraph); });
  }
  document.addEventListener('DOMContentLoaded', () => { bindStaticControls(); renderAll(); });
})();
