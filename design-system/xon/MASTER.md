# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** xon
**Generated:** 2026-09-29 14:38:36
**Category:** Developer Tool / IDE
**Design Dials:** Density 8/10 (Dense / Dashboard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E293B` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#334155` | `--color-secondary` |
| On Secondary | `#FFFFFF` | `--color-on-secondary` |
| Accent/CTA | `#22C55E` | `--color-accent` |
| On Accent/CTA | `#0F172A` | `--color-on-accent` |
| Background | `#0F172A` | `--color-background` |
| Foreground | `#F8FAFC` | `--color-foreground` |
| Card | `#1B2336` | `--color-card` |
| Card Foreground | `#F8FAFC` | `--color-card-foreground` |
| Muted | `#272F42` | `--color-muted` |
| Muted Foreground | `#94A3B8` | `--color-muted-foreground` |
| Border | `#475569` | `--color-border` |
| Destructive | `#EF4444` | `--color-destructive` |
| On Destructive | `#000000` | `--color-on-destructive` |
| Ring | `#FFFFFF` | `--color-ring` |

**Color Notes:** Code dark + run green

### Typography

- **Display / Code / Logs:** JetBrains Mono (headings, commands, log output, process IDs, metrics)
- **UI Body:** IBM Plex Sans (labels, navigation, form fields, buttons, empty states)
- **Mood:** code, developer, technical, precise, functional, terminal
- **Google Fonts:** [JetBrains Mono + IBM Plex Sans](https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap)

**CSS Import (web):**
```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
```

> **Tauri note:** XON is an offline-capable desktop app — do not rely on the Google Fonts CDN. Bundle both families locally (`@fontsource/ibm-plex-sans`, `@fontsource/jetbrains-mono` or self-hosted woff2) so the UI renders identically without network.

**Type scale (dense):** 11px (micro labels, table headers) · 12px (log lines, secondary) · 13px (body, controls — default) · 14px (section titles) · 16px (page titles). Line-height 1.6 for log output, 1.45 elsewhere.

**Font tokens:**
```css
:root {
  --font-mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
  --font-ui: 'IBM Plex Sans', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
}
```

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

All specs below are dark-theme native (Dark Mode OLED) and tuned to the density-8 scale. Surfaces are separated by **1px borders first** (shadows are nearly invisible on near-black backgrounds); elevation via shadow is reserved for overlays.

### Radius & Motion Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `3px` | Badges, checkboxes |
| `--radius-md` | `5px` | Buttons, inputs, rows |
| `--radius-lg` | `8px` | Cards, panels, modals |
| `--dur-fast` | `120ms` | Hover/press state changes |
| `--dur-normal` | `200ms` | Panels, modals, disclosure |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | All transitions |

### Buttons

```css
/* Primary action (Start / run semantics) */
.btn-primary {
  background: var(--color-accent);          /* #22C55E */
  color: var(--color-on-accent);            /* #0F172A — dark text on green, ≥4.5:1 */
  padding: 5px 12px;                        /* dense: space-sm + space-lg */
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font: 500 13px/1 var(--font-ui);
  transition: background var(--dur-fast) var(--ease), opacity var(--dur-fast) var(--ease);
  cursor: pointer;
}
.btn-primary:hover  { background: #16A34A; }   /* green-600, same hue family */
.btn-primary:active { background: #15803D; }   /* green-700 — pressed darkens, no layout shift */

/* Destructive action (Stop / kill semantics) */
.btn-danger {
  background: var(--color-destructive);     /* #EF4444 */
  color: #FFFFFF;
  padding: 5px 12px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font: 500 13px/1 var(--font-ui);
  cursor: pointer;
}
.btn-danger:hover { background: #DC2626; }     /* red-600 */

/* Secondary / quiet action */
.btn-secondary {
  background: var(--color-secondary);       /* #334155 */
  color: var(--color-foreground);           /* #F8FAFC */
  padding: 5px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  font: 500 13px/1 var(--font-ui);
  cursor: pointer;
}
.btn-secondary:hover { background: var(--color-muted); }

/* Ghost / icon button (toolbar) */
.btn-ghost {
  background: transparent;
  color: var(--color-muted-foreground);
  padding: 5px 8px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
}
.btn-ghost:hover { background: var(--color-muted); color: var(--color-foreground); }

/* Disabled: reduced emphasis, no pointer, no action */
.btn-primary:disabled, .btn-danger:disabled, .btn-secondary:disabled {
  opacity: 0.45; cursor: not-allowed; pointer-events: none;
}
```

Buttons never transform on hover (no `translateY`/`scale`) — state changes are color-only so dense rows never jitter.

### Cards / Panels

```css
.card {
  background: var(--color-card);            /* #1B2336 */
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 12px;                            /* dense, not 24px */
}
/* Static cards are NOT cursor:pointer and do not lift on hover —
   only interactive rows (below) get hover feedback. */
```

### Inputs

```css
.input, .select {
  background: var(--color-muted);           /* #272F42 — recessed vs card */
  color: var(--color-foreground);
  padding: 5px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font: 400 13px/1.4 var(--font-ui);
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.input::placeholder { color: var(--color-muted-foreground); }
.input:focus, .select:focus {
  border-color: var(--color-ring);          /* #FFFFFF — high-visibility on dark */
  outline: none;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.18);
}
.input[aria-invalid="true"] { border-color: var(--color-destructive); }
```

### Modals / Overlays

```css
.modal-overlay {
  background: rgba(2, 6, 23, 0.65);         /* slate-950 scrim, dark-native */
  backdrop-filter: blur(4px);
}
.modal {
  background: var(--color-card);            /* never white in a dark-only app */
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 16px;
  box-shadow: var(--shadow-xl);
  max-width: 520px;
}
```

### Status Badges (process state)

```css
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  font: 500 11px/1.6 var(--font-ui);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.badge-running { background: rgba(34,197,94,0.14); color: #4ADE80; border: 1px solid rgba(34,197,94,0.35); }
.badge-stopped { background: rgba(148,163,184,0.12); color: var(--color-muted-foreground); border: 1px solid rgba(148,163,184,0.3); }
.badge-error   { background: rgba(239,68,68,0.14); color: #F87171; border: 1px solid rgba(239,68,68,0.35); }
```

Pair every badge with a colored dot (8px) so state never relies on text or color alone.

### Process / Group Rows (left pane)

```css
.row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px;                         /* dense rows, 4px vertical */
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.row:hover  { background: var(--color-muted); }
.row[aria-selected="true"], .row.is-active { background: var(--color-secondary); }
.row:focus-visible { outline: 1px solid var(--color-ring); outline-offset: -1px; }
```

### Log Viewer (right pane)

```css
.log-viewer {
  background: var(--color-background);      /* darkest surface, terminal-first */
  font: 400 12px/1.6 var(--font-mono);
  padding: 8px 12px;
  user-select: text;                        /* log text must be copyable */
}
.log-line:hover { background: var(--color-muted); }  /* row tracking while scanning */
.log-ts      { color: var(--color-muted-foreground); }
.log-info    { color: var(--color-foreground); }
.log-warn    { color: #F59E0B; }            /* amber-500 */
.log-error   { color: var(--color-destructive); }
.log-debug   { color: var(--color-muted-foreground); }
```

**Auto-scroll behavior (required):** logs append/stream continuously. Auto-scroll must pause when the user scrolls up or hovers the pane, expose a visible pause/resume control (`aria-label="Pause auto-scroll"`), and respect `prefers-reduced-motion` (jump, never smooth-scroll). Render streamed output incrementally — never buffer behind a spinner.

### Scrollbars (WebView2 / Chromium)

```css
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--color-secondary); border-radius: 5px; border: 2px solid var(--color-background); }
::-webkit-scrollbar-thumb:hover { background: var(--color-border); }
::-webkit-scrollbar-track { background: transparent; }
```

---

## Style Guidelines

**Style:** Dark Mode (OLED)

**Keywords:** Dark theme, low light, high contrast, deep black, midnight blue, eye-friendly, OLED, night mode, power efficient

**Best For:** Night-mode apps, coding platforms, entertainment, eye-strain prevention, OLED devices, low-light

**Key Effects:** Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, low white emission, high readability, visible focus

### Layout Pattern

**Pattern Name:** Real-Time Monitor + Terminal *(verified match: Developer Tool / IDE → Dashboard Style)*

XON is a desktop control surface, not a marketing page — no hero/landing sections apply.

- **Shell:** fixed app chrome (titlebar + toolbar) over a two-pane workspace.
- **Left pane (monitor):** project groups → process rows. Groups are collapsible sections; rows show name, command, status badge, and inline start/stop actions. Selecting a row focuses the log pane.
- **Right pane (terminal):** real-time log viewer for the selected process — monospace, streaming, auto-scroll with pause (see Log Viewer spec). Tab bar or header shows process name + status + uptime.
- **Information density:** 4px row padding, 11–13px type, side-by-side panes; panels resizable by dragging the splitter; every pane reachable and resizable via keyboard.
- **State surfaces:** empty state per pane ("No process selected", "No output yet") using muted tokens; never a blank black void.
- **Key effects:** minimal glow (text-shadow: 0 0 10px) reserved for the running-status dot; low white emission; high readability; visible focus everywhere.

---

## Anti-Patterns (Do NOT Use)

- ❌ Light mode default
- ❌ Slow performance

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All *clickable* elements must have cursor:pointer (static cards/panes must NOT look clickable)
- ❌ **Layout-shifting hovers** — Avoid scale/translate transforms that shift layout; state changes are color-only
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio on dark surfaces
- ❌ **Instant state changes** — Always use transitions (120–200ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y
- ❌ **Light-theme leftovers** — No white modals, light borders (`#E2E8F0`), or dark-text-on-dark buttons; dark mode is the only mode
- ❌ **Auto-scroll without control** — Streaming logs must pause on user scroll-up/hover and expose a pause control
- ❌ **Spinner-buffered logs** — Stream output incrementally; never block rendering behind a loading state

---

## Vue 3 Implementation Notes (stack-verified)

> From `--stack vue` search (vue 3.5.x, verified 2026-08-13). XON targets Vue 3 + Tauri 2.

- **`v-for` always keyed** (`:key="item.id"`, never index) — required for stable process rows and log lines (Severity: High).
- **`v-memo` on log rows** (`v-for ... v-memo="[line.id]"`) — keeps re-renders off the 10k-line log buffer (Severity: Medium).
- **`shallowReactive` for flat state** — process/log entries are append-heavy flat records; avoid deep-reactivity overhead (Severity: Low).
- **`defineAsyncComponent`** for heavy dialogs (settings, command editor) (Severity: Medium).
- **Log buffering:** batch incoming Tauri events (e.g., flush to the reactive array on `requestAnimationFrame` or a 50–100ms timer) instead of one reactive push per line.

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Lucide via `lucide-vue-next`, single stroke weight)
- [ ] `cursor-pointer` on all clickable elements; static surfaces don't look clickable
- [ ] Hover/pressed states are color-only transitions (120–200ms)
- [ ] Dark mode: text contrast ≥4.5:1, non-text UI ≥3:1 (badges, borders, status dots)
- [ ] Focus states visible for keyboard navigation (focus-visible ring on rows, inputs, buttons)
- [ ] `prefers-reduced-motion` respected (log auto-scroll jumps instead of smooth-scrolling)
- [ ] Desktop window checks: usable at 1280×720 minimum, panes resize via splitter and keyboard, no horizontal overflow at any panel ratio
- [ ] Log text selectable/copyable; auto-scroll pauses on scroll-up/hover with a visible control
- [ ] Status never conveyed by color alone (badge text + dot + icon where applicable)
