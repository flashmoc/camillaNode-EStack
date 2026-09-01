(() => {
  'use strict';
  const makeBands = seed => [
    { id: 1, enabled: true, type: 'Peaking', freq: 63 + seed * 3, gain: seed % 2 ? 1.2 : -1.4, q: 1.1 },
    { id: 2, enabled: true, type: 'Peaking', freq: 128 + seed * 12, gain: -2.0 + seed * 0.2, q: 0.9 },
    { id: 3, enabled: true, type: 'Peaking', freq: 420 + seed * 45, gain: seed > 3 ? -1.8 : 0.8, q: 1.7 },
    { id: 4, enabled: false, type: 'Peaking', freq: 1600 + seed * 180, gain: 1.0, q: 1.2 },
    { id: 5, enabled: true, type: seed > 3 ? 'Highshelf' : 'Peaking', freq: 5200 + seed * 400, gain: seed > 3 ? -1.2 : 0.5, q: 0.8 }
  ];
  const ways = [
    { id: 0, name: 'SUB', color: '#58d6e4', gain: -8.2, level: -24.1, headroom: 11.8, limiter: 'normal', delay: 0.00, phase: 0.0, polarity: 'normal', mute: false, bypass: false, threshold: -6.0, hpf: { enabled: true, type: 'BW', freq: 28, slope: 24 }, lpf: { enabled: true, type: 'LR', freq: 130, slope: 24 }, peq: makeBands(0) },
    { id: 1, name: 'KICK', color: '#e59b3a', gain: -16.4, level: -28.2, headroom: 10.6, limiter: 'normal', delay: 0.35, phase: -22.0, polarity: 'inverted', mute: false, bypass: false, threshold: -7.5, hpf: { enabled: true, type: 'LR', freq: 90, slope: 24 }, lpf: { enabled: true, type: 'LR', freq: 190, slope: 24 }, peq: makeBands(1) },
    { id: 2, name: 'MID L', color: '#58c582', gain: -12.5, level: -31.7, headroom: 13.1, limiter: 'normal', delay: 0.59, phase: -14.0, polarity: 'normal', mute: false, bypass: false, threshold: -8.0, hpf: { enabled: true, type: 'LR', freq: 170, slope: 24 }, lpf: { enabled: true, type: 'LR', freq: 1550, slope: 24 }, peq: makeBands(2) },
    { id: 3, name: 'MID R', color: '#4ba37c', gain: -12.5, level: -32.4, headroom: 13.8, limiter: 'normal', delay: 0.61, phase: -16.0, polarity: 'normal', mute: false, bypass: false, threshold: -8.0, hpf: { enabled: true, type: 'LR', freq: 170, slope: 24 }, lpf: { enabled: true, type: 'LR', freq: 1550, slope: 24 }, peq: makeBands(3) },
    { id: 4, name: 'HIGH L', color: '#9a78db', gain: -10.8, level: -34.8, headroom: 16.2, limiter: 'normal', delay: 0.52, phase: -8.0, polarity: 'normal', mute: false, bypass: false, threshold: -10.0, hpf: { enabled: true, type: 'LR', freq: 1450, slope: 24 }, lpf: { enabled: false, type: 'BW', freq: 19000, slope: 12 }, peq: makeBands(4) },
    { id: 5, name: 'HIGH R', color: '#c46dba', gain: -10.8, level: -35.3, headroom: 16.7, limiter: 'normal', delay: 0.53, phase: -9.0, polarity: 'normal', mute: false, bypass: false, threshold: -10.0, hpf: { enabled: true, type: 'LR', freq: 1450, slope: 24 }, lpf: { enabled: false, type: 'BW', freq: 19000, slope: 12 }, peq: makeBands(5) }
  ];
  window.EStackPrototypeFixtures = Object.freeze({ sampleRate: 48000, speedOfSound: 343, system: { dsp: 'online', preset: 'REFERENCE', saved: true, master: -12.0, clip: false, limiting: false, headroom: 9.8 }, ways });
})();
