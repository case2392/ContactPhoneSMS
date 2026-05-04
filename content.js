(function () {
  'use strict';

  const BUTTON_CLASS = 'csms-open-sms-btn';
  const MARKED_ATTR = 'data-csms-injected';

  function digitsOnly(text) {
    return (text || '').replace(/\D/g, '');
  }

  function normalizeE164(text) {
    const d = digitsOnly(text);
    if (!d) return '';
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d.startsWith('1')) return '+' + d;
    return '+' + d;
  }

  function getPhoneText(element) {
    const href = element.getAttribute && element.getAttribute('href');
    if (href && href.startsWith('tel:')) return href.slice(4).trim();
    return (element.textContent || '').trim();
  }

  function waitFor(predicate, timeoutMs = 5000, intervalMs = 80) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        let v;
        try { v = predicate(); } catch (_) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start >= timeoutMs) return resolve(null);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  function findMessagingPanel() {
    const dialogs = document.querySelectorAll('div.oneUtilityBarPanel[role="dialog"]');
    for (const d of dialogs) {
      const titleEl = d.querySelector('h2.panelTitle, .panelTitle');
      if (titleEl && /messaging/i.test(titleEl.textContent || '')) return d;
    }
    return null;
  }

  function isPanelOpen(panel) {
    return !!panel && panel.classList.contains('slds-is-open');
  }

  function clickMessagingUtilityButton() {
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      const label = (b.textContent || '').trim();
      const title = (b.getAttribute('title') || '').trim();
      const aria = (b.getAttribute('aria-label') || '').trim();
      if (/^messaging$/i.test(label) || /^messaging$/i.test(title) || /^messaging$/i.test(aria)) {
        if (b.closest('[data-aura-class="oneUtilityBarItem"], .utilitybar, .utilityBar, .oneUtilityBar')) {
          b.click();
          return true;
        }
      }
    }
    return false;
  }

  async function openMessagingPanel() {
    let panel = findMessagingPanel();
    if (panel && isPanelOpen(panel)) return panel;

    clickMessagingUtilityButton();

    return await waitFor(() => {
      const p = findMessagingPanel();
      return p && isPanelOpen(p) ? p : null;
    }, 6000);
  }

  function setNativeInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findExistingThreadFor(panel, e164) {
    const target = digitsOnly(e164);
    if (!target) return null;
    const items = panel.querySelectorAll('li.thread-line-item');
    for (const li of items) {
      const participants = li.querySelectorAll('.participant, .participantZuid');
      if (participants.length === 1) {
        const t = participants[0].getAttribute('title') || participants[0].textContent || '';
        if (digitsOnly(t) === target) return li;
      }
    }
    return null;
  }

  function clickThread(li) {
    const inner = li.querySelector('c-slds-sms-inbox-thread, .row-container') || li;
    inner.click();
  }

  async function startNewThreadFlow(panel, e164) {
    const newThreadBtn = Array.from(panel.querySelectorAll('button')).find((b) => {
      const t = (b.getAttribute('title') || b.textContent || '').trim();
      return /^new thread$/i.test(t);
    });
    if (!newThreadBtn) return false;
    newThreadBtn.click();

    const input = await waitFor(() => {
      const inputs = panel.querySelectorAll('input[type="search"], input.slds-input');
      for (const i of inputs) {
        if (i.offsetParent !== null && !i.disabled) return i;
      }
      return null;
    }, 5000);
    if (!input) return false;

    input.focus();
    setNativeInputValue(input, digitsOnly(e164));

    const addBtn = await waitFor(() => {
      const buttons = panel.querySelectorAll('button');
      for (const b of buttons) {
        if (b.offsetParent === null || b.disabled) continue;
        const label = (b.textContent || '').trim();
        const title = (b.getAttribute('title') || '').trim();
        const aria = (b.getAttribute('aria-label') || '').trim();
        if (label === '+' || title === '+' || /^add( participant)?$/i.test(aria)) return b;
      }
      return null;
    }, 5000);
    if (addBtn) addBtn.click();

    const startBtn = await waitFor(() => {
      const buttons = panel.querySelectorAll('button');
      for (const b of buttons) {
        if (b.disabled || b.offsetParent === null) continue;
        if (/^start$/i.test((b.textContent || '').trim())) return b;
      }
      return null;
    }, 4000);
    if (startBtn) startBtn.click();

    return true;
  }

  async function openSmsFor(rawPhone, button) {
    const e164 = normalizeE164(rawPhone);
    if (!digitsOnly(e164)) return;

    if (button) button.disabled = true;
    try {
      const panel = await openMessagingPanel();
      if (!panel) {
        console.warn('[Open SMS] Messaging panel not found');
        return;
      }

      await waitFor(
        () => panel.querySelector('li.thread-line-item, c-slds-sms-inbox, .sbc-contact-search input'),
        2500
      );

      const existing = findExistingThreadFor(panel, e164);
      if (existing) {
        clickThread(existing);
        return;
      }

      await startNewThreadFlow(panel, e164);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function injectButton(target) {
    if (!target || target.hasAttribute(MARKED_ATTR)) return;
    const phoneText = getPhoneText(target);
    const digits = digitsOnly(phoneText);
    if (digits.length < 7) return;

    target.setAttribute(MARKED_ATTR, 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BUTTON_CLASS;
    btn.textContent = 'Open SMS';
    btn.title = `Open SMS for ${phoneText}`;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openSmsFor(phoneText, btn);
    });

    if (target.nextSibling) {
      target.parentNode.insertBefore(btn, target.nextSibling);
    } else {
      target.parentNode.appendChild(btn);
    }
  }

  function scan() {
    const els = document.querySelectorAll(
      'lightning-click-to-dial, lightning-formatted-phone, a[href^="tel:"]'
    );
    for (const el of els) injectButton(el);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { scan(); } catch (e) { console.error('[Open SMS] scan error', e); }
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
