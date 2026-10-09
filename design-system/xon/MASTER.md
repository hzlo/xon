# xon 设计系统 MASTER（唯一事实源）

> 本文件是 xon 全局设计规则。做任何页面/组件前先读本文件；
> 若 `design-system/xon/pages/<页面名>.md` 存在，其规则**覆盖**本文件的对应条目。
> 配套 token 文件：`design-system/xon/tokens.css`（变量值的唯一出处，重构时整块替换 `src/styles/base.css` 的 `:root`）。
> 旧版（slate + 绿色主题）已归档为 `MASTER-slate-legacy.md`，仅作历史参考，**不再生效**。

**Project:** xon
**Version:** 2（Nord × Liquid Glass 深色主题）
**Generated:** 2026-09-30
**Stack:** Tauri 2 (WebView2) + Vue 3，仅深色主题

## 1. 定位与风格栈

视觉方向一句话：**Nord 冷灰蓝 × Apple Liquid Glass × 瑞士极简骨架——简而雅，深而不黑**。

| 层 | 风格 | 承担 |
|---|---|---|
| 骨架 | Minimalism & Swiss Style | 留白、字阶、网格、克制的装饰 |
| 材质 | Liquid Glass（Apple iOS/macOS 语言） | 对话框、浮层、顶栏的霜面玻璃 |
| 色彩 | Nord Palette（Polar Night + Frost） | 冷灰蓝四级表面、霜蓝强调、Aurora 语义色 |

核心决策（对比度已验证，勿推翻）：
- **深而不黑**：底色 `#2E3440`（nord0），拒绝 `#000000`/`#121212` 纯黑。
- **深色模式层级靠表面提亮，不靠阴影**：`nord0 → nord1 → nord2 → nord3` 即 底→卡片→凹槽→浮层。阴影只做辅助。
- **强调色从绿色换成霜蓝** `#88C0D0` 族：与整体灰蓝同色相，是「雅」的关键。Aurora 五色只表达语义状态（成功/警告/错误），禁止当装饰。
- 本应用**只有深色主题**，无 light/dark 切换。

## 2. 色彩 token

全部变量见 `tokens.css`（含基元层 `--nord-*` 与语义层），此处列核心值与已测对比度（WCAG：正文 4.5:1，大字/图形 3:1）：

| 变量 | 值 | 用途 | 对比度 |
|---|---|---|---|
| `--color-background` | `#2E3440` | 应用底 | — |
| `--color-card` | `#3B4252` | 卡片/面板 | — |
| `--color-muted` | `#434C5E` | 凹槽/hover 面 | — |
| `--color-border` | `#4C566A` | 控件实线描边 | — |
| `--color-foreground` | `#ECEFF4` | 正文 | bg 10.8 / card 8.7 |
| `--color-muted-foreground` | `rgba(216,222,233,.72)` | 次级文本 | bg 5.6 / card 4.7 ✓ |
| `--color-primary` | `#81A1C1` | 主按钮填充 | 深字 4.6 ✓ |
| `--color-on-primary` | `#2E3440` | 主按钮文字 | ↑ |
| `--color-accent` | `#88C0D0` | 选中/链接/焦点 | bg 6.2 / card 5.0 |
| `--color-success` | `#A3BE8C` | 成功 | bg 6.1 / card 4.9 ✓ |
| `--color-warning` | `#EBCB8B` | 警告 | bg 8.0 / card 6.4 ✓ |
| `--color-destructive` | `#DCAAAF` | 错误**文本** | bg 6.2 / card 5.0 ✓ |
| `--color-destructive-icon` | `#C97A82` | 错误图标/边框 | bg 3.9 / card 3.2 ✓ |
| `--input-border` | `rgba(236,239,244,.48)` | 输入框描边 | on card 3.35 ✓ |

⚠️ nord10 `#5E81AC` 和 nord11 `#BF616A` 原色对正文不达标（3.1 / 3.05），**只允许**用于图标、边框、大号粗体文本；正文一律用提亮变体（见上表）。

## 3. 玻璃材质（Liquid Glass）

**只允许用在：模态对话框、弹出菜单、应用顶栏。** 树视图、列表、日志主体禁用（WebView2 上 backdrop-filter 大面积使用会掉帧）。

