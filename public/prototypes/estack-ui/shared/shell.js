(() => {
  'use strict';
  const links = [...document.querySelectorAll('[data-page]')];
  const frame = document.querySelector('#pageFrame');
  const mobileNav = document.createElement('div');
  mobileNav.className = 'shell-mobile-nav';
  mobileNav.innerHTML = '<label for="mobilePageSelect">PAGE</label><select id="mobilePageSelect" aria-label="Choose prototype page"></select>';
  document.querySelector('.shell-nav').before(mobileNav);
  const mobileSelect = mobileNav.querySelector('select');
  const shellMaster = document.querySelector('[data-shell-master]');
  const shellHeadroom = document.querySelector('[data-shell-headroom]');
  const shellClip = document.querySelector('[data-shell-clip]');
  const shellLimiters = document.querySelector('[data-shell-limiters]');
  const hardwareTransport = new URLSearchParams(location.search).get('transport') === 'camillanode';
  const banner = document.querySelector('.prototype-banner');
  const shellBrand = document.querySelector('.shell-brand strong');
  const shellOnline = document.querySelector('.shell-context .ui-status');
  document.title = 'E-Stack DSP';
  if (shellBrand) shellBrand.textContent = 'E-Stack DSP';
  if (banner) {
    banner.querySelector('strong').textContent = hardwareTransport ? 'E-STACK DSP · CAMILLANODE MODE' : 'E-STACK DSP · PRODUCT PREVIEW';
    banner.querySelector('span').textContent = hardwareTransport ? 'Same-origin CamillaNode API enabled' : 'Local model · DSP transport disabled';
  }
  if (hardwareTransport && shellOnline) shellOnline.textContent = 'DSP API READY';
  const shellMasterPanel = document.querySelector('.shell-master');
  const referenceStatus = { master: -12, headroom: 9.8, condition: 'normal' };
  const clone = value => JSON.parse(JSON.stringify(value));
  let prototypeDspState = {
    connected: false,
    transport: 'local-simulation',
    devices: { capture: { type: 'ALSA', device: 'Loopback capture', channels: 2 }, playback: { type: 'ALSA', device: 'E-Stack 6-way', channels: 6 } },
    pipeline: [{ type: 'Filter', channels: [0, 1], description: 'E-Stack input stage' }, { type: 'Mixer', description: 'E-Stack routing' }, { type: 'Filter', channels: [0, 1, 2, 3, 4, 5], description: 'E-Stack output processing' }],
    filters: {}, processors: {}, volume: -12, revision: 1
  };
  const renderShellStatus = ({ master, headroom, condition } = referenceStatus) => {
    const critical = condition === 'hard';
    const warning = condition === 'compress';
    if (shellMaster) shellMaster.textContent = `${master.toFixed(1).replace('-', '−')} dB`;
    if (shellHeadroom) shellHeadroom.textContent = `${Math.max(0, headroom).toFixed(1)} dB`;
    if (shellMasterPanel) shellMasterPanel.dataset.state = critical ? 'hard' : warning ? 'compress' : 'normal';
    if (shellClip) { shellClip.textContent = critical ? 'HARD LIMIT ACTIVE' : warning ? 'COMPRESSION ACTIVE' : 'NO CLIP'; shellClip.className = `ui-badge optional ${critical ? 'is-critical' : warning ? 'is-warning' : 'is-success'}`; }
    if (shellLimiters) { shellLimiters.textContent = critical ? 'LIMITERS ACTIVE' : warning ? 'LIMITERS ENGAGED' : 'LIMITERS ARMED'; shellLimiters.className = `ui-badge optional ${critical ? 'is-critical' : warning ? 'is-warning' : 'is-success'}`; }
  };
  let frameResize = 0;
  const refreshFrameLayout = () => {
    window.cancelAnimationFrame(frameResize);
    frameResize = window.requestAnimationFrame(() => {
      const width = Math.floor(frame.parentElement.getBoundingClientRect().width);
      if (width > 0) frame.style.width = `${width}px`;
      frame.contentWindow?.dispatchEvent(new Event('resize'));
    });
  };
  new ResizeObserver(refreshFrameLayout).observe(frame);
  frame.addEventListener('load', refreshFrameLayout);
  window.addEventListener('resize', refreshFrameLayout);
  links.forEach(link => {
    const option = document.createElement('option');
    option.value = link.dataset.page;
    option.textContent = link.textContent;
    mobileSelect.appendChild(option);
  });
  const shellRevision = 'product-v2';
  const productMount = location.pathname.startsWith('/estack-dsp/');
  const routes = Object.fromEntries(links.map(link => {
    const route = new URL(link.href);
    route.searchParams.set('v', shellRevision);
    if (hardwareTransport) route.searchParams.set('transport', 'camillanode');
    return [link.dataset.page, route.href];
  }));
  const choose = name => {
    renderShellStatus();
    const route = routes[name] || routes['output-processing'];
    frame.src = route;
    links.forEach(link => link.setAttribute('aria-current', link.dataset.page === name ? 'page' : 'false'));
    mobileSelect.value = routes[name] ? name : 'output-processing';
    history.replaceState(null, '', `#${name}`);
  };
  links.forEach(link => link.addEventListener('click', event => { event.preventDefault(); choose(link.dataset.page); }));
  mobileSelect.addEventListener('change', () => choose(mobileSelect.value));
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    const detail = event.data;
    if (detail?.type === 'estack-prototype-dsp-register') {
      frame.contentWindow?.postMessage({ type: 'estack-prototype-dsp-state', state: clone(prototypeDspState), reason: 'initial shell state' }, window.location.origin);
      return;
    }
    if (detail?.type === 'estack-prototype-dsp-apply' && detail.state) {
      prototypeDspState = clone(detail.state);
      prototypeDspState.revision = Number(prototypeDspState.revision || 0) + 1;
      frame.contentWindow?.postMessage({ type: 'estack-prototype-dsp-state', state: clone(prototypeDspState), reason: detail.reason || 'local change' }, window.location.origin);
      return;
    }
    if (!detail || detail.type !== 'estack-control-status' || !Number.isFinite(detail.master) || !Number.isFinite(detail.headroom)) return;
    renderShellStatus(detail);
  });
  window.addEventListener('hashchange', () => choose(location.hash.slice(1)));
  choose(location.hash.slice(1) || 'output-processing');
})();
