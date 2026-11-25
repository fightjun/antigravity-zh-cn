// 20-collector.js: Automatic untranslated English UI string collector.
// Captures new English labels/buttons/headings introduced after Antigravity updates
// while strictly filtering out code, file paths, URLs, numbers, and user chat content.
(function () {
  const UI_ROLES = new Set([
    'button',
    'menuitem',
    'tab',
    'switch',
    'checkbox',
    'radio',
    'option',
    'heading',
    'dialog',
    'navigation',
    'tooltip'
  ]);
  const UI_TAGS = new Set(['BUTTON', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'A', 'TH', 'LEGEND', 'OPTION']);

  const seenSession = new Set();
  const buffer = new Set();
  let flushTimer = null;

  function looksLikeUiEnglish(text) {
    if (!text) return false;
    const t = text.trim();
    if (t.length < 2 || t.length > 56) return false;
    // Must contain ASCII letters and no CJK characters
    if (!/[A-Za-z]{2,}/.test(t) || /[\u4e00-\u9fff]/.test(t)) return false;
    // Skip URLs, file paths, emails, flags, semver, hex, snake_case/camelCase identifiers
    if (/^(https?:\/\/|file:\/\/|\/|[A-Za-z]:\\|--?[a-z0-9]|v?\d+\.\d+)/i.test(t)) return false;
    if (/[\\{}<>|`$]|@[^\s]+\./.test(t)) return false;
    if (/^[a-z0-9_.-]+\.[a-z0-9]{1,5}$/i.test(t)) return false;
    // Skip pure symbols/numbers or single lowercase words that look like code tokens
    if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t)) return false;
    if (/^[a-z0-9_]+$/.test(t) && t.includes('_')) return false;
    return true;
  }

  function isLikelyUiChrome(el) {
    if (!el || el.nodeType !== 1) return false;
    if (UI_TAGS.has(el.tagName)) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (UI_ROLES.has(role)) return true;
    if (el.closest('nav, aside, header, [role="dialog"], [role="menu"], [role="tablist"], [role="toolbar"]')) {
      return true;
    }
    return false;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (buffer.size === 0) return;
      const items = Array.from(buffer);
      buffer.clear();
      AG_ZH.callDaemon('reportUntranslated', { items }).catch(() => {});
    }, 4000);
  }

  function consider(text, parentEl) {
    if (!AG_ZH.config.collectUntranslated) return;
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed || seenSession.has(trimmed)) return;
    if (!looksLikeUiEnglish(trimmed)) return;
    if (!isLikelyUiChrome(parentEl)) return;

    seenSession.add(trimmed);
    buffer.add(trimmed);
    scheduleFlush();
  }

  AG_ZH.collector = { consider };
  AG_ZH.addDisposer(() => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    buffer.clear();
  });
})();