```css
/* 模态对话框 */
background: var(--glass-dialog-bg);        /* rgba(59,66,82,.80) */
backdrop-filter: var(--glass-blur);        /* saturate(150%) blur(32px) */
border: 1px solid var(--glass-border);     /* 亮边勾轮廓 */
box-shadow: var(--glass-highlight), var(--shadow-lg);
border-radius: var(--radius-xl);           /* 16px */

/* 顶栏/浮层面板：同上，但 bg 用 --glass-panel-bg (.55) */
```

- 深色玻璃 = **低透明度亮雾 + 1px 亮边框**，不要用浅色模式的 `rgba(255,255,255,0.2)` 配方（会发灰发闷）。
- 降级已内置：`@supports not (backdrop-filter)` 与 `prefers-reduced-transparency: reduce` 时退回实色 `--color-card`，组件层无需处理。
- 遮罩用 `--overlay-scrim`（复合后对话框上正文 9.3:1）。

## 4. 排版与栅格

- UI 字体沿用 `--font-ui`（IBM Plex Sans）；日志/代码用 `--font-mono`（JetBrains Mono）。正文 14px、次级 12-13px、页标题 16-17px；权重 400/600 两档为主，**不用 800+ 黑体**。
- 间距保持 4/8 节奏（`--space-xs…3xl` = 2/4/8/12/16/24/32）。
- 圆角整体调大一级：控件 5/8px，卡片 12px，对话框 16px（`--radius-xl`）。

## 5. 组件规范要点

| 组件 | 规则 |
|---|---|
| 主按钮 | `--color-primary` 填充 + 深字；hover/active **提亮**（`--color-primary-hover/active`），深色模式不做「按下变暗」 |
| 次级按钮 | `--color-muted` 填充 + `--color-foreground` 文字 + `1px --color-border` |
| 危险操作 | **tinted 风格**：`--color-destructive` 文字 + `--color-destructive-soft-bg/border`；不做纯红实心填充 |
| 输入框 | `--input-bg` 凹陷底 + `--input-border` 描边；聚焦换 2px `--color-ring` |
| 树/列表行 | hover 叠 `--overlay-hover`；选中叠 `--overlay-selected`（霜蓝 16%）；行高 ≥ 32px；**不加玻璃、不加阴影** |
| 对话框 | scrim + 玻璃配方见 §3；进出动画 `--dur-slow` + `--ease`，位移 ≤ 8px，禁弹跳 |
| 日志面板 | `--font-mono`，底色 `--color-card`，时间戳/级别色取语义色文本变体 |
| 图标 | 沿用 lucide-vue-next，同层统一线性风格与 stroke-width（默认 2，16px 栅格），禁止 emoji 当图标 |
| 动效 | 颜色/透明度 `--dur-fast/normal`，位移/形变 `--dur-slow`；一律 `--ease`；`prefers-reduced-motion` 下关闭位移动画 |

## 6. 反模式（Do / Don't）

| ✅ Do | ❌ Don't |
|---|---|
| 表面用 nord 0→3 四级提亮 | 用阴影或透明度堆层级 |
| Aurora 色表达状态 | Aurora 色做按钮/高亮/渐变装饰 |
| 强调色霜蓝一族 | 绿色 `#22c55e` 等高饱和色（旧主题遗留） |
| 玻璃只给浮层 | 树/列表/日志整片 backdrop-filter |
| 文本色用提亮变体 | 直接用 `#5E81AC`/`#BF616A` 写小字 |
| 次级文本用 `--color-muted-foreground` | 用 `#4C566A`/`#434C5E` 当文本色（1.7:1） |
| `#ECEFF4` 正文 | `#FFFFFF` 纯白正文（刺眼、光晕） |
| 按压提亮 | 按压变暗（深色模式违和） |
| 一切颜色走 `--color-*` 变量 | 组件里硬编码 hex/rgba |

## 7. 旧 → 新映射表（重构时机械替换）

`src/styles/base.css` 现值 → 新值（变量名全部保留，新增变量见 tokens.css）：

