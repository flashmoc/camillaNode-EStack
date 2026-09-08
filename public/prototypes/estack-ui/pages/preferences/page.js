(() => {
  'use strict';
  document.documentElement.dataset.prototypePage = 'preferences';

  const $ = id => document.getElementById(id);
  const adapter = window.EStackPrototypeDSP;
  const defaults = Object.freeze({ density: 'comfortable', meterMotion: true, graphGrid: true, safetyConfirm: true });
  let preferences = { ...defaults };

  function render(next, note = 'Saved locally') {
    preferences = { ...defaults, ...next };
    $('density').value = preferences.density;
    $('meterMotion').checked = preferences.meterMotion;
    $('graphGrid').checked = preferences.graphGrid;
    $('safetyConfirm').checked = preferences.safetyConfirm;
    document.documentElement.dataset.prototypeDensity = preferences.density;
    $('preferencesState').textContent = 'SAVED LOCALLY';
    $('preferencesNote').textContent = note;
  }

  function save(note = 'Applies inside the prototype only.') {
    preferences = {
      density: $('density').value,
      meterMotion: $('meterMotion').checked,
      graphGrid: $('graphGrid').checked,
      safetyConfirm: $('safetyConfirm').checked
    };
    adapter.apply(config => { config.preferences = { ...preferences }; }, 'preferences updated');
    render(preferences, note);
  }

  ['density', 'meterMotion', 'graphGrid', 'safetyConfirm'].forEach(id => {
    $(id).addEventListener('change', () => save('Local workspace preference saved.'));
  });
  $('restorePreferences').addEventListener('click', () => {
    preferences = { ...defaults };
    adapter.apply(config => { config.preferences = { ...preferences }; }, 'preferences restored');
    render(preferences, 'Local defaults restored.');
  });
  adapter.subscribe(config => render(config.preferences || defaults));
})();
