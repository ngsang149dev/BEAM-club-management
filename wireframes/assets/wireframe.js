(() => {
  'use strict';

  const root = document.documentElement;
  const STORAGE_KEY = 'beam-wireframe-lang';
  const langButtons = Array.from(document.querySelectorAll('[data-lang-btn]'));

  function readLang() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'vi') return stored;
    } catch (error) {
      /* Storage can be unavailable in private mode; Vietnamese is the fallback. */
    }
    return 'vi';
  }

  function applyLanguage(lang) {
    root.lang = lang;
    document.querySelectorAll('[data-vi]').forEach((el) => {
      const value = el.getAttribute(lang === 'en' ? 'data-en' : 'data-vi');
      if (value !== null) el.textContent = value;
    });
    document.querySelectorAll('[data-vi-ph]').forEach((el) => {
      const value = el.getAttribute(lang === 'en' ? 'data-en-ph' : 'data-vi-ph');
      if (value !== null) el.setAttribute('placeholder', value);
    });
    document.querySelectorAll('[data-vi-aria]').forEach((el) => {
      const value = el.getAttribute(lang === 'en' ? 'data-en-aria' : 'data-vi-aria');
      if (value !== null) el.setAttribute('aria-label', value);
    });
    langButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.langBtn === lang));
    });
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (error) {
      /* Ignore storage failures; the switch still works for this page. */
    }
  }

  langButtons.forEach((button) => {
    button.addEventListener('click', () => applyLanguage(button.dataset.langBtn));
  });

  applyLanguage(readLang());

  /* Scale the 1280 / 390 frames down to the document column. The reviewer can
     return to 1:1 and scroll, which keeps the wireframe geometry honest. */
  function fitFrame(block) {
    const viewport = block.querySelector('[data-viewport]');
    const device = block.querySelector('[data-device]');
    if (!viewport || !device) return;
    const readout = block.querySelector('[data-scale-readout]');
    const width = Number(device.dataset.w || device.offsetWidth);
    const height = Number(device.dataset.h || device.offsetHeight);
    const actual = viewport.classList.contains('is-actual');

    if (actual) {
      device.style.transform = 'none';
      viewport.style.height = height + 'px';
      if (readout) readout.textContent = '1:1';
      return;
    }

    const available = viewport.clientWidth;
    const scale = Math.min(1, available / width);
    device.style.transform = 'scale(' + scale + ')';
    viewport.style.height = Math.ceil(height * scale) + 'px';
    if (readout) {
      readout.textContent = scale > 0.995 ? '100%' : Math.round(scale * 100) + '%';
    }
  }

  const blocks = Array.from(document.querySelectorAll('[data-frame]'));
  let frameQueued = false;
  function fitAll() {
    if (frameQueued) return;
    frameQueued = true;
    window.requestAnimationFrame(() => {
      blocks.forEach(fitFrame);
      frameQueued = false;
    });
  }

  blocks.forEach((block) => {
    const button = block.querySelector('[data-zoom]');
    const viewport = block.querySelector('[data-viewport]');
    if (!button || !viewport) return;
    button.addEventListener('click', () => {
      const isActual = viewport.classList.toggle('is-actual');
      button.setAttribute('aria-pressed', String(isActual));
      fitFrame(block);
    });
    fitFrame(block);
  });

  window.addEventListener('resize', fitAll);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitAll);
  }
  fitAll();

  const printButton = document.querySelector('[data-print]');
  if (printButton) {
    printButton.addEventListener('click', () => window.print());
  }

  /* Keep the current screen visible in the horizontal navigation on small screens. */
  const current = document.querySelector('.rail-link[aria-current="page"]');
  if (current && current.parentElement) {
    try {
      current.scrollIntoView({ block: 'nearest', inline: 'center' });
    } catch (error) {
      /* Older browsers may not support options; the link is still reachable. */
    }
  }
})();
