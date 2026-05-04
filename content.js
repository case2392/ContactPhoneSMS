(function () {
  'use strict';

  const BUTTON_CLASS = 'csms-open-sms-btn';
  const MARKED_ATTR = 'data-csms-injected';

  function digitsOnly(text) {
    return (text || '').replace(/\D/g, '');
  }

  function realClick(el) {
    try {
      const opts = { bubbles: true, cancelable: true, composed: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
    } catch (_) {}
    try { el.click(); } catch (_) {}
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

  function isInDisallowedAncestor(el) {
    if (el.closest('.oneUtilityBarPanel')) return true;
    if (el.closest('[role="tab"], [role="tablist"], .uiTabBar, .slds-tabs_default, .tabBarItem')) return true;
    return false;
  }

  function clickMessagingUtilityButton() {
    const utilityButtons = document.querySelectorAll(
      'button.utilityBarButton, button.slds-utility-bar__action, .oneUtilityBarItem button, .slds-utility-bar__item button'
    );
    for (const b of utilityButtons) {
      if (isInDisallowedAncestor(b)) continue;
      const titleSpan = b.querySelector('.itemTitle, .slds-utility-bar__text');
      const labelText = titleSpan
        ? (titleSpan.textContent || '').trim()
        : (b.textContent || '').trim();
      if (/^messaging$/i.test(labelText)) {
        const rect = b.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        console.log('[Open SMS] clicking utility bar Messaging button', b);
        realClick(b);
        return true;
      }
    }

    const directMatches = document.querySelectorAll(
      '[title="Messaging"], [aria-label="Messaging"]'
    );
    for (const el of directMatches) {
      if (isInDisallowedAncestor(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      console.log('[Open SMS] clicking utility bar Messaging button (attr match)', el);
      realClick(el);
      return true;
    }

    console.warn('[Open SMS] no utility bar Messaging button found');
    return false;
  }

  async function openMessagingPanel() {
    let panel = findMessagingPanel();
    if (panel && isPanelOpen(panel)) {
      console.log('[Open SMS] panel already open');
      return panel;
    }

    const clicked = clickMessagingUtilityButton();
    console.log('[Open SMS] tried to click utility bar button, success=', clicked);

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

  function findExistingThreadFor(panel, digits) {
    const target = (digits || '').slice(-10);
    if (!target) return null;
    const items = panel.querySelectorAll('li.thread-line-item');
    for (const li of items) {
      const participants = li.querySelectorAll('.participant, .participantZuid');
      if (participants.length === 1) {
        const t = digitsOnly(
          participants[0].getAttribute('title') || participants[0].textContent || ''
        ).slice(-10);
        if (t === target) return li;
      }
    }
    return null;
  }

  function clickThread(li) {
    const inner = li.querySelector('c-slds-sms-inbox-thread, .row-container') || li;
    console.log('[Open SMS] clicking existing thread', li);
    realClick(inner);
  }

  function findBackButton(panel) {
    return panel.querySelector('button[title="Back"], lightning-button-icon button[title="Back"]');
  }

  async function backOutToInbox(panel) {
    let guard = 0;
    while (guard < 5) {
      const back = findBackButton(panel);
      if (!back || back.offsetParent === null || back.disabled) return;
      console.log('[Open SMS] step 0: clicking Back to return to inbox', back);
      realClick(back);
      await new Promise((r) => setTimeout(r, 200));
      guard++;
    }
  }

  async function startNewThreadFlow(panel, digits) {
    console.log('[Open SMS] startNewThreadFlow for', digits);

    await backOutToInbox(panel);

    const newThreadBtn = await waitFor(() => {
      return Array.from(panel.querySelectorAll('button')).find((b) => {
        if (b.offsetParent === null || b.disabled) return false;
        const t = (b.getAttribute('title') || b.textContent || '').trim();
        return /^new thread$/i.test(t);
      }) || null;
    }, 3000);
    if (!newThreadBtn) {
      console.warn('[Open SMS] step 1: New thread button NOT found');
      return false;
    }
    console.log('[Open SMS] step 1: clicking New thread', newThreadBtn);
    realClick(newThreadBtn);

    await new Promise((r) => setTimeout(r, 200));

    const input = await waitFor(() => {
      const inputs = panel.querySelectorAll('input');
      for (const i of inputs) {
        if (i.disabled) continue;
        if (i.offsetParent === null) continue;
        const type = (i.getAttribute('type') || '').toLowerCase();
        if (type && type !== 'search' && type !== 'text') continue;
        return i;
      }
      return null;
    }, 5000);
    if (!input) {
      console.warn('[Open SMS] step 2: participant search input NOT found. Inputs in panel:',
        Array.from(panel.querySelectorAll('input')));
      return false;
    }
    console.log('[Open SMS] step 2: found participant input', input);

    input.focus();
    setNativeInputValue(input, digits);
    console.log('[Open SMS] step 3: typed', digits, 'into input');

    await new Promise((r) => setTimeout(r, 400));

    const addBtn = await waitFor(() => {
      const direct = panel.querySelector('lightning-button-icon-stateful.add-button button, .add-button button');
      if (direct && direct.offsetParent !== null && !direct.disabled) return direct;

      const buttons = Array.from(panel.querySelectorAll('button'));
      for (const b of buttons) {
        if (b.offsetParent === null || b.disabled) continue;
        if (b.closest('.panel-header, .slds-utility-panel__header, .sms-header')) continue;
        if (b.getAttribute('aria-haspopup') === 'true') continue;
        if (b.classList.contains('slds-input__icon')) continue;
        if (b.classList.contains('start-button')) continue;
        if (b.classList.contains('slds-button_icon-border')) return b;
      }
      for (const b of buttons) {
        if (b.offsetParent === null || b.disabled) continue;
        const label = (b.textContent || '').trim();
        const title = (b.getAttribute('title') || '').trim();
        const aria = (b.getAttribute('aria-label') || '').trim();
        if (label === '+' || title === '+' || /^add(\s+participant)?$/i.test(aria) || /^add$/i.test(title)) return b;
      }
      return null;
    }, 5000);
    if (!addBtn) {
      console.warn('[Open SMS] step 4: add (+) button NOT found. Visible buttons in panel:',
        Array.from(panel.querySelectorAll('button')).filter((b) => b.offsetParent !== null));
      return false;
    }
    console.log('[Open SMS] step 4: clicking + button', addBtn);
    realClick(addBtn);

    const startBtn = await waitFor(() => {
      const buttons = panel.querySelectorAll('button');
      for (const b of buttons) {
        if (b.disabled || b.offsetParent === null) continue;
        if (b.getAttribute('aria-disabled') === 'true') continue;
        if (b.classList.contains('start-button') || /^start$/i.test((b.textContent || '').trim())) return b;
      }
      return null;
    }, 4000);
    if (!startBtn) {
      console.warn('[Open SMS] step 5: Start button NOT found or still disabled');
      return false;
    }
    console.log('[Open SMS] step 5: clicking Start', startBtn);
    realClick(startBtn);
    return true;
  }

  async function openSmsFor(rawPhone, button) {
    const digits = digitsOnly(rawPhone);
    if (!digits) return;

    if (button) button.disabled = true;
    const originalText = button ? button.textContent : null;
    if (button) button.textContent = 'Opening...';
    try {
      const panel = await openMessagingPanel();
      if (!panel) {
        console.warn('[Open SMS] Could not open Messaging utility panel. ' +
          'No element labeled "Messaging" was clickable in the utility bar.');
        return;
      }

      await waitFor(
        () => panel.querySelector('button[title="New thread"], c-slds-sms-header'),
        3000
      );

      await startNewThreadFlow(panel, digits);
    } finally {
      if (button) {
        button.disabled = false;
        if (originalText !== null) button.textContent = originalText;
      }
    }
  }

  function shouldSkipInjection(el) {
    if (el.closest(
      'records-highlights2, records-highlights-3, records-highlight-item, ' +
      'forceHighlightsPanel, oneHighlightsPanel, ' +
      '[class*="HighlightsPanel"], [class*="highlightsPanel"], [class*="highlights2"]'
    )) return true;

    if (el.closest('lightning-datatable, [role="grid"], table.slds-table')) return true;

    if (el.closest('.oneUtilityBarPanel')) return true;

    const section = el.closest('lightning-accordion-section');
    if (section) {
      const titleEl = section.querySelector('.slds-accordion__summary-content[title]');
      const title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '') : '';
      if (/\b(tcpa|dnc)\b/i.test(title)) return true;
    }

    return false;
  }

  function injectButton(target) {
    if (!target || target.hasAttribute(MARKED_ATTR)) return;
    if (shouldSkipInjection(target)) return;
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
