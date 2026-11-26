<div align="center">

# antigravity-zh-cn

**Google Antigravity 2.0 非侵入式简体中文汉化包插件（支持软件更新后自动续接与内置热更新）**

[![CI](https://github.com/fightjun/antigravity-zh-cn/actions/workflows/ci.yml/badge.svg)](https://github.com/fightjun/antigravity-zh-cn/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-v1.1.0-2B7FFF)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2022.13.0-339933)
![Platform](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-4B5563)
![License](https://img.shields.io/badge/license-MIT-10B981)

</div>

---

## 核心特性

- **不修改安装包，天然抗软件更新**：所有文件仅部署在 `~/.gemini/antigravity/zh-cn`，通过本地 CDP（Chrome DevTools Protocol）实时注入，动态识别任意 Antigravity 版本号，软件自动升级时不会被覆盖。
- **全面覆盖主界面与设置页（`519+` 精确词条 + `32` 条动态规则）**：
  - 左侧导航栏、对话画布、产物/终端/子智能体/协作群、底部状态与时间提示；
  - 完整覆盖设置界面全部模块：账户与套餐、智能体与权限、输入框与语音模式、外观与主题、通知与提示音、自定义与 Token 统计、内置浏览器、应用程序、快捷键、模型与配额、意见反馈。
- **双重自动续接，关闭重开/升级免手动操作**：
  - 安装时自动为桌面与开始菜单快捷方式（Windows `.lnk` / Linux `.desktop`）及 `argv.json` 补齐 `--remote-debugging-port=0`；
  - 后台常驻守护进程（Windows 用户级计划任务 + `HKCU\Run`，**无需管理员权限**，兼容软链接/目录联接）支持冷启动自动接力：即使软件升级覆盖了快捷方式或从自定义脚本启动，也会自动补参接力并重新注入。
- **软件内可视化管理与自动热更新**：
  - 自动在左侧主栏「设置」下方注入 **「译 中文汉化」** 入口，同时支持全局快捷键 **`Ctrl+Shift+L`**（macOS：**`Cmd+Shift+L`**）随时呼出；
  - 检测到 Antigravity 版本升级或定时检查时，自动从 GitHub 仓库拉取最新词库/插件，逐文件校验 SHA-256 哈希、自动备份至 `core.prev/`（永久保留 `user/` 个人配置），并**零重启热重载**当前窗口，支持一键回滚。
- **新版本未翻译词条自动采集**：Antigravity 更新引入新英文 UI 词条时自动过滤并去重采集，可直接在软件面板内填写中文立即生效（保存至 `user/overrides.json`），或一键复制 JSON 维护词库。
- **零第三方依赖**：纯 Node.js `>= 22.13.0` 原生 `WebSocket`、`fetch`、`crypto` 与 `node:test`，无需 `npm install`。

---

## 快速开始

### 前置要求

- **Node.js >= 22.13.0**
- **Google Antigravity 2.0**（支持 Windows / macOS / Linux，兼容 Stable 与 Insiders 通道）

### 1. AI 一键安装（推荐）

直接将下面这段提示词复制发给 **Antigravity、Claude Code、Codex 或 Cursor**，AI 会自动完成拉取、安装与环境自检：

> 请帮我安装 Google Antigravity 中文汉化插件：从 `https://github.com/fightjun/antigravity-zh-cn.git` 使用 `git clone --depth=1` 拉取仓库到本地，进入目录后依次运行 `node install.mjs install` 和 `node install.mjs doctor`，确认 `daemon.running` 与 `integrity.ok` 均为 `true`；如果 `live.reachable` 为 `false`，请提醒我关闭并重新双击桌面 Antigravity 图标以启用实时中文汉化（不要强行杀掉当前正在对话的窗口）。

### 2. 命令行手动安装

```bash
git clone --depth=1 https://github.com/fightjun/antigravity-zh-cn.git
cd antigravity-zh-cn
node install.mjs install
node install.mjs doctor
```

安装程序会自动完成：
1. 校验并部署核心文件到 `~/.gemini/antigravity/zh-cn`（保留已有的 `user/` 自定义配置与覆盖词库）。
2. 自动为快捷方式（Windows 桌面与开始菜单 `.lnk` / Linux `.desktop`）及 `~/.antigravity/argv.json` 写入 `--remote-debugging-port=0`。
3. 注册开机自启的后台常驻守护进程（Windows：用户级计划任务 + `HKCU\Run`；macOS：LaunchAgent；Linux：`systemd --user`）。

> **首次安装提示**：如果安装前 Antigravity 已经在运行且未开启调试端口，关闭后重新双击桌面图标打开（或执行 `node install.mjs relaunch`）即可立即生效。之后每次正常关闭重开或升级 Antigravity 都会自动生效，无需再手动执行任何命令。

### 3. 软件内管理与自动更新

- 点击左侧主栏 **「译 中文汉化」**，或按 **`Ctrl+Shift+L`**（macOS：**`Cmd+Shift+L`**）打开管理面板。
- 可随时实时切换中/英文界面、配置自动更新策略（自动静默热更新 / 发现更新时提示 / 仅手动）、点击 **「检查更新」 / 「立即热更新」 / 「回滚上一版本」**，以及查看并补全自动采集的新版本未翻译词条。

---

## 常用 CLI 命令

| 命令 | 说明 |
| :--- | :--- |
| `node install.mjs install [--channel auto\|stable\|insiders] [--repo owner/repo] [--ref main]` | 安装或更新本机部署，补齐快捷方式参数并启动后台常驻服务 |
| `node install.mjs doctor` | 检查 Node 环境、守护进程存活状态、Antigravity 版本、CDP 与文件完整性 |
| `node install.mjs verify` | 单次向当前窗口注入并验证 |
| `node install.mjs relaunch` | 关闭旧进程并携带 `--remote-debugging-port=0` 重启 Antigravity |
| `node install.mjs update [--check]` | 手动检查或立即从 GitHub 拉取更新 |
| `node install.mjs rollback` | 回滚至上一份自动备份的 `core.prev/` 版本 |
| `node install.mjs collect` | 导出自动采集的未翻译英文词条 JSON 模板 |
| `node install.mjs uninstall` | 停止后台服务、清理自启项与启动参数，恢复英文原版界面 |
| `node install.mjs build-manifest` | 修改词库或核心代码后重新生成 `core/manifest.json` 哈希清单 |
| `npm run check` / `npm test` | 校验全部 `.mjs` 与前端运行时脚本语法，运行单元测试 |

---

## 维护与发布词库更新

若你维护自己的仓库或向本项目补充词条，只需 3 步即可让所有已安装用户自动收到热更新：

1. 编辑 `core/i18n/zh-CN.json`（精确词条）或 `core/i18n/patterns.json`（动态正则规则）。
2. 运行 `node install.mjs build-manifest` 更新 `core/manifest.json`（并运行 `npm run check` 与 `npm test` 验证）。
3. 提交并推送至 GitHub `main` 分支，所有客户端将在下次定时检查、Antigravity 升级或点击「检查更新」时自动完成增量热更新。

---

## 常见问题

- **Q：在面板里给「未翻译词条」填了中文点「生效」，别人也会更新吗？**
  A：不会。面板内直接填写的译文保存在你本机的 `user/overrides.json`（个人覆盖词库，永久保留且优先于内置词库）。如需同步给所有用户，请将其合并到仓库的 `core/i18n/zh-CN.json`，运行 `node install.mjs build-manifest` 并推送到 GitHub。
- **Q：如何彻底恢复英文原版？**
  A：临时切换可直接在面板关闭「启用中文界面」（立即无刷新还原）；彻底卸载请运行 `node install.mjs uninstall`。
- **Q：提示 `Daemon RPC timeout` 怎么办？**
  A：运行 `node install.mjs doctor` 检查 `daemon.running` 是否为 `true`；如未运行，执行一次 `node install.mjs install` 重新拉起后台常驻守护进程即可。

---

## 目录结构

```text
antigravity-zh-cn/
├── install.mjs                 # 跨平台安装 / 卸载 / 更新 / 回滚 / 诊断 CLI
├── package.json                # 零依赖配置与脚本
├── .github/workflows/ci.yml    # GitHub Actions 持续集成（语法、单测、manifest 一致性校验）
├── core/
│   ├── shared.mjs              # 公共工具、配置规范化与 Semver 比较
│   ├── manifest.json           # SHA-256 完整性与版本清单（自动更新依据）
│   ├── daemon.mjs              # 后台守护进程（CDP 注入、冷启动接力、版本检测、自动更新、RPC）
│   ├── daemon-entry.mjs        # 独立的常驻服务启动入口（兼容软链接/目录联接）
│   ├── daemon/
│   │   ├── paths.mjs           # 跨平台 Antigravity 路径与动态版本识别
│   │   ├── cdp-bridge.mjs      # 零依赖 Node 22 原生 WebSocket CDP 桥接
│   │   └── updater.mjs         # GitHub 增量热更新、SHA-256 校验与原子回滚
│   ├── installer/              # 环境检测、快捷方式参数修补、系统常驻服务注册
│   ├── i18n/
│   │   ├── zh-CN.json          # 简体中文精确词库（519+ 条）
│   │   └── patterns.json       # 动态正则词条规则（32 条）
│   ├── styles/
│   │   └── settings-panel.css  # 昼夜自适应设置面板样式
│   └── runtime/                # 注入到 Antigravity 页面的轻量前端运行时
│       ├── 00-bootstrap.js     # 热重载清理与双向 RPC 桥
│       ├── 10-i18n-engine.js   # WeakMap 原地替换引擎（不破坏 React 交互）
│       ├── 20-collector.js     # 新版本未翻译 UI 词条自动采集器
│       ├── 30-settings-ui.js   # 侧栏入口、嵌入式管理面板与 Toast 通知
│       └── 90-init.js          # 运行时启动入口
├── user/
│   ├── config.json             # 用户偏好设置（更新时永久保留）
│   └── overrides.json          # 用户自定义词库覆盖（更新时永久保留）
└── tests/                      # node:test 单元测试
```

## License

[MIT](LICENSE)
