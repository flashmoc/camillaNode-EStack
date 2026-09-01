(() => {
  'use strict';
  const mode = new URLSearchParams(window.location.search).get('mode');
  document.documentElement.dataset.displayMode = mode === 'integrated' ? 'integrated' : 'standalone';
})();
