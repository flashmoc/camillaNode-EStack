(() => {
  'use strict';
  const links = [...document.querySelectorAll('[data-page]')];
  const frame = document.querySelector('#pageFrame');
  const routes = Object.fromEntries(links.map(link => [link.dataset.page, link.href]));
  const choose = name => {
    const route = routes[name] || routes['output-processing'];
    frame.src = route;
    links.forEach(link => link.setAttribute('aria-current', link.dataset.page === name ? 'page' : 'false'));
    history.replaceState(null, '', `#${name}`);
  };
  links.forEach(link => link.addEventListener('click', event => { event.preventDefault(); choose(link.dataset.page); }));
  window.addEventListener('hashchange', () => choose(location.hash.slice(1)));
  choose(location.hash.slice(1) || 'output-processing');
})();
