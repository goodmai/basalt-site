// 1. Conditional polyfills (loaded ONLY when native browser support is absent)
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  import('https://esm.run/invokers-polyfill').catch(() => {});
}

if (!Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
  import('https://esm.run/@microsoft/focusgroup-polyfill')
    .then((mod) => mod.polyfill?.())
    .catch(() => {});
}

// 2. Scroll Progress Indicator fallback (when CSS scroll() timeline is unsupported)
if (!CSS.supports('animation-timeline', 'scroll()')) {
  const progress = document.querySelector('#scroll-progress');
  if (progress) {
    window.addEventListener('scroll', () => {
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / scrollable));
      progress.style.transform = `scaleX(${ratio})`;
    }, { passive: true });
  }
}

// 3. ViewTimeline entry reveal fallback (gated on prefers-reduced-motion: no-preference)
if (
  !CSS.supports('(animation-timeline: view()) and (animation-range: entry)') &&
  matchMedia('(prefers-reduced-motion: no-preference)').matches
) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const r = entry.intersectionRatio;
        entry.target.style.opacity = String(0.25 + r * 0.75);
        entry.target.style.scale = String(0.96 + r * 0.04);
      }
    },
    { threshold: Array.from({ length: 21 }, (_, i) => i / 20) }
  );
  document.querySelectorAll('.reveal-card').forEach((el) => revealObserver.observe(el));
}

// 4. Copy Button Invoker Command (--copy) + VoiceOver repeat-announcement fix
const copyTimers = new WeakMap();
let lastCopyAnnouncement = '';

function legacyCopy(text) {
  const field = Object.assign(document.createElement('textarea'), { value: text });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}

function reportCopy(button, ok) {
  const tip = button.nextElementSibling;
  if (!tip) return;
  clearTimeout(copyTimers.get(button));
  button.removeAttribute('data-copied');
  button.removeAttribute('data-failed');
  const lang = document.documentElement.lang === 'en' ? 'en' : 'ru';
  let message = ok
    ? (lang === 'en' ? 'Copied' : 'Скопировано')
    : (lang === 'en' ? 'Copy failed' : 'Ошибка');
  if (message === lastCopyAnnouncement) message += '\u00A0';
  lastCopyAnnouncement = message;

  tip.textContent = '';
  void button.offsetWidth;
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
  requestAnimationFrame(() => {
    tip.textContent = message;
  });
  copyTimers.set(
    button,
    setTimeout(() => {
      button.removeAttribute('data-copied');
      button.removeAttribute('data-failed');
      tip.textContent = '';
    }, 2000)
  );
}

async function copyTarget(button, target) {
  if (!button || !target) return;
  const text = target.matches('input, textarea') ? target.value : target.innerText.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    reportCopy(button, true);
  } catch {
    if (legacyCopy(text)) {
      reportCopy(button, true);
    } else {
      reportCopy(button, false);
    }
  }
}

if ('CommandEvent' in window) {
  document.addEventListener(
    'command',
    (event) => {
      if (event.command === '--copy') {
        copyTarget(event.source, event.target);
      }
    },
    true
  );
} else {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[command="--copy"]');
    if (!button) return;
    const target = document.getElementById(button.getAttribute('commandfor'));
    if (target) copyTarget(button, target);
  });
}

// 5. Accordion Expand/Collapse All (--toggle-all) + aria-expanded sync
function toggleAllAccordion(button, accordion) {
  if (!button || !accordion) return;
  const expand = button.getAttribute('aria-expanded') !== 'true';
  for (const details of accordion.querySelectorAll(':scope > details')) {
    details.open = expand;
  }
  button.setAttribute('aria-expanded', String(expand));
}

if ('CommandEvent' in window) {
  document.addEventListener(
    'command',
    (event) => {
      if (event.command === '--toggle-all') {
        toggleAllAccordion(event.source, event.target);
      }
    },
    true
  );
} else {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[command="--toggle-all"]');
    if (!button) return;
    const target = document.getElementById(button.getAttribute('commandfor'));
    if (target) toggleAllAccordion(button, target);
  });
}

document.addEventListener(
  'toggle',
  (event) => {
    if (!(event.target instanceof HTMLDetailsElement)) return;
    const accordion = event.target.parentElement;
    if (!accordion?.classList.contains('accordion')) return;
    const button = document.querySelector(`[command="--toggle-all"][commandfor="${CSS.escape(accordion.id)}"]`);
    if (!button) return;
    const items = accordion.querySelectorAll(':scope > details');
    const allOpen = Array.prototype.every.call(items, (d) => d.open);
    button.setAttribute('aria-expanded', String(allOpen));
  },
  { capture: true }
);

// 6. Top-layer <dialog closedby="any"> exit transition & light-dismiss fallbacks
let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay();
}

