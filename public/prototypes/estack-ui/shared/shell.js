(() => {
  'use strict';
  const links = [...document.querySelectorAll('[data-page]')];
  const frame = document.querySelector('#pageFrame');
  const mobileNav = document.createElement('div');
  mobileNav.className = 'shell-mobile-nav';
  mobileNav.innerHTML = '<label for="mobilePageSelect">PAGE</label><select id="mobilePageSelect" aria-label="Choose prototype page"></select>';
  document.querySelector('.shell-nav').before(mobileNav);
  const mobileSelect = mobileNav.querySelector('select');
  links.forEach(link => {
    const option = document.createElement('option');
    option.value = link.dataset.page;
    option.textContent = link.textContent;
    mobileSelect.appendChild(option);
  });
  const routes = Object.fromEntries(links.map(link => [link.dataset.page, link.dataset.page === 'output-processing' ? new URL('../per-way/?mode=integrated', document.baseURI).href : link.href]));
  const choose = name => {
    const route = routes[name] || routes['output-processing'];
    frame.src = route;
    links.forEach(link => link.setAttribute('aria-current', link.dataset.page === name ? 'page' : 'false'));
    mobileSelect.value = routes[name] ? name : 'output-processing';
    history.replaceState(null, '', `#${name}`);
  };
  links.forEach(link => link.addEventListener('click', event => { event.preventDefault(); choose(link.dataset.page); }));
  mobileSelect.addEventListener('change', () => choose(mobileSelect.value));
  window.addEventListener('hashchange', () => choose(location.hash.slice(1)));
  choose(location.hash.slice(1) || 'output-processing');
})();
