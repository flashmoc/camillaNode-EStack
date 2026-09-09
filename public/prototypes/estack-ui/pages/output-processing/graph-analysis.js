(() => {
  'use strict';
  const M = window.EStackOutputProcessingModel;
  if (!M) throw new Error('Output graph analysis requires the Output Processing model.');
  const XO_PAIRS = Object.freeze([
    { id: 'sub-kick', lower: 0, upper: 1, label: 'SUB / KICK' },
    { id: 'kick-mid-l', lower: 1, upper: 2, label: 'KICK / MID L' },
    { id: 'kick-mid-r', lower: 1, upper: 3, label: 'KICK / MID R' },
    { id: 'mid-high-l', lower: 2, upper: 4, label: 'MID L / HIGH L' },
    { id: 'mid-high-r', lower: 3, upper: 5, label: 'MID R / HIGH R' }
  ]);
  const SPECTRUM_FREQUENCIES = Object.freeze([25,30,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000]);
  const SPECTRUM_VIEWS = Object.freeze({ full: [20, 20000], sub: [20, 120], low: [60, 400], mid: [200, 3000], high: [1000, 20000] });
  const C = (r = 1, i = 0) => ({ r, i });
  const mul = (a, b) => C(a.r * b.r - a.i * b.i, a.r * b.i + a.i * b.r);
  const div = (a, b) => { const d = b.r * b.r + b.i * b.i || 1e-30; return C((a.r * b.r + a.i * b.i) / d, (a.i * b.r - a.r * b.i) / d); };
  const polar = (angle, magnitude = 1) => C(magnitude * Math.cos(angle), magnitude * Math.sin(angle));
  const clamp = M.clamp;
  const wrapPhase = degrees => { let value = ((degrees + 180) % 360 + 360) % 360 - 180; return Math.abs(value + 180) < 1e-9 ? 180 : value; };
  const db = value => 20 * Math.log10(Math.max(1e-14, Math.hypot(value.r, value.i)));
  const phase = value => Math.atan2(value.i, value.r) * 180 / Math.PI;
  function rbj(filter, frequency, sampleRate) {
    const p = filter?.parameters || {}; const fs = clamp(sampleRate || 48000, 8000, 384000); const freq = clamp(p.freq || 1000, 1, fs / 2 - 1); const w0 = 2 * Math.PI * freq / fs; const c = Math.cos(w0); const s = Math.sin(w0); const A = Math.pow(10, Number(p.gain || 0) / 40); const alpha = s / (2 * Math.max(.0001, Number(p.q || .7))); const beta = 2 * Math.sqrt(A) * alpha; let b0,b1,b2,a0,a1,a2;
    if (p.type === 'Lowshelf') { b0=A*((A+1)-(A-1)*c+beta); b1=2*A*((A-1)-(A+1)*c); b2=A*((A+1)-(A-1)*c-beta); a0=(A+1)+(A-1)*c+beta; a1=-2*((A-1)+(A+1)*c); a2=(A+1)+(A-1)*c-beta; }
    else if (p.type === 'Highshelf') { b0=A*((A+1)+(A-1)*c+beta); b1=-2*A*((A-1)+(A+1)*c); b2=A*((A+1)+(A-1)*c-beta); a0=(A+1)-(A-1)*c+beta; a1=2*((A-1)-(A+1)*c); a2=(A+1)-(A-1)*c-beta; }
    else { b0=1+alpha*A; b1=-2*c; b2=1-alpha*A; a0=1+alpha/A; a1=-2*c; a2=1-alpha/A; }
    const w = 2 * Math.PI * clamp(frequency, 1, fs / 2 - 1) / fs; const z1 = polar(-w), z2 = polar(-2*w);
    return div(C(b0/a0 + b1/a0*z1.r + b2/a0*z2.r, b1/a0*z1.i + b2/a0*z2.i), C(1 + a1/a0*z1.r + a2/a0*z2.r, a1/a0*z1.i + a2/a0*z2.i));
  }
  function combo(filter, frequency) {
    const p = filter?.parameters || {}; const fc = Math.max(1, Number(p.freq || 1000)); const order = Math.max(1, Number(p.order || 1)); const high = /Highpass$/i.test(String(p.type || '')); const lr = /^LinkwitzRiley/i.test(String(p.type || '')); const ratio = Math.max(1e-8, frequency / fc); const magnitude = lr ? (high ? Math.pow(ratio, order) / (1 + Math.pow(ratio, order)) : 1 / (1 + Math.pow(ratio, order))) : (high ? Math.pow(ratio, order) / Math.sqrt(1 + Math.pow(ratio, 2 * order)) : 1 / Math.sqrt(1 + Math.pow(ratio, 2 * order)));
    const angle = (high ? 1 : -1) * order * Math.atan(ratio) * 180 / Math.PI;
    return polar(angle * Math.PI / 180, magnitude);
  }
  function allpass(filter, frequency, sampleRate) {
    const metadata = M.phaseMetadata(filter); const degrees = metadata?.degrees || 0; const ref = metadata?.referenceHz || 1000; const fs = clamp(sampleRate || 48000, 8000, 384000); const denom = Math.tan(Math.PI * ref / fs) || 1e-12; const ratio = Math.tan(Math.PI * frequency / fs) / denom;
    const direction = degrees <= 0 ? 1 : -1; return polar(direction * -2 * Math.atan(ratio), 1);
  }
  function filterResponse(filter, frequency, sampleRate) {
    if (!filter) return C(); if (filter.type === 'BiquadCombo') return combo(filter, frequency); if (filter.type === 'Biquad') return filter.parameters?.type === 'AllpassFO' ? allpass(filter, frequency, sampleRate) : rbj(filter, frequency, sampleRate); if (filter.type === 'Delay') return polar(-2 * Math.PI * frequency * Number(filter.parameters?.delay || 0) / 1000); if (filter.type === 'Gain') return polar(filter.parameters?.inverted ? Math.PI : 0, Math.pow(10, Number(filter.parameters?.gain || 0) / 20)); return C();
  }
  function channelResponse(config, channel, frequency) {
    const data = M.discover(config).find(item => item.channel === Number(channel)); if (!data) return C(); const fs = config.devices?.samplerate || 48000;
    return data.stageNames.reduce((total, name) => mul(total, filterResponse(config.filters?.[name], frequency, fs)), C());
  }
  function pairFrequency(config, pair) { const ways = M.discover(config); const lower = ways.find(item => item.channel === pair.lower); const upper = ways.find(item => item.channel === pair.upper); const a = Number(lower?.crossover?.lpf?.filter?.parameters?.freq); const b = Number(upper?.crossover?.hpf?.filter?.parameters?.freq); return a > 0 && b > 0 ? Math.sqrt(a * b) : (a || b || 1000); }
  window.EStackOutputGraphAnalysis = Object.freeze({ XO_PAIRS, SPECTRUM_FREQUENCIES, SPECTRUM_VIEWS, wrapPhase, db, phase, filterResponse, channelResponse, pairFrequency });
})();