| 变量 | 旧值 | 新值 | 备注 |
|---|---|---|---|
| `--color-primary` | `#1e293b` | `#81A1C1` | 语义从「深色面」变为「主操作填充」 |
| `--color-on-primary` | `#ffffff` | `#2E3440` | 白字改深字 |
| `--color-secondary` | `#334155` | `#434C5E` | |
| `--color-on-secondary` | `#ffffff` | `#ECEFF4` | |
| `--color-background` | `#0f172a` | `#2E3440` | 底色从藏青提亮为灰蓝 |
| `--color-foreground` | `#f8fafc` | `#ECEFF4` | |
| `--color-card` | `#1b2336` | `#3B4252` | |
| `--color-card-foreground` | `#f8fafc` | `#ECEFF4` | |
| `--color-muted` | `#272f42` | `#434C5E` | |
| `--color-muted-foreground` | `#94a3b8` | `rgba(216,222,233,.72)` | card 上 4.27→4.73 |
| `--color-border` | `#475569` | `#4C566A` | |
| `--color-destructive` | `#ef4444` | `#DCAAAF` | 填充语义→文本语义；危险按钮改 tinted |
| `--color-on-destructive` | `#000000` | `#2E3440` | |
| `--color-ring` | `#ffffff` | `#88C0D0` | |
| `--color-accent` | `#22c55e` | `#88C0D0` | **绿改霜蓝，全项目扫绿色硬编码** |
| `--color-accent-hover` | `#16a34a` | `#81A1C1` | |
| `--color-accent-active` | `#15803d` | `#5E81AC` | 仅图标/边框/大字 |
| `--color-accent-text` | `#4ade80` | `#88C0D0` | |
| `--color-accent-soft-bg` | `rgba(34,197,94,.14)` | `rgba(136,192,208,.12)` | |
| `--color-accent-soft-border` | `rgba(34,197,94,.35)` | `rgba(136,192,208,.35)` | |
| `--color-accent-glow` | `rgba(34,197,94,.8)` | `rgba(136,192,208,.45)` | 仅焦点环/拖拽指示 |
| `--color-accent-glow-soft` | `rgba(34,197,94,.35)` | `rgba(136,192,208,.22)` | |
| `--overlay-scrim` | `rgba(2,6,23,.65)` | `rgba(36,41,51,.62)` | |
| `--radius-sm/md/lg` | `3/5/8px` | `5/8/12px` | 新增 `--radius-xl: 16px` |
| 字体/间距/时长 | 不变 | 不变 | 新增 `--dur-slow: 300ms` |

另需全局替换组件内硬编码：绿色系 `#22c55e / #16a34a / #15803d / #4ade80 / rgba(34,197,94,*)`、藏青系 `#0f172a / #1b2336 / #272f42`、slate 系 `#334155 / #475569 / #94a3b8`。

## 8. 验收清单（重构完成后逐项检查）

- [ ] 全项目（含 `tree.css` 与组件 `<style>`）无硬编码颜色，均引用语义变量
- [ ] 无纯黑 `#000`/`#121212` 背景、无纯白 `#FFF` 正文
- [ ] 正文对比度 ≥4.5:1（已验证组合见 §2，新配色需补测）
- [ ] 绿色高饱和色零残留（grep `22c55e|16a34a|15803d|4ade80` 为 0 命中）
- [ ] 玻璃只出现在对话框/弹出菜单/顶栏；`prefers-reduced-transparency` 下为实色
- [ ] 主按钮 hover/active 为提亮，非变暗
- [ ] 树/列表行 hover、选中态使用 `--overlay-*`，无阴影无玻璃
- [ ] 图标全部 lucide、同层同 stroke-width，无 emoji
- [ ] 动效遵守 `--dur-*`/`--ease`，`prefers-reduced-motion` 下无位移动画
- [ ] 窗口最小宽度下布局不破

## 9. 层级检索用法

后续会话做特定页面时：

```
读取 design-system/xon/MASTER.md。
检查 design-system/xon/pages/<页面名>.md 是否存在，
存在则其规则优先，否则仅用 MASTER 规则。
```

页面级例外（如某页需要更高密度）写入 `pages/<页面名>.md`，不改本文件。
