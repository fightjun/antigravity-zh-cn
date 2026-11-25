// 90-init.js: Runtime entrypoint.
(function () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  function boot() {
    if (AG_ZH.ui && typeof AG_ZH.ui.start === 'function') {
      AG_ZH.ui.start();
    }
    if (AG_ZH.i18n && typeof AG_ZH.i18n.start === 'function') {
      AG_ZH.i18n.start();
    }
  }

  return {
    ok: true,
    pluginVersion: AG_ZH.status?.pluginVersion || '1.0.0',
    enabled: Boolean(AG_ZH.config?.enabled)
  };
})();
