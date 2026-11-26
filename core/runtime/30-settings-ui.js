// 30-settings-ui.js: Embedded Settings tab + Ctrl/Cmd+Shift+L quick modal + toast notifications.
(function () {
  const STYLE_ID = 'ag-zh-cn-style';
  const MODAL_ID = 'ag-zh-cn-modal';
  const NAV_ATTR = 'data-ag-zh-nav-item';

  function mountCss() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = AG_ZH.boot.css || '';
  }

  function showToast(message, { actionLabel, onAction, duration = 6000 } = {}) {
    const toast = document.createElement('div');
    toast.className = 'ag-zh-toast';
    toast.setAttribute('data-ag-zh-ignore', 'true');

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    if (actionLabel && typeof onAction === 'function') {
      const btn = document.createElement('button');
      btn.className = 'ag-zh-btn ag-zh-btn-primary';
      btn.textContent = actionLabel;
      btn.onclick = () => {
        toast.remove();
        onAction();
      };
      toast.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ag-zh-btn';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);
    if (duration > 0) {
      setTimeout(() => toast.remove(), duration);
    }
  }

  function createPanelElement({ embedded = false, onClose } = {}) {
    const panel = document.createElement('div');
    panel.className = embedded ? 'ag-zh-panel ag-zh-embedded' : 'ag-zh-panel';
    panel.setAttribute('data-ag-zh-ignore', 'true');

    let status = AG_ZH.status || {};
    let config = { ...(status.config || AG_ZH.config) };
    let banner = null;
    let untranslatedItems = [];
    let busy = false;

    function setBanner(text, kind = 'info') {
      banner = { text, kind };
      render();
    }

    async function refreshStatus() {
      try {
        status = await AG_ZH.callDaemon('getStatus');
        config = { ...(status.config || config) };
        AG_ZH.status = status;
        AG_ZH.config = config;
        render();
      } catch (err) {
        setBanner(`获取状态失败：${err.message}`, 'error');
      }
    }

    async function savePartialConfig(patch) {
      busy = true;
      render();
      try {
        status = await AG_ZH.callDaemon('saveConfig', patch);
        config = { ...(status.config || config) };
        AG_ZH.status = status;
        AG_ZH.config = config;
        setBanner('设置已保存并实时生效', 'success');
      } catch (err) {
        setBanner(`保存失败：${err.message}`, 'error');
      } finally {
        busy = false;
        render();
      }
    }

    async function handleCheckUpdate() {
      busy = true;
      setBanner('正在检查远程汉化包更新...', 'info');
      try {
        const res = await AG_ZH.callDaemon('checkUpdate');
        if (!res.ok) {
          setBanner(res.error || '检查更新失败', 'error');
        } else if (res.hasUpdates) {
          const scope = res.dictionaryOnly ? '词库热更新' : '完整插件更新';
          setBanner(
            `发现可用更新（${scope}）：v${res.localVersion} → v${res.remoteVersion}（变更 ${res.changed.length + res.added.length} 个文件）`,
            'info'
          );
          status.lastUpdateResult = res;
        } else {
          setBanner(`当前已是最新版本（v${res.localVersion}）`, 'success');
        }
      } catch (err) {
        setBanner(`检查更新失败：${err.message}`, 'error');
      } finally {
        busy = false;
        render();
      }
    }

    async function handleApplyUpdate() {
      busy = true;
      setBanner('正在下载、校验 SHA-256 并热更新...', 'info');
      try {
        const res = await AG_ZH.callDaemon('applyUpdate', {}, 60000);
        if (res?.update?.updated) {
          status = res.status || status;
          setBanner(
            `更新成功：v${res.update.fromVersion} → v${res.update.toVersion}，已自动热重载！`,
            'success'
          );
        } else {
          setBanner(res?.update?.message || '当前无需更新', 'success');
        }
      } catch (err) {
        setBanner(`更新失败：${err.message}`, 'error');
      } finally {
        busy = false;
        render();
      }
    }

    async function handleRollback() {
      busy = true;
      setBanner('正在回滚至上一版本...', 'info');
      try {
        const res = await AG_ZH.callDaemon('rollback');
        status = res.status || status;
        setBanner(`已回滚至 v${res.rollback.restoredVersion} 并热重载`, 'success');
      } catch (err) {
        setBanner(`回滚失败：${err.message}`, 'error');
      } finally {
        busy = false;
        render();
      }
    }

    async function loadUntranslated() {
      try {
        const res = await AG_ZH.callDaemon('getUntranslated');
        untranslatedItems = res?.items || [];
        render();
      } catch (err) {
        setBanner(`读取未翻译词条失败：${err.message}`, 'error');
      }
    }

    function render() {
      panel.innerHTML = '';

      // Header
      const header = document.createElement('div');
      header.className = 'ag-zh-header';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'ag-zh-title-group';
      const h2 = document.createElement('h2');
      h2.textContent = 'Antigravity 中文汉化包';
      const sub = document.createElement('div');
      sub.className = 'ag-zh-subtitle';
      sub.textContent = `插件 v${status.pluginVersion || '1.0.0'} · Antigravity ${status.antigravityVersion || '未知版本'} · 快捷键 Ctrl/Cmd+Shift+L`;
      titleGroup.append(h2, sub);

      const headerActions = document.createElement('div');
      headerActions.className = 'ag-zh-header-actions';

      const reloadBtn = document.createElement('button');
      reloadBtn.className = 'ag-zh-btn';
      reloadBtn.textContent = '↻ 热重载';
      reloadBtn.disabled = busy;
      reloadBtn.onclick = async () => {
        busy = true;
        render();
        try {
          await AG_ZH.callDaemon('reloadRuntime');
          setBanner('已重新注入并刷新当前窗口', 'success');
        } catch (err) {
          setBanner(`热重载失败：${err.message}`, 'error');
        } finally {
          busy = false;
          render();
        }
      };
      headerActions.appendChild(reloadBtn);

      if (!embedded && onClose) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ag-zh-btn';
        closeBtn.textContent = '关闭';
        closeBtn.onclick = onClose;
        headerActions.appendChild(closeBtn);
      }

      header.append(titleGroup, headerActions);
      panel.appendChild(header);

      // Stats grid
      const statsGrid = document.createElement('div');
      statsGrid.className = 'ag-zh-stats-grid';
      const statDefs = [
        ['精确词条', status.exactCount ?? 0],
        ['动态规则', status.patternCount ?? 0],
        ['自定义覆盖', status.overrideCount ?? 0],
        ['待补全词条', status.untranslatedCount ?? 0]
      ];
      for (const [label, val] of statDefs) {
        const box = document.createElement('div');
        box.className = 'ag-zh-stat-box';
        box.innerHTML = `<div class="ag-zh-stat-val">${val}</div><div class="ag-zh-stat-key">${label}</div>`;
        statsGrid.appendChild(box);
      }
      panel.appendChild(statsGrid);

      // Card 1: General Toggles
      const cardGeneral = document.createElement('div');
      cardGeneral.className = 'ag-zh-card';
      cardGeneral.innerHTML = '<div class="ag-zh-card-title">基础汉化设置</div>';

      const toggleRows = [
        ['enabled', '启用中文界面', '实时原地替换界面文本，关闭后立即恢复原始英文，无需重启'],
        ['translatePlaceholders', '翻译输入框占位符', '自动汉化搜索框与对话输入框的 placeholder 提示'],
        ['translateTooltips', '翻译悬浮提示 (Tooltip)', '自动汉化按钮的 title 与 aria-label 提示'],
        ['collectUntranslated', '自动采集新版本未翻译词条', 'Antigravity 更新后自动记录新增的英文界面词条以便补全']
      ];

      for (const [key, label, desc] of toggleRows) {
        const row = document.createElement('div');
        row.className = 'ag-zh-row';
        const left = document.createElement('div');
        left.className = 'ag-zh-row-label';
        left.innerHTML = `<span>${label}</span><span class="ag-zh-row-desc">${desc}</span>`;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(config[key]);
        checkbox.disabled = busy;
        checkbox.onchange = () => savePartialConfig({ [key]: checkbox.checked });
        row.append(left, checkbox);
        cardGeneral.appendChild(row);
      }
      panel.appendChild(cardGeneral);

      // Card 2: Auto-Update & Post-Upgrade Sync
      const cardUpdate = document.createElement('div');
      cardUpdate.className = 'ag-zh-card';
      cardUpdate.innerHTML = '<div class="ag-zh-card-title">自动更新与版本同步</div>';

      const autoUpgradeRow = document.createElement('div');
      autoUpgradeRow.className = 'ag-zh-row';
      autoUpgradeRow.innerHTML =
        '<div class="ag-zh-row-label"><span>Antigravity 更新后自动更新汉化包</span><span class="ag-zh-row-desc">检测到软件版本升级时，自动修复启动参数并拉取最新适配词库</span></div>';
      const autoUpgradeChk = document.createElement('input');
      autoUpgradeChk.type = 'checkbox';
      autoUpgradeChk.checked = Boolean(config.autoUpdateOnAppUpgrade);
      autoUpgradeChk.disabled = busy;
      autoUpgradeChk.onchange = () => savePartialConfig({ autoUpdateOnAppUpgrade: autoUpgradeChk.checked });
      autoUpgradeRow.appendChild(autoUpgradeChk);
      cardUpdate.appendChild(autoUpgradeRow);

      const autoPeriodicRow = document.createElement('div');
      autoPeriodicRow.className = 'ag-zh-row';
      autoPeriodicRow.innerHTML =
        '<div class="ag-zh-row-label"><span>后台定时自动更新</span><span class="ag-zh-row-desc">定期从 GitHub 仓库检查词库与核心更新并热重载</span></div>';
      const modeSelect = document.createElement('select');
      modeSelect.className = 'ag-zh-select';
      modeSelect.disabled = busy;
      [
        ['auto', '自动静默热更新'],
        ['notify', '发现更新时提示'],
        ['manual', '仅手动检查']
      ].forEach(([val, text]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = text;
        if ((config.updateMode || 'auto') === val) opt.selected = true;
        modeSelect.appendChild(opt);
      });
      modeSelect.onchange = () =>
        savePartialConfig({
          updateMode: modeSelect.value,
          autoUpdate: modeSelect.value !== 'manual'
        });
      autoPeriodicRow.appendChild(modeSelect);
      cardUpdate.appendChild(autoPeriodicRow);

      // Repo & Ref inputs
      const repoRow = document.createElement('div');
      repoRow.className = 'ag-zh-row';
      repoRow.innerHTML =
        '<div class="ag-zh-row-label"><span>更新源仓库 (GitHub)</span><span class="ag-zh-row-desc">格式：owner/repo（分支默认 main）</span></div>';
      const repoInputs = document.createElement('div');
      repoInputs.style.display = 'flex';
      repoInputs.style.gap = '6px';
      const repoInput = document.createElement('input');
      repoInput.className = 'ag-zh-input';
      repoInput.style.width = '185px';
      repoInput.value = config.updateRepo || '';
      repoInput.placeholder = 'owner/antigravity-zh-cn';
      const refInput = document.createElement('input');
      refInput.className = 'ag-zh-input';
      refInput.style.width = '72px';
      refInput.value = config.updateRef || 'main';
      refInput.placeholder = 'main';
      const saveRepoBtn = document.createElement('button');
      saveRepoBtn.className = 'ag-zh-btn';
      saveRepoBtn.textContent = '保存';
      saveRepoBtn.disabled = busy;
      saveRepoBtn.onclick = () =>
        savePartialConfig({
          updateRepo: repoInput.value.trim(),
          updateRef: refInput.value.trim() || 'main'
        });
      repoInputs.append(repoInput, refInput, saveRepoBtn);
      repoRow.appendChild(repoInputs);
      cardUpdate.appendChild(repoRow);

      // Action buttons
      const actionRow = document.createElement('div');
      actionRow.className = 'ag-zh-row';
      actionRow.style.justifyContent = 'flex-start';

      const checkBtn = document.createElement('button');
      checkBtn.className = 'ag-zh-btn';
      checkBtn.textContent = '检查更新';
      checkBtn.disabled = busy;
      checkBtn.onclick = handleCheckUpdate;

      const applyBtn = document.createElement('button');
      applyBtn.className = 'ag-zh-btn ag-zh-btn-primary';
      applyBtn.textContent = '立即热更新';
      applyBtn.disabled = busy;
      applyBtn.onclick = handleApplyUpdate;

      actionRow.append(checkBtn, applyBtn);

      if (status.hasRollback) {
        const rbBtn = document.createElement('button');
        rbBtn.className = 'ag-zh-btn';
        rbBtn.textContent = '回滚上一版本';
        rbBtn.disabled = busy;
        rbBtn.onclick = handleRollback;
        actionRow.appendChild(rbBtn);
      }

      cardUpdate.appendChild(actionRow);

      if (banner) {
        const b = document.createElement('div');
        b.className = `ag-zh-status-banner ${banner.kind}`;
        b.textContent = banner.text;
        cardUpdate.appendChild(b);
      }
      panel.appendChild(cardUpdate);

      // Card 3: Untranslated Strings Collector
      const cardCollector = document.createElement('div');
      cardCollector.className = 'ag-zh-card';
      const collectorHeader = document.createElement('div');
      collectorHeader.className = 'ag-zh-card-title';
      collectorHeader.innerHTML = '<span>新版本未翻译词条采集</span>';

      const collectorBtns = document.createElement('div');
      collectorBtns.style.display = 'flex';
      collectorBtns.style.gap = '6px';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'ag-zh-btn';
      loadBtn.textContent = '加载列表';
      loadBtn.onclick = loadUntranslated;

      const copyJsonBtn = document.createElement('button');
      copyJsonBtn.className = 'ag-zh-btn';
      copyJsonBtn.textContent = '复制为 JSON';
      copyJsonBtn.onclick = async () => {
        if (!untranslatedItems.length) await loadUntranslated();
        const obj = {};
        for (const it of untranslatedItems) obj[it.text] = '';
        try {
          await navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
          setBanner(`已复制 ${untranslatedItems.length} 条待翻译词条 JSON`, 'success');
        } catch {
          setBanner('剪贴板写入失败，请手动查看 untranslated.json', 'error');
        }
      };

      const clearBtn = document.createElement('button');
      clearBtn.className = 'ag-zh-btn';
      clearBtn.textContent = '清空';
      clearBtn.onclick = async () => {
        await AG_ZH.callDaemon('clearUntranslated');
        untranslatedItems = [];
        await refreshStatus();
      };

      collectorBtns.append(loadBtn, copyJsonBtn, clearBtn);
      collectorHeader.appendChild(collectorBtns);
      cardCollector.appendChild(collectorHeader);

      if (untranslatedItems.length > 0) {
        const list = document.createElement('div');
        list.className = 'ag-zh-untranslated-list';
        for (const item of untranslatedItems.slice(0, 40)) {
          const row = document.createElement('div');
          row.className = 'ag-zh-untranslated-item';

          const enSpan = document.createElement('span');
          enSpan.className = 'ag-zh-untranslated-en';
          enSpan.title = item.text;
          enSpan.textContent = item.text;

          const zhInput = document.createElement('input');
          zhInput.className = 'ag-zh-input';
          zhInput.style.width = '160px';
          zhInput.placeholder = '输入中文译文...';

          const addBtn = document.createElement('button');
          addBtn.className = 'ag-zh-btn ag-zh-btn-primary';
          addBtn.textContent = '生效';
          addBtn.onclick = async () => {
            const zh = zhInput.value.trim();
            if (!zh) return;
            await AG_ZH.callDaemon('addOverride', { en: item.text, zh });
            untranslatedItems = untranslatedItems.filter((x) => x.text !== item.text);
            await refreshStatus();
          };

          row.append(enSpan, zhInput, addBtn);
          list.appendChild(row);
        }
        cardCollector.appendChild(list);
      } else {
        const empty = document.createElement('div');
        empty.className = 'ag-zh-row-desc';
        empty.textContent = '点击「加载列表」查看 Antigravity 更新后自动采集到的新英文词条，可直接在软件内补充译文并立即生效。';
        cardCollector.appendChild(empty);
      }

      panel.appendChild(cardCollector);
    }

    render();
    refreshStatus();
    return panel;
  }

  function openModal() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) {
      existing.remove();
      return;
    }
    const backdrop = document.createElement('div');
    backdrop.id = MODAL_ID;
    backdrop.className = 'ag-zh-modal-backdrop';
    backdrop.setAttribute('data-ag-zh-ignore', 'true');
    backdrop.onclick = (e) => {
      if (e.target === backdrop) backdrop.remove();
    };

    const panel = createPanelElement({
      embedded: false,
      onClose: () => backdrop.remove()
    });
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }

  // Inject a native "中文汉化" button into Antigravity's main left sidebar (next to Settings)
  // AND inside the Settings view when opened.
  function tryInjectSettingsSidebarEntry() {
    const candidates = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="menuitem"]'));

    // 1. Main left sidebar: place right next to "Settings" / "设置"
    const settingsBtn = candidates.find((el) => {
      if (el.hasAttribute(NAV_ATTR) || el.closest('.ag-zh-panel')) return false;
      const t = (el.innerText || el.textContent || '').trim();
      return /^(Settings|设置)$/.test(t);
    });

    if (settingsBtn && settingsBtn.parentElement && !settingsBtn.parentElement.querySelector(`[${NAV_ATTR}="sidebar"]`)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = settingsBtn.className;
      item.setAttribute(NAV_ATTR, 'sidebar');
      item.setAttribute('data-ag-zh-ignore', 'true');
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '8px';
      item.style.cursor = 'pointer';
      item.innerHTML = '<span style="font-size:13px;line-height:1;">译</span><span>中文汉化</span>';
      item.title = 'Antigravity 中文汉化与自动更新设置 (Ctrl/Cmd+Shift+L)';
      item.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      };
      settingsBtn.parentElement.insertBefore(item, settingsBtn.nextSibling);
    }

    // 2. Inside Settings dialog/page: place next to Appearance / App Settings / Built-in Browser
    const anchor = candidates.find((el) => {
      if (el.hasAttribute(NAV_ATTR) || el.closest('.ag-zh-panel')) return false;
      const t = (el.innerText || el.textContent || '').trim();
      return /^(Appearance|外观|App Settings|应用设置|Built-in Browser|内置浏览器)$/.test(t);
    });

    if (anchor && anchor.parentElement && !anchor.parentElement.querySelector(`[${NAV_ATTR}="settings"]`)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = anchor.className;
      item.setAttribute(NAV_ATTR, 'settings');
      item.setAttribute('data-ag-zh-ignore', 'true');
      item.textContent = '中文汉化';
      item.title = 'Antigravity 中文汉化与自动更新设置 (Ctrl/Cmd+Shift+L)';
      item.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      };
      anchor.parentElement.insertBefore(item, anchor.nextSibling);
    }
  }

  function handleKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      openModal();
    }
  }

  let navObserver = null;

  function startUi() {
    mountCss();
    document.addEventListener('keydown', handleKeydown, true);
    tryInjectSettingsSidebarEntry();

    navObserver = new MutationObserver(() => {
      tryInjectSettingsSidebarEntry();
    });
    navObserver.observe(document.body, { subtree: true, childList: true });

    const offEvent = AG_ZH.onDaemonEvent((event, payload) => {
      if (event === 'auto-updated' && payload?.toVersion) {
        showToast(`中文汉化包已自动热更新至 v${payload.toVersion}`, {
          actionLabel: '查看设置',
          onAction: openModal
        });
      } else if (event === 'update-available' && payload?.remoteVersion) {
        showToast(`发现汉化包新版本 v${payload.remoteVersion}`, {
          actionLabel: '立即更新',
          onAction: openModal,
          duration: 12000
        });
      }
    });

    AG_ZH.addDisposer(() => {
      document.removeEventListener('keydown', handleKeydown, true);
      if (navObserver) {
        navObserver.disconnect();
        navObserver = null;
      }
      offEvent();
      const modal = document.getElementById(MODAL_ID);
      if (modal) modal.remove();
      document.querySelectorAll(`[${NAV_ATTR}]`).forEach((el) => el.remove());
    });
  }

  AG_ZH.ui = {
    start: startUi,
    openModal,
    showToast
  };
})();
