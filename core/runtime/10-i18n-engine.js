// 10-i18n-engine.js: WeakMap-based in-place DOM localization engine (React-safe).
(function () {
  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'CODE',
    'PRE',
    'TEXTAREA',
    'INPUT',
    'NOSCRIPT',
    'SVG',
    'MATH',
    'CANVAS'
  ]);

  const originalTextMap = new WeakMap();
  const originalAttrMap = new WeakMap();
  const trackedTextNodes = new Set();
  const trackedAttrNodes = new Set();

  function compilePatterns(rawPatterns) {
    const compiled = [];
    if (!Array.isArray(rawPatterns)) return compiled;
    for (const item of rawPatterns) {
      if (!item || typeof item.pattern !== 'string' || typeof item.replace !== 'string') continue;
      try {
        compiled.push({
          id: item.id || '',
          regex: new RegExp(item.pattern, item.flags || ''),
          replace: item.replace
        });
      } catch {
        // Skip invalid regex pattern
      }
    }
    return compiled;
  }

  function buildExactLookup(exactObj) {
    const exact = new Map();
    const lower = new Map();
    if (!exactObj || typeof exactObj !== 'object') return { exact, lower };
    for (const [k, v] of Object.entries(exactObj)) {
      if (typeof v !== 'string') continue;
      const trimmed = k.trim();
      exact.set(trimmed, v);
      const lc = trimmed.toLowerCase();
      if (!lower.has(lc)) lower.set(lc, v);
    }
    return { exact, lower };
  }

  function isExcludedElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.closest('[data-ag-zh-ignore="true"], .ag-zh-panel, .monaco-editor, .xterm, [contenteditable="true"]')) {
      return true;
    }
    return false;
  }

  function createTranslator(dictionary) {
    const { exact, lower } = buildExactLookup(dictionary.exact);
    const patterns = compilePatterns(dictionary.patterns);

    function translateText(raw) {
      if (typeof raw !== 'string') return null;
      const match = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!match) return null;
      const [, leading, core, trailing] = match;
      if (!core) return null;

      // Exact match
      if (exact.has(core)) {
        return leading + exact.get(core) + trailing;
      }
      // Case-insensitive fallback for short UI labels
      if (core.length <= 48) {
        const lc = core.toLowerCase();
        if (lower.has(lc)) {
          return leading + lower.get(lc) + trailing;
        }
      }
      // Dynamic regex pattern match
      for (const p of patterns) {
        if (p.regex.test(core)) {
          const replaced = core.replace(p.regex, p.replace);
          if (replaced !== core) {
            return leading + replaced + trailing;
          }
        }
      }
      return null;
    }

    return { translateText, exact, patterns };
  }

  const translator = createTranslator(AG_ZH.boot.dictionary || { exact: {}, patterns: [] });
  let observer = null;
  let scheduled = false;
  const pendingRoots = new Set();

  function translateTextNode(node) {
    if (!node || node.nodeType !== 3) return;
    const parent = node.parentElement;
    if (!parent || isExcludedElement(parent)) return;

    const current = node.nodeValue || '';
    const trimmed = current.trim();
    if (!trimmed) return;

    // If React updated the text node to new English text, refresh its original source
    const prevRecord = originalTextMap.get(node);
    const sourceText =
      prevRecord && prevRecord.translated === current ? prevRecord.original : current;

    const translated = translator.translateText(sourceText);
    if (translated && translated !== current) {
      originalTextMap.set(node, { original: sourceText, translated });
      trackedTextNodes.add(node);
      node.nodeValue = translated;
    } else if (!translated && AG_ZH.collector && AG_ZH.config.collectUntranslated) {
      AG_ZH.collector.consider(sourceText, parent);
    }
  }

  function translateElementAttributes(el) {
    if (!el || el.nodeType !== 1 || isExcludedElement(el)) return;
    const attrs = [];
    if (AG_ZH.config.translatePlaceholders !== false) attrs.push('placeholder');
    if (AG_ZH.config.translateTooltips !== false) attrs.push('title', 'aria-label');

    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (!val || !val.trim()) continue;

      let record = originalAttrMap.get(el);
      const prev = record && record[attr];
      const source = prev && prev.translated === val ? prev.original : val;
      const translated = translator.translateText(source);

      if (translated && translated !== val) {
        if (!record) {
          record = {};
          originalAttrMap.set(el, record);
        }
        record[attr] = { original: source, translated };
        trackedAttrNodes.add(el);
        el.setAttribute(attr, translated);
      }
    }
  }

  function walkAndTranslate(root) {
    if (!root || !AG_ZH.config.enabled) return;
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && isExcludedElement(root)) return;

    if (root.nodeType === 1) {
      translateElementAttributes(root);
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    let current = walker.nextNode();
    while (current) {
      if (current.nodeType === 3) {
        translateTextNode(current);
      } else if (current.nodeType === 1) {
        translateElementAttributes(current);
      }
      current = walker.nextNode();
    }
  }

  function restoreOriginalDom() {
    for (const node of trackedTextNodes) {
      const rec = originalTextMap.get(node);
      if (rec && node.nodeValue === rec.translated) {
        node.nodeValue = rec.original;
      }
    }
    trackedTextNodes.clear();

    for (const el of trackedAttrNodes) {
      const rec = originalAttrMap.get(el);
      if (!rec) continue;
      for (const [attr, entry] of Object.entries(rec)) {
        if (el.getAttribute(attr) === entry.translated) {
          el.setAttribute(attr, entry.original);
        }
      }
    }
    trackedAttrNodes.clear();
  }

  function flushPending() {
    scheduled = false;
    if (!AG_ZH.config.enabled) {
      pendingRoots.clear();
      return;
    }
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const root of roots) {
      if (document.contains(root) || root === document.body) {
        walkAndTranslate(root);
      }
    }
  }

  function scheduleRoot(root) {
    pendingRoots.add(root);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flushPending);
    }
  }

  function startEngine() {
    if (!AG_ZH.config.enabled) {
      restoreOriginalDom();
      return;
    }
    walkAndTranslate(document.body);
    observer = new MutationObserver((mutations) => {
      if (!AG_ZH.config.enabled) return;
      for (const m of mutations) {
        if (m.type === 'characterData' && m.target) {
          scheduleRoot(m.target);
        } else if (m.type === 'childList') {
          for (const added of m.addedNodes) {
            scheduleRoot(added);
          }
        } else if (m.type === 'attributes' && m.target) {
          translateElementAttributes(m.target);
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label']
    });
  }

  function stopEngine() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pendingRoots.clear();
    restoreOriginalDom();
  }

  AG_ZH.i18n = {
    translator,
    start: startEngine,
    stop: stopEngine,
    rescan: () => walkAndTranslate(document.body)
  };

  AG_ZH.addDisposer(stopEngine);
})();
