(() => {
  'use strict';
  document.documentElement.dataset.prototypePage = 'advanced';

  const $ = selector => document.querySelector(selector);
  const adapter = window.EStackPrototypeDSP;
  const ways = ['SUB', 'KICK', 'MID L', 'MID R', 'HIGH L', 'HIGH R'];
  const defaults = Object.freeze({
    pipeline: [
      { name: 'CAPTURE', detail: 'Input L/R', type: 'Input' },
      { name: 'INPUT STAGE', detail: 'EQ · Loudness · delay', type: 'Filter' },
      { name: 'MIXER', detail: 'Source map', type: 'Mixer' },
      { name: 'OUTPUT', detail: 'Per-way processing', type: 'Filter' }
    ],
    mixers: ways.map((way, index) => ({ way, channel: index + 1, source: index % 2 ? 'IN R' : 'IN L', gain: 0, inverted: false, muted: false })),
    filters: Object.fromEntries(ways.map(way => [way, [
      { name: 'CROSSOVER', mode: 'LR', detail: 'HPF / LPF' },
      { name: 'PARAMETRIC EQ', mode: 'PEQ', detail: '5 bands' },
      { name: 'PROTECTION', mode: 'Limiter', detail: 'Output guard' }
    ]]))
  });
  let selectedNode = null;

  const copyDefaults = () => JSON.parse(JSON.stringify(defaults));
  const currentAdvanced = config => ({
    pipeline: Array.isArray(config.advanced?.pipeline) ? config.advanced.pipeline : copyDefaults().pipeline,
    mixers: Array.isArray(config.advanced?.mixers) ? config.advanced.mixers : copyDefaults().mixers,
    filters: config.advanced?.filters || copyDefaults().filters
  });
  const writeAdvanced = (mutator, reason) => adapter.apply(config => {
    const advanced = currentAdvanced(config);
    mutator(advanced);
    config.advanced = advanced;
  }, reason);

  function renderPipeline(model) {
    $('#pipelineContainer').replaceChildren(...ways.map((way, index) => {
      const row = document.createElement('div'); row.className = 'pipeline-channel';
      const label = document.createElement('div'); label.className = 'pipeline-channel__label'; label.textContent = `CH ${index + 1} · ${way}`;
      const stages = document.createElement('div'); stages.className = 'pipeline-stages';
      model.pipeline.forEach((stage, stageIndex) => {
        const node = document.createElement('button'); node.type = 'button'; node.className = 'pipeline-node';
        const nodeId = `${index}:${stageIndex}`;
        if (nodeId === selectedNode) node.classList.add('is-selected');
        node.innerHTML = `<strong>${stage.name}</strong><span>${stageIndex === model.pipeline.length - 1 ? way : stage.detail}</span>`;
        node.addEventListener('click', () => { selectedNode = nodeId; renderPipeline(model); });
        stages.append(node);
      });
      row.append(label, stages); return row;
    }));
  }

  function renderMixers(model) {
    $('#mixers').replaceChildren(...model.mixers.map((mixer, index) => {
      const card = document.createElement('article'); card.className = 'mixer-card';
      card.innerHTML = `<header><strong>${mixer.way}</strong><span>PLAYBACK CH ${mixer.channel}</span></header><div class="mixer-source"><label>SOURCE<select class="ui-select"><option${mixer.source === 'IN L' ? ' selected' : ''}>IN L</option><option${mixer.source === 'IN R' ? ' selected' : ''}>IN R</option></select></label><label>GAIN<input class="ui-number" type="number" min="-60" max="12" step=".1" value="${Number(mixer.gain).toFixed(1)}"></label></div><div class="mixer-flags"><label><input type="checkbox"${mixer.inverted ? ' checked' : ''}> Inverted</label><label><input type="checkbox"${mixer.muted ? ' checked' : ''}> Muted</label></div>`;
      const [source, gain] = card.querySelectorAll('select,input[type="number"]');
      const [inverted, muted] = card.querySelectorAll('input[type="checkbox"]');
      source.addEventListener('change', () => updateMixer(index, { source: source.value }));
      gain.addEventListener('change', () => updateMixer(index, { gain: Number(gain.value) }));
      inverted.addEventListener('change', () => updateMixer(index, { inverted: inverted.checked }));
      muted.addEventListener('change', () => updateMixer(index, { muted: muted.checked }));
      return card;
    }));
  }

  function updateMixer(index, patch) {
    writeAdvanced(model => { model.mixers[index] = { ...model.mixers[index], ...patch }; }, 'advanced mixer updated');
  }

  function renderFilters(model) {
    $('#filterChannels').replaceChildren(...ways.map(way => {
      const channel = document.createElement('article'); channel.className = 'filter-channel';
      const filterList = model.filters[way] || [];
      channel.innerHTML = `<div class="filter-channel__name"><strong>${way}</strong><span>OUTPUT CH ${ways.indexOf(way) + 1}</span></div><div class="filter-chain"></div>`;
      const chain = channel.querySelector('.filter-chain');
      filterList.forEach((filter, index) => {
        const card = document.createElement('article'); card.className = 'filter-card';
        card.innerHTML = `<strong>${filter.name}</strong><select class="ui-select"><option${filter.mode === 'LR' ? ' selected' : ''}>LR</option><option${filter.mode === 'PEQ' ? ' selected' : ''}>PEQ</option><option${filter.mode === 'Limiter' ? ' selected' : ''}>Limiter</option><option${filter.mode === 'Bypass' ? ' selected' : ''}>Bypass</option></select><small>${filter.detail}</small>`;
        card.querySelector('select').addEventListener('change', event => writeAdvanced(model => { model.filters[way][index].mode = event.target.value; }, 'advanced filter mode updated'));
        chain.append(card);
      });
      return channel;
    }));
  }

  function renderProcessors(config) {
    const safety = config.processors?.ESTACK_LIMITER || { enabled: true, state: 'safe', margin: 0, ceiling: -2 };
    const items = [
      ['INPUT EQ', config.filters?.ESTACK_GLOBAL_EQ ? 'Configured' : 'Bypass', !!config.filters?.ESTACK_GLOBAL_EQ, 'GLOBAL'],
      ['LOUDNESS', config.filters?.ESTACK_LOUDNESS ? 'Configured' : 'Bypass', !!config.filters?.ESTACK_LOUDNESS, 'AUX 1'],
      ['OUTPUT LIMITER', safety.state === 'hard' ? 'Hard limit active' : safety.state === 'compress' ? 'Near limit' : safety.enabled ? 'Armed' : 'Bypass', !!safety.enabled, `${Number(safety.ceiling || -2).toFixed(1)} dBFS`],
      ['CONTROL MASTER', 'Shared Control state', true, `${Number(config.volume ?? -12).toFixed(1)} dB`]
    ];
    $('#processorList').innerHTML = items.map(([name, state, active, value]) => `<article class="processor ${active ? 'is-active' : ''} ${state.includes('limit') ? 'is-warning' : ''}"><strong>${name}</strong><span>${state}</span><output>${value}</output></article>`).join('');
    $('#toggleLimiter').textContent = safety.enabled ? 'LIMITER OFF' : 'LIMITER ON';
    $('#toggleLimiter').classList.toggle('is-active', !safety.enabled);
  }

  function render(config) {
    const model = currentAdvanced(config);
    renderPipeline(model); renderMixers(model); renderFilters(model); renderProcessors(config);
    $('#advancedState').textContent = config.connected ? 'MOCK SESSION' : 'LOCAL MODEL';
    $('#advancedState').className = `ui-status ${config.connected ? 'is-success' : 'is-pending'}`;
    $('#mixerState').textContent = `${model.mixers.length} OUTPUTS`;
  }

  $('#pipelineReset').addEventListener('click', () => writeAdvanced(model => { model.pipeline = copyDefaults().pipeline; }, 'advanced pipeline restored'));
  $('#resetFilters').addEventListener('click', () => writeAdvanced(model => { model.filters = copyDefaults().filters; }, 'advanced filters restored'));
  $('#toggleLimiter').addEventListener('click', () => adapter.apply(config => {
    const current = config.processors.ESTACK_LIMITER || { enabled: true, ceiling: -2 };
    config.processors.ESTACK_LIMITER = { ...current, enabled: !current.enabled };
  }, 'advanced limiter updated'));
  adapter.subscribe(render);
})();
