# antigravity-zh-cn

**Google Antigravity 2.0 非侵入式简体中文汉化包插件（支持软件更新后自动更新与热重载）**

- **不修改安装包，天然抗软件更新**：所有文件仅部署在 `~/.gemini/antigravity/zh-cn`，通过本地 CDP（Chrome DevTools Protocol）实时注入，Antigravity 升级时不会被覆盖。
- **Antigravity 更新后自动同步与热更新**：后台守护进程自动检测 Antigravity 版本变化，自动修复启动参数并从 GitHub 仓库拉取最新词库/插件，校验 SHA-256 哈希后自动备份并**零重启热重载**当前窗口。
- **软件内可视化管理面板**：自动嵌入 Antigravity 设置侧栏（**中文汉化**），同时支持全局快捷键 `Ctrl+Shift+L`（macOS 为 `Cmd+Shift+L`）随时唤出，支持一键检查更新、立即热更新、版本回滚、实时切换中/英文。
- **新版本未翻译词条自动采集**：Antigravity 更新引入新英文 UI 文本时自动去重采集，可直接在软件内补充译文并实时生效（永久保存在 `user/overrides.json`，更新不丢失），也可一键复制 JSON 贡献回词库。
- **零第三方依赖**：基于 Node.js `>= 22.13.0` 原生 `WebSocket`、`fetch`、`crypto` 与 `node:test`，无需 `npm install`。

---

## 快速开始

### 前置要求

- **Node.js >= 22.13.0**
- **Google Antigravity 2.0**（支持 Windows / macOS / Linux，兼容 Stable 与 Insiders 通道）

### 1. 安装插件

```bash
git clone https://github.com/fightjun/antigravity-zh-cn.git
cd antigravity-zh-cn
node install.mjs install
```

安装程序会自动完成：
1. 生成并校验 `core/manifest.json` 完整性清单，将插件部署到 `~/.gemini/antigravity/zh-cn`。
2. 非侵入式写入 `~/.antigravity/argv.json` 并为快捷方式（Windows `.lnk` / Linux `.desktop`）补充 `--remote-debugging-port=0`。
3. 注册开机自启的轻量后台守护进程（Windows 计划任务 + 隐藏 VBS / macOS LaunchAgent / Linux `systemd --user`）。

若 Antigravity 在安装前已启动且未开启调试端口，请重启一次或运行：

```bash
node install.mjs relaunch
```

### 2. 验证运行状态

```bash
node install.mjs doctor
node install.mjs verify
```

### 3. 在软件内使用与自动更新

- 在 Antigravity 的 **设置** 侧栏点击 **中文汉化**，或随时按 **`Ctrl+Shift+L`**（macOS：**`Cmd+Shift+L`**）打开管理面板。
- 开启 **「Antigravity 更新后自动更新汉化包」** 与 **「自动静默热更新」** 后：
  - 每当 Antigravity 自身更新到新版本，后台服务会自动重新校验启动参数并检查你的 GitHub 仓库是否有最新适配词库；
  - 如有更新，自动下载、校验 SHA-256、备份旧版本至 `core.prev/`，并**原地热重载当前窗口**，无需重启 Antigravity。

---

## 常用命令

| 命令 | 说明 |
| :--- | :--- |
| `node install.mjs install [--channel auto\|stable\|insiders] [--repo owner/repo] [--ref main]` | 安装插件并注册后台服务 |
| `node install.mjs update [--check]` | 手动检查或立即从 GitHub 拉取更新 |
| `node install.mjs rollback` | 回滚至上一份自动备份的 `core.prev/` 版本 |
| `node install.mjs relaunch` | 携带 `--remote-debugging-port=0` 启动 Antigravity |
| `node install.mjs doctor` | 检查 Node 环境、Antigravity 版本、CDP 与文件完整性 |
| `node install.mjs verify` | 单次注入并验证当前窗口 |
| `node install.mjs collect` | 导出自动采集的未翻译英文词条 JSON |
| `node install.mjs uninstall` | 停止后台服务、清理启动参数并恢复原始英文界面 |
| `npm run manifest` | 修改词库或核心代码后重新生成 `core/manifest.json` |
| `npm run check` / `npm test` | 语法检查与单元测试 |

---

## 如何维护与发布词库更新

当你推送到自己的 GitHub 仓库供自己或他人自动更新时，只需 3 步：

1. 编辑 `core/i18n/zh-CN.json` 或 `core/i18n/patterns.json`（可直接从软件内「未翻译词条采集」复制新增词条）。
2. 运行 `npm run manifest` 更新 `core/manifest.json`（可选在 `package.json` 提升版本号；即使不改版本号，只要 `manifest.json` 中词库哈希变化，客户端也会自动识别为「词库热更新」）。
3. 提交并推送至 GitHub `main` 分支，所有已安装用户的 Antigravity 将在下次定时检查、软件升级或点击「检查更新」时自动完成热更新。

---

## 目录结构

```text
antigravity-zh-cn/
├── install.mjs                 # 跨平台安装 / 卸载 / 更新 / 回滚 / 诊断 CLI
├── package.json                # 零依赖配置与脚本
├── .github/workflows/ci.yml    # GitHub Actions 持续集成校验
├── core/
│   ├── shared.mjs              # 公共工具与配置规范化
│   ├── manifest.json           # SHA-256 完整性与版本清单（自动更新依据）
│   ├── daemon.mjs              # 后台守护进程（CDP 注入、版本变更检测、自动更新、RPC）
│   ├── daemon/
│   │   ├── paths.mjs           # 跨平台 Antigravity 路径与版本发现
│   │   ├── cdp-bridge.mjs      # 零依赖 Node 22 原生 WebSocket CDP 桥接
│   │   └── updater.mjs         # GitHub 增量热更新、SHA-256 校验与原子回滚
│   ├── installer/              # 环境检测、启动器参数配置、系统服务注册
│   ├── i18n/
│   │   ├── zh-CN.json          # 简体中文精确词库
│   │   └── patterns.json       # 动态正则词条规则（计数、时间、配额、版本提示等）
│   ├── styles/
│   │   └── settings-panel.css  # 昼夜自适应设置面板样式
│   └── runtime/                # 注入到 Antigravity 页面的轻量前端运行时
│       ├── 00-bootstrap.js     # 热重载清理与双向 RPC 桥
│       ├── 10-i18n-engine.js   # WeakMap 原地替换引擎（不破坏 React 交互）
│       ├── 20-collector.js     # 新版本未翻译 UI 词条自动采集器
│       ├── 30-settings-ui.js   # 嵌入式设置面板与 Toast 通知
│       └── 90-init.js          # 运行时启动入口
├── user/
│   ├── config.json             # 用户偏好设置（更新时永久保留）
│   └── overrides.json          # 用户自定义词库覆盖（更新时永久保留）
└── tests/                      # node:test 单元测试
```
