<div align="center">

<img src="./public/app-icon.svg" alt="XON Logo" width="100" height="100" />

# XON (eXecute ON)

**专为开发者打造的现代化本地微服务与多进程编排控制台**

轻量 · 极速 · 内核级进程树治理 · 沉浸式 Nord 极客美学

[![Tauri 2](https://img.shields.io/badge/Tauri-v2.0-blue?logo=tauri&logoColor=white)](https://tauri.app/)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![Rust](https://img.shields.io/badge/Rust-1.77+-orange?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078d4?logo=windows&logoColor=white)](https://github.com/hzlo/xon)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

</div>

---

## 💡 为什么选择 XON？

在日常全栈与微服务开发中，我们经常需要同时启动前端开发服务器（`npm run dev`）、后端微服务（`java -jar` / `go run`）、Python 脚本或本地中间件。

传统做法往往是打开一堆黑漆漆的 CMD 或 PowerShell 窗口，伴随着以下令人头疼的痛点：
- ❌ **孤儿子进程残留**：点击终端关闭后，Node 或 Java 深层子进程仍在后台偷偷霸占 8080/3000 端口，只能手动打开任务管理器大海捞针。
- ❌ **管理混乱**：窗口繁多容易误关，无法按项目模块、业务线清晰分组管理。
- ❌ **编码乱码**：Windows 下 CMD 默认 GBK 编码与现代终端 UTF-8 混用，控制台中文频频乱码。
- ❌ **重复启动繁琐**：每次开机或换需求，都要逐个找到目录手动敲命令启动。

**XON 应运而生**：基于 **Tauri 2 + Rust + Vue 3** 构建，结合 Windows 内核级作业对象治理与优雅的 Nord 设计美学，让多进程开发管理丝滑高效。

---

## ✨ 核心特性

### 1. 🛡️ 内核级进程树治理（Windows Job Object）
- 采用 Windows 原生内核机制 `JobObject`（配置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）。
- 点击“停止”或退出 XON 时，通过内核接口原子级斩杀整棵作业树（无论嵌套了多少层子进程），**100% 杜绝端口被占与僵尸进程**。

### 2. 🌲 灵活的分组与项目树
- 支持无限层级分组嵌套，无论是大型单体还是复杂微服务矩阵都能条理分明。
- 直观展示每个服务的运行状态、当前执行命令与快捷操作（启动 / 停止 / 重启 / 编辑 / 复制）。

### 3. 🎯 一键启动方案（Run Scenarios）
- 类似专业 IDE 的 Run Configuration。
- 可自由勾选不同服务组合为自定义方案（如“全量本地联调”、“仅前端与网关”）。
- 顶部常驻快捷胶囊，支持一键并发执行或停止。

### 4. 📜 智能日志终端与跨编码纠错
- 内置基于 `encoding_rs` 的多字节跨块重组解码器，智能识别 UTF-8 与 GBK，彻底消除控制台中文乱码。
- 支持独立进程日志面板、快速清屏、进程持活与标准输入（stdin）实时指令下发。

### 5. 🎨 沉浸式 Nord 极客体验
- 无边框原生窗口设计，专为开发者调校的 Nord 冷灰蓝暗色主题。
- 深度 WebView2 底层加固，屏蔽原生浏览器右键、无感加速，告别“套壳网页”感。
- 支持全系统字体自动枚举，UI 字号与日志终端字号随心调节。

### 6. 🔲 系统托盘常驻
- 独占单实例保护（Single Instance）。
- 关闭窗口自动最小化到系统托盘，后台持续守护进程；任务栏与系统托盘原生图标深度适配。

---

## 🚀 快速上手

### 环境要求
- **操作系统**：Windows 10 / 11 (x64)
- **Node.js**：18.0 或更高版本
- **Rust**：1.77 或更高版本

### 本地开发

```bash
# 1. 克隆代码仓库
git clone https://github.com/hzlo/xon.git
cd xon

# 2. 安装前端依赖
npm install

# 3. 启动开发环境 (热重载)
npm run tauri dev
```

### 本地打包构建

```bash
# 生成 Windows 生产版本安装包与独立可执行文件
npm run tauri build
```
编译产物位于：
- NSIS 现代化安装包：`src-tauri/target/release/bundle/nsis/Xon_0.1.0_x64-setup.exe`
- 独立单文件运行程序：`src-tauri/target/release/xon.exe`

---

## 📦 自动化发版 (GitHub Actions)

项目已内置完整的 CI/CD 自动化发布流水线 [`.github/workflows/release.yml`](.github/workflows/release.yml)。

### 发版步骤

1. **版本号同步**：确保以下三个文件版本号一致（例如 `0.1.0`）：
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
2. **打 Tag 并推送到 GitHub**：
   ```bash
   git add .
   git commit -m "chore: release v0.1.0"
   git push origin main

   # 创建版本标签并推送
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. **自动发布**：GitHub Actions 将自动执行云端编译，并在 [Releases](https://github.com/hzlo/xon/releases) 页面自动生成：
   - 📦 `Xon_x.x.x_x64-setup.exe`（NSIS 智能安装引导）
   - 📦 `Xon_x.x.x_x64_en-US.msi`（MSI 企业级分发包）
   - 📦 `xon-portable-windows-x64.zip`（单文件解压即用绿色便携版）

---

## 🛠️ 技术栈

| 领域 | 核心技术 | 说明 |
| :--- | :--- | :--- |
| **桌面运行时** | [Tauri 2](https://tauri.app/) | 高性能、低内存占用的跨平台桌面应用引擎 |
| **后端语言** | [Rust](https://www.rust-lang.org/) | 内存安全、零成本抽象的系统级语言 |
| **Windows 治理** | `windows-rs` / `JobObject` | 原生 Win32 API 深度整合与进程树治理 |
| **前端框架** | [Vue 3](https://vuejs.org/) + [Vite](https://vitejs.dev/) | 组合式 API (Script Setup) + 极速打包工具 |
| **图标库** | [Lucide Vue Next](https://lucide.dev/) | 现代高品质矢量线性图标 |
| **状态与存储** | LocalStorage + Tauri FS | 配置自动持久化，支持完整配置导入与导出 |

---

## 📄 开源许可

本项目基于 [MIT License](./LICENSE) 开源。欢迎提交 Issue 或 Pull Request！
