# XON

把你的 X 打开。Windows 本地项目与命令管理器：按分组管理项目目录，集中启动、停止和查看常用命令，实时查看日志输出。前端 Vue 3（JavaScript），后端 Rust（Tauri 2），所有配置保存在本机。

**名字的来历**：XON / XOFF 是串口通信里的一对流控字符——XON 恢复传输，XOFF 暂停传输。启动一条命令，日志流开始滚动；停止它，数据流断掉。这对字符和应用的核心交互完全同构，而 X 继承自上一代项目 XProj。

上游项目：[XProj](https://github.com/hzlo/XProj)（C# / WPF 实现）。本项目功能对齐后将成为 XProj 的主版本，旧版转入维护。

## 开发目标

以旧版 XProj 的功能清单为对齐基线，用 Tauri 2 重写全部能力：

- **数据兼容**：`data.json` 字段结构与旧版互通，旧配置通过导入/导出即可迁移；
- **体验对齐**：旧版 README 的功能清单 = 本项目的完成定义；
- **体积换血**：安装包从自包含 .NET 的 ~150MB 量级降到 10MB 级（NSIS 自包含）；
- **UI 自由度**：界面层采用 Web 技术，摆脱 XAML 的表达成本。

## 里程碑

### M1 — 核心链路（进行中）

进程管理心脏，整个选型的验证点。

- **范围**：启动命令、流式转发 stdout/stderr 到前端、退出码、停止时回收整棵进程树。
- **验收**：页面启动 `ping -t 127.0.0.1`，日志逐秒滚动；停止后日志立停、任务管理器中进程树消失；可重复启动。
- **实现要点**：tokio 进程 + 逐行读取 + 事件推送；进程树回收 spike 阶段允许 `taskkill /T /F` 过渡，M2 起改为 Job Object。

### M2 — 最小可用版

- 项目 / 分组 CRUD，命令配置，启动 / 停止 / 重启，退出码与运行时长；
- 配置持久化（JSON，兼容旧 schema）、系统托盘、单实例唤醒、关闭行为（最小化到托盘 / 完全退出）。
- **验收**：可替代旧版完成日常主线操作；旧 `data.json` 导入即用。

### M3 — 体验对齐

深浅色主题与自定义颜色派生、界面与日志字体配置、日志搜索与筛选、导入导出、每日备份（保留 7 份）、运行方案（按场景批量启动）、环境变量刷新与项目级覆盖、快速打开目录 / 终端 / VSCode。

### M4 — 内置工具

备忘录（Markdown）、JSON 工具、翻译器、WebDAV 数据同步、WSL 管理。各工具可在设置中独立开关。

### M5 — 发布链

- GitHub Actions workflow 发版：`v*` 标签触发构建，x64 NSIS 自包含安装包发布到 GitHub Release（沿用旧版 XProj 的发版习惯）；
- Tauri updater 自动更新，更新源为 GitHub Releases；
- 发布前收口：CSP 收紧、capabilities 最小权限复查、版本号策略定稿。

## 工程约定

- 前端 Vue 3 + **JavaScript**（决策：开发者主语言为 C#，学习预算全部给 Rust，前端由 AI 生成 + 验收）；跨语言调用统一收口 `src/api.js`，每个函数用 JSDoc 注明参数与返回结构；
- Rust 侧统一 tokio 异步；所有命令结构体字段与 `api.js` 的 JSDoc 一一对应；
- 仅面向 Windows，不做跨平台与移动端；
- 不恢复旧版已移除的动态插件机制；
- 数据目录：`%LOCALAPPDATA%\xon\`（与旧版 `ProjectManagerWpf` 隔离，迁移走导入/导出）。

## 非目标

- 跨平台（macOS / Linux）、移动端；
- 动态插件系统；
- 旧版之外的新增大功能（稳定对齐后再议）。

## 开发

```powershell
npm install
npm run tauri dev
```

要求：Node 20+、Rust stable（MSVC）、VS Build Tools（C++ 负载）。Windows 10+。
