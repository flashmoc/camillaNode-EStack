(() => {
  'use strict';
  const service = window.EStackInputProcessingService;
  const model = window.EStackInputProcessingModel;
  const importer = window.EStackInputProcessingImport;
  const savedConfigs = window.EStackSavedConfigClient;
  if (!service || !model || !importer || !savedConfigs || window.EStackDSPBridge?.mode !== 'camillanode') throw new Error('Live Input Processing domain is unavailable.');

  const $ = selector => document.querySelector(selector);
  const spectrumFrequencies = [25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];
  const disabledKey = slot => `estack.globalEq.disabled.${slot}`;
  let latest = null;
  let disabled = new Set();
  let analyzerFast = true;
  let spectrum = spectrumFrequencies.map(() => -100);
  let spectrumTimer = null;
  let busy = false;
  let dragging = null;
  let pendingImport = null;
  let selectedPresetId = null;

  const db = value => `${Number(value).toFixed(1).replace('-', '−')}`;
  const hz = value => Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(Number(value) >= 10000 ? 0 : 1).replace('.0', '')} kHz` : `${Math.round(value)} Hz`;
  const q = value => Number(value).toFixed(2).replace(/0$/, '');
  const disabledSlots = () => [...disabled];
  const clamp = model.clamp;
  const formatValue = (field, value) => field === 'frequency' ? hz(value) : field === 'gain' ? `${db(value)} dB` : q(value);
  const valueLimits = field => field === 'frequency' ? [20, 20000, 1] : field === 'gain' ? [-12, 12, .1] : [.1, 20, .1];

  function loadDisabled() {
    disabled = new Set(model.GLOBAL_EQ_SLOT_NAMES.filter(slot => { try { return window.localStorage.getItem(disabledKey(slot)) === 'true'; } catch (_) { return false; } }));
  }
  function persistDisabled(slot, value) { try { window.localStorage.setItem(disabledKey(slot), String(!!value)); } catch (_) { /* browser preference only */ } }
  function setBusy(value) { busy = value; document.querySelectorAll('#eqBands button,#eqBands input,#eqBands select,#eqReset,#delayRange,#delayNumber,.delay-nudge button,#delayReset,#importDialog button,#presetDialog button,#presetDialog input').forEach(control => { control.disabled = value; }); }
  function setStatus(text, state = '') { const el = $('#inputState'); el.textContent = text; el.className = `ui-status ${state ? `is-${state}` : ''}`; }
  function liveBands() { return latest?.slots || model.GLOBAL_EQ_SLOT_NAMES.map(model.defaultBand); }
  function activeBands() { return liveBands().filter(band => !disabled.has(band.slot) && !model.isNeutral(band)); }
  function serializableBands() { return importer.serializeBands(liveBands().map(band => ({ ...band, enabled: !disabled.has(band.slot) }))); }
  function setDisabledStates(bands) {
    const next = new Set((bands || []).filter(band => band.enabled === false).map(band => model.slotName(band.slot)));
    model.GLOBAL_EQ_SLOT_NAMES.forEach(slot => persistDisabled(slot, next.has(slot))); disabled = next;
  }
  function setPreview(slot, field, value) {
    if (!latest) return; const index = model.slotIndex(slot); const limits = valueLimits(field);
    latest.slots[index] = model.normalizeBand(index, { ...latest.slots[index], [field]: clamp(value, limits[0], limits[1]), present: latest.slots[index].present });
    const button = document.querySelector(`[data-knob="${slot}"][data-field="${field}"]`); const number = document.querySelector(`[data-input-slot="${slot}"][data-field="${field}"]`); const output = document.querySelector(`[data-output-slot="${slot}"][data-field="${field}"]`);
    if (button) applyKnob(button, latest.slots[index][field]); if (number) number.value = latest.slots[index][field]; if (output) output.textContent = formatValue(field, latest.slots[index][field]);
    draw();
  }
  async function commitBand(slot, patch) {
    if (busy) return; setBusy(true); setStatus('APPLYING');
    try { await service.setBand(slot, patch, { disabledSlots: disabledSlots() }); setStatus('DSP API READY', 'success'); }
    catch (error) { setStatus(`ERROR · ${error.message}`, 'danger'); await service.refresh().catch(() => {}); }
    finally { setBusy(false); render(); }
  }
  function knobFraction(field, value) {
    const [min, max] = valueLimits(field); return field === 'frequency' ? (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (value - min) / (max - min);
  }
  function valueForKnob(field, fraction) {
    const [min, max] = valueLimits(field); const f = clamp(fraction, 0, 1);
    const raw = field === 'frequency' ? Math.exp(Math.log(min) + f * (Math.log(max) - Math.log(min))) : min + f * (max - min);
    return field === 'frequency' ? Math.round(raw) : Math.round(raw * 10) / 10;
  }
  function applyKnob(button, value) {
    const fraction = knobFraction(button.dataset.field, Number(value));
    button.style.setProperty('--knob-angle', `${-132 + fraction * 264}deg`);
    button.setAttribute('aria-valuenow', String(value));
    button.querySelector('output').textContent = formatValue(button.dataset.field, value);
  }
  function knob(slot, field, value) {
    const [min, max, step] = valueLimits(field);
    return `<div class="rotary-field"><span>${field === 'frequency' ? 'FREQ' : field.toUpperCase()}</span><button class="rotary-knob" type="button" role="slider" aria-label="${slot} ${field}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" data-knob="${slot}" data-field="${field}"><i></i><output>${formatValue(field, value)}</output></button><input class="ui-number rotary-number" data-input-slot="${slot}" data-field="${field}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${slot} ${field} value"></div>`;
  }
  function renderBands() {
    const bands = liveBands(); const root = $('#eqBands');
    root.innerHTML = bands.map((band, index) => {
      const off = disabled.has(band.slot); const neutral = model.isNeutral(band);
      return `<article class="eq-band ${off ? 'is-bypassed' : ''}" data-band="${band.slot}"><header><strong>${String(index + 1).padStart(2, '0')}</strong><button class="band-toggle" type="button" data-toggle-slot="${band.slot}" aria-pressed="${!off}">${off ? 'OFF' : neutral ? '0 dB' : 'ON'}</button><select class="ui-select band-type" data-type-slot="${band.slot}" aria-label="${band.slot} filter type"><option ${band.type === 'Peaking' ? 'selected' : ''}>Peaking</option><option ${band.type === 'Lowshelf' ? 'selected' : ''}>Lowshelf</option><option ${band.type === 'Highshelf' ? 'selected' : ''}>Highshelf</option></select></header><div class="eq-band__params">${knob(band.slot, 'frequency', band.frequency)}${knob(band.slot, 'gain', band.gain)}${knob(band.slot, 'q', band.q)}</div></article>`;
    }).join('');
    root.querySelectorAll('[data-toggle-slot]').forEach(button => button.addEventListener('click', async () => {
      const slot = button.dataset.toggleSlot; const next = !disabled.has(slot); if (next) disabled.add(slot); else disabled.delete(slot); persistDisabled(slot, next); await commitBand(slot, {});
    }));
    root.querySelectorAll('[data-type-slot]').forEach(select => select.addEventListener('change', () => commitBand(select.dataset.typeSlot, { type: select.value })));
    root.querySelectorAll('[data-input-slot]').forEach(input => input.addEventListener('change', () => {
      const [min, max] = valueLimits(input.dataset.field); const value = clamp(input.value, min, max); input.value = value; commitBand(input.dataset.inputSlot, { [input.dataset.field]: value });
    }));
    root.querySelectorAll('[data-knob]').forEach(bindKnob);
    root.querySelectorAll('[data-knob]').forEach(button => applyKnob(button, liveBands()[model.slotIndex(button.dataset.knob)][button.dataset.field]));
  }
  function bindKnob(button) {
    const slot = button.dataset.knob; const field = button.dataset.field;
    const keyboardDelta = event => event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
    button.addEventListener('pointerdown', event => {
      if (busy) return; event.preventDefault(); const start = liveBands()[model.slotIndex(slot)][field]; dragging = { slot, field, start, y: event.clientY, pointerId: event.pointerId, value: start }; button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      if (!dragging || dragging.pointerId !== event.pointerId) return; const scale = field === 'frequency' ? .007 : .006; const value = valueForKnob(field, knobFraction(field, dragging.start) + (dragging.y - event.clientY) * scale); dragging.value = value; setPreview(slot, field, value);
    });
    const finish = event => {
      if (!dragging || dragging.pointerId !== event.pointerId) return; const change = dragging; dragging = null; try { button.releasePointerCapture(event.pointerId); } catch (_) {} if (change.value !== change.start) commitBand(slot, { [field]: change.value });
    };
    button.addEventListener('pointerup', finish); button.addEventListener('pointercancel', finish);
    button.addEventListener('keydown', event => {
      const direction = keyboardDelta(event); if (!direction) return; event.preventDefault(); const [min, max, step] = valueLimits(field); const jump = event.shiftKey ? step * 10 : step; const current = liveBands()[model.slotIndex(slot)][field]; const next = field === 'frequency' ? Math.round(current * (direction > 0 ? 1.1 : 1 / 1.1)) : clamp(current + direction * jump, min, max); setPreview(slot, field, next); commitBand(slot, { [field]: next });
    });
    button.addEventListener('wheel', event => { event.preventDefault(); const direction = event.deltaY < 0 ? 1 : -1; const [min, max, step] = valueLimits(field); const current = liveBands()[model.slotIndex(slot)][field]; const next = field === 'frequency' ? Math.round(current * (direction > 0 ? 1.1 : 1 / 1.1)) : clamp(current + direction * step, min, max); setPreview(slot, field, next); commitBand(slot, { [field]: next }); }, { passive: false });
  }
  function renderDelay() {
    const value = latest?.delay || 0; $('#delayRange').value = value; $('#delayNumber').value = value; $('#delayReadout').textContent = `${Number(value).toFixed(1)} ms`;
    const active = value > 0; const state = $('#delayState'); state.textContent = active ? 'ACTIVE' : 'BYPASS'; state.className = `ui-badge ${active ? 'is-success' : 'is-bypassed'}`;
  }
  function draw() {
    const canvas = $('#eqCanvas'); const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2); const width = Math.round(rect.width * ratio); const height = Math.round(rect.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d'); const w = width / ratio; const h = height / ratio; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
    const left = 46; const right = 44; const top = 18; const bottom = 27; const plotW = w - left - right; const plotH = h - top - bottom;
    const xFor = frequency => left + (Math.log10(frequency) - Math.log10(20)) / 3 * plotW; const yFor = value => top + (14 - clamp(value, -80, 14)) / 94 * plotH;
    ctx.strokeStyle = 'rgba(223,241,244,.14)'; ctx.lineWidth = 1; ctx.font = '10px ui-monospace,monospace';
    [-60,-48,-36,-24,-12,0,12].forEach(value => { const y = yFor(value); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke(); ctx.fillStyle = 'rgba(223,241,244,.6)'; ctx.fillText(String(value), 8, y + 3); });
    [20,30,50,80,100,200,500,1000,2000,5000,10000,20000].forEach(frequency => { const x = xFor(frequency); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, h - bottom); ctx.stroke(); ctx.fillStyle = 'rgba(223,241,244,.55)'; ctx.fillText(frequency >= 1000 ? `${frequency / 1000}k` : frequency, x - 8, h - 8); });
    if (spectrum.some(value => value > -100)) { ctx.beginPath(); spectrumFrequencies.forEach((frequency, index) => { const x = xFor(frequency); const y = yFor(spectrum[index]); index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = 'rgba(230,240,241,.68)'; ctx.lineWidth = 1.25; ctx.stroke(); }
    const bands = liveBands(); ctx.beginPath(); for (let px = 0; px <= plotW; px += 1) { const frequency = 20 * Math.pow(1000, px / plotW); const y = yFor(model.totalResponse(bands, frequency, latest?.sampleRate || 48000, disabledSlots())); px ? ctx.lineTo(left + px, y) : ctx.moveTo(left + px, y); } ctx.strokeStyle = '#59d5e3'; ctx.lineWidth = 2.4; ctx.stroke();
  }
  function render() {
    if (!latest) return; $('#eqActiveCount').textContent = `${activeBands().length} ACTIVE`; renderBands(); renderDelay(); draw();
  }
  async function setDelay(value) {
    if (busy) return; setBusy(true); setStatus('APPLYING');
    try { await service.setDelay(value); setStatus('DSP API READY', 'success'); } catch (error) { setStatus(`ERROR · ${error.message}`, 'danger'); await service.refresh().catch(() => {}); } finally { setBusy(false); render(); }
  }
  async function applyCompleteBands(bands, label) {
    const complete = importer.completeBands(bands); const nextDisabled = complete.filter(band => band.enabled === false).map(band => band.slot);
    if (busy) return false; setBusy(true); setStatus('APPLYING');
    try { await service.applyBands(complete, { disabledSlots: nextDisabled }); setDisabledStates(complete); setStatus('DSP API READY', 'success'); return true; }
    catch (error) { setStatus(`ERROR · ${error.message}`, 'danger'); await service.refresh().catch(() => {}); throw error; }
    finally { setBusy(false); render(); }
  }
  function importStatus(text, state = '') { const output = $('#importStatus'); output.textContent = text; output.dataset.state = state; }
  function presetStatus(text, state = '') { const output = $('#presetStatus'); output.textContent = text; output.dataset.state = state; }
  async function refreshPresetList() {
    const list = $('#presetList'); const records = await savedConfigs.listByType('global-eq'); selectedPresetId = null; list.replaceChildren();
    if (!records.length) { const empty = document.createElement('p'); empty.className = 'preset-empty'; empty.textContent = 'No saved Global EQ presets.'; list.append(empty); return records; }
    records.forEach(record => { const button = document.createElement('button'); button.type = 'button'; button.className = 'preset-item'; button.dataset.presetId = String(record.id); button.textContent = record.name; button.addEventListener('click', () => { selectedPresetId = String(record.id); list.querySelectorAll('.preset-item').forEach(item => item.classList.toggle('is-selected', item === button)); $('#presetName').value = record.name; presetStatus(`Selected '${record.name}'.`); }); list.append(button); }); return records;
  }
  async function saveCurrentPreset() {
    const name = String($('#presetName').value || '').trim(); if (!name) { presetStatus('Enter a preset name.', 'error'); return; }
    try {
      const existing = (await savedConfigs.listByType('global-eq')).find(record => record.name === name); if (existing && !confirm(`Replace Global EQ preset '${name}'?`)) { presetStatus('Save cancelled.'); return; }
      const record = { type: 'global-eq', name, createdDate: existing?.createdDate || new Date().toISOString(), data: { format: 'estack-global-eq-v1', bands: serializableBands() } };
      await savedConfigs.save(record, !!existing); await refreshPresetList(); presetStatus(`'${name}' saved.`, 'success');
    } catch (error) { presetStatus(`SAVE ERROR · ${error.message}`, 'error'); }
  }
  async function loadSelectedPreset() {
    if (!selectedPresetId) { presetStatus('Select a preset first.', 'error'); return; }
    try {
      const record = await savedConfigs.getById(selectedPresetId); if (!record || record.type !== 'global-eq' || record.data?.format !== 'estack-global-eq-v1' || !Array.isArray(record.data?.bands)) throw new Error('Invalid Global EQ preset.');
      await applyCompleteBands(record.data.bands, `Preset '${record.name}'`); presetStatus(`'${record.name}' loaded.`, 'success');
    } catch (error) { presetStatus(`LOAD ERROR · ${error.message}`, 'error'); }
  }
  async function deleteSelectedPreset() {
    if (!selectedPresetId) { presetStatus('Select a preset first.', 'error'); return; }
    try { const record = await savedConfigs.getById(selectedPresetId); if (!record) throw new Error('Preset no longer exists.'); if (!confirm(`Delete Global EQ preset '${record.name}'?`)) return; await savedConfigs.delete(record.id); await refreshPresetList(); presetStatus(`'${record.name}' deleted.`, 'success'); }
    catch (error) { presetStatus(`DELETE ERROR · ${error.message}`, 'error'); }
  }
  async function pollSpectrum() {
    try {
      const levels = await service.readSpectrum(); if (!Array.isArray(levels)) throw new Error('invalid spectrum data');
      const alpha = analyzerFast ? .58 : .16; spectrum = spectrum.map((previous, index) => alpha * Number(levels[index * 2] ?? -100) + (1 - alpha) * previous); $('#spectrumState').textContent = 'LIVE SPECTRUM'; $('#spectrumState').className = 'spectrum-state is-live'; draw();
    } catch (_) { spectrum = spectrumFrequencies.map(() => -100); $('#spectrumState').textContent = 'SPECTRUM UNAVAILABLE'; $('#spectrumState').className = 'spectrum-state is-unavailable'; draw(); }
  }
  function bind() {
    $('#eqReset').addEventListener('click', async () => { if (!confirm('Reset all Global EQ slots to their neutral defaults?')) return; disabled.clear(); model.GLOBAL_EQ_SLOT_NAMES.forEach(slot => persistDisabled(slot, false)); setBusy(true); try { await service.resetAll(); setStatus('DSP API READY', 'success'); } catch (error) { setStatus(`ERROR · ${error.message}`, 'danger'); } finally { setBusy(false); render(); } });
    $('#analyzerSpeed').addEventListener('click', event => { analyzerFast = !analyzerFast; event.currentTarget.textContent = analyzerFast ? 'FAST' : 'SLOW'; event.currentTarget.classList.toggle('is-active', analyzerFast); });
    $('#delayRange').addEventListener('input', event => { $('#delayNumber').value = event.target.value; $('#delayReadout').textContent = `${Number(event.target.value).toFixed(1)} ms`; });
    $('#delayRange').addEventListener('change', event => setDelay(event.target.value)); $('#delayNumber').addEventListener('change', event => setDelay(event.target.value)); $('#delayReset').addEventListener('click', () => setDelay(0));
    document.querySelectorAll('[data-nudge]').forEach(button => button.addEventListener('click', () => setDelay((latest?.delay || 0) + Number(button.dataset.nudge)))); window.addEventListener('resize', draw);
    document.querySelectorAll('[data-dialog-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.dialogClose}`).close()));
    $('#importEq').addEventListener('click', () => { pendingImport = null; $('#importText').value = ''; $('#applyImport').disabled = true; importStatus('Paste text or choose a file.'); $('#importDialog').showModal(); });
    $('#chooseImportFile').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; $('#importText').value = await file.text(); pendingImport = null; $('#applyImport').disabled = true; importStatus(`${file.name} loaded. Select PARSE before applying.`, 'success'); });
    $('#parseImport').addEventListener('click', () => { try { pendingImport = importer.parse($('#importText').value); $('#applyImport').disabled = false; importStatus(`${pendingImport.detected} band${pendingImport.detected === 1 ? '' : 's'} detected (${pendingImport.format}).`, 'success'); } catch (error) { pendingImport = null; $('#applyImport').disabled = true; importStatus(error.message, 'error'); } });
    $('#applyImport').addEventListener('click', async () => { if (!pendingImport) return; try { await applyCompleteBands(pendingImport.bands, 'Imported EQ'); importStatus(`${pendingImport.detected} band${pendingImport.detected === 1 ? '' : 's'} imported.`, 'success'); pendingImport = null; $('#applyImport').disabled = true; } catch (error) { importStatus(error.message, 'error'); } });
    $('#presetEq').addEventListener('click', async () => { $('#presetDialog').showModal(); presetStatus('Loading presets…'); try { await refreshPresetList(); presetStatus('Select a preset or save the current EQ.'); } catch (error) { presetStatus(`ERROR · ${error.message}`, 'error'); } });
    $('#savePreset').addEventListener('click', saveCurrentPreset); $('#loadPreset').addEventListener('click', loadSelectedPreset); $('#deletePreset').addEventListener('click', deleteSelectedPreset);
  }
  service.subscribe(snapshot => { latest = { ...snapshot, slots: snapshot.slots.map(slot => ({ ...slot })) }; render(); });
  loadDisabled(); bind(); setStatus('CONNECTING'); service.refresh().then(() => { setStatus('DSP API READY', 'success'); spectrumTimer = window.setInterval(pollSpectrum, 170); pollSpectrum(); }).catch(error => setStatus(`UNAVAILABLE · ${error.message}`, 'danger'));
  window.addEventListener('beforeunload', () => { if (spectrumTimer) window.clearInterval(spectrumTimer); });
})();