async function closeTopLayer(dialog) {
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '');
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeTopLayer(dialog);
  });

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) closeTopLayer(dialog);
    });
  }

  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    document.querySelectorAll(`button[commandfor="${CSS.escape(dialog.id)}"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.getAttribute('command');
        if (cmd === 'show-modal') dialog.showModal();
        else if (cmd === 'close') closeTopLayer(dialog);
      });
    });
  }
}

// 7. Two-state Theme Toggle (<meta name="color-scheme"> + localStorage, no retroactive wipe)
const schemeMeta = document.querySelector('meta[name="color-scheme"]');
const themeBtn = document.getElementById('theme-toggle');

function currentlyRenderedDark() {
  const content = schemeMeta?.content || 'light dark';
  if (content === 'dark') return true;
  if (content === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

themeBtn?.addEventListener('click', () => {
  const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const targetScheme = currentlyRenderedDark() ? 'light' : 'dark';
  const targetIsSystem = (targetScheme === 'dark') === systemDark;

  const apply = () => {
    if (targetIsSystem) {
      try { localStorage.removeItem('color-scheme'); } catch {}
      if (schemeMeta) schemeMeta.content = 'light dark';
    } else {
      try { localStorage.setItem('color-scheme', targetScheme); } catch {}
      if (schemeMeta) schemeMeta.content = targetScheme;
    }
  };

  if (document.startViewTransition && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    document.startViewTransition(apply);
  } else {
    apply();
  }
});

window.addEventListener('storage', (event) => {
  if (event.key === 'color-scheme' && schemeMeta) {
    schemeMeta.content = event.newValue ?? 'light dark';
  }
});

// 8. WCAG 2.2.2 Pause / Play Motion Control (no aria-pressed since label changes)
const motionBtn = document.getElementById('motion-toggle');
function syncMotionLabel() {
  if (!motionBtn) return;
  const paused = document.body.hasAttribute('data-motion-paused');
  const en = document.documentElement.lang === 'en';
  motionBtn.textContent = paused
    ? (en ? '▶ Play motion' : '▶ Анимация')
    : (en ? '⏸ Pause motion' : '⏸ Пауза');
}

motionBtn?.addEventListener('click', () => {
  document.body.toggleAttribute('data-motion-paused');
  syncMotionLabel();
});

// 9. Accessible Tabbed 84 Compose Profiles Explorer (selection follows focus + hidden="until-found")
for (const container of document.querySelectorAll('.tabs-shell')) {
  const tablist = container.querySelector('[focusgroup]');
  if (!tablist) continue;
  const tabs = Array.from(tablist.querySelectorAll(':scope > button'));
  const panels = Array.from(container.querySelectorAll('[role="tabpanel"]'));

  if (!Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
    tablist.setAttribute('role', 'tablist');
    tabs.forEach((tab, idx) => {
      tab.setAttribute('role', 'tab');
      tab.tabIndex = tab.getAttribute('aria-selected') === 'true' || idx === 0 ? 0 : -1;
    });
    tablist.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const cur = tabs.indexOf(document.activeElement);
      if (cur < 0) return;
      const next = tabs[(cur + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
    });
  }

  function selectTab(selected) {
    for (const tab of tabs) {
      const isActive = tab === selected;
      tab.setAttribute('aria-selected', String(isActive));
      tab.toggleAttribute('focusgroupstart', isActive);
      if (!Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
        tab.tabIndex = isActive ? 0 : -1;
      }
    }
    for (const panel of panels) {
      const match = panel.getAttribute('aria-labelledby') === selected.id;
      if (match) {
        panel.hidden = false;
        panel.tabIndex = 0;
      } else {
        panel.hidden = 'until-found';
        panel.removeAttribute('tabindex');
      }
    }
    try {
      selected.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
    } catch {
      selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('focus', () => selectTab(tab));
  });

  panels.forEach((panel) => {
    panel.addEventListener('beforematch', () => {
      const tab = document.getElementById(panel.getAttribute('aria-labelledby'));
      if (tab) selectTab(tab);
    });
  });
}

// 10. Bilingual RU / EN Instant Switcher with View Transitions
const langBtn = document.getElementById('lang-toggle');

function applyLanguage(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-ru][data-en]').forEach((el) => {
    el.textContent = lang === 'en' ? el.getAttribute('data-en') : el.getAttribute('data-ru');
  });
  document.querySelectorAll('[data-aria-ru][data-aria-en]').forEach((el) => {
    el.setAttribute('aria-label', lang === 'en' ? el.getAttribute('data-aria-en') : el.getAttribute('data-aria-ru'));
  });
  if (langBtn) langBtn.textContent = lang === 'en' ? 'RU' : 'EN';
  syncMotionLabel();
}

langBtn?.addEventListener('click', () => {
  const next = document.documentElement.lang === 'en' ? 'ru' : 'en';
  if (document.startViewTransition && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    document.startViewTransition(() => applyLanguage(next));
  } else {
    applyLanguage(next);
  }
});

syncMotionLabel();
