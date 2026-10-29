// ANSI 转义序列解析:把 Vite / Maven / Spring 等工具输出的 SGR 颜色还原成可渲染片段。
//
// 背景:后端仍保留原始字节(颜色是终端语义的一部分),渲染层若不解析,ESC 在 HTML 中
// 不占宽度,用户只会看到残留的 `[32m` / `[39m`,形同乱码。

const ESC = 0x1b;

/** Nord 调色板:0-7 常规色,8-15 高亮色 */
const PALETTE = [
  "#3B4252",
  "#BF616A",
  "#A3BE8C",
  "#EBCB8B",
  "#81A1C1",
  "#B48EAD",
  "#88C0D0",
  "#D8DEE9",
  "#4C566A",
  "#D98A92",
  "#B7CDA5",
  "#F2DCA6",
  "#9FB8D6",
  "#C9A6C2",
  "#A3D5DF",
  "#ECEFF4",
];

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function hex2(n) {
  return n.toString(16).padStart(2, "0");
}

/** xterm-256 → #rrggbb;非法索引(小数/越界)返回 null,不让日志内容抛出异常 */
function color256(n) {
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  if (n < 16) return PALETTE[n] ?? null;
  if (n < 232) {
    const i = n - 16;
    const r = CUBE_LEVELS[Math.floor(i / 36)];
    const g = CUBE_LEVELS[Math.floor((i % 36) / 6)];
    const b = CUBE_LEVELS[i % 6];
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  if (n <= 255) {
    const v = 8 + (n - 232) * 10;
    return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
  }
  return null;
}

function newState() {
  return {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strike: false,
    inverse: false,
    hidden: false,
  };
}

function resetState(st) {
  st.fg = null;
  st.bg = null;
  st.bold = false;
  st.dim = false;
  st.italic = false;
  st.underline = false;
  st.strike = false;
  st.inverse = false;
  st.hidden = false;
}

/** 状态 → 内联样式;无样式时返回 null,便于渲染层走纯文本快路径 */
function cssOf(st) {
  let fg = st.fg;
  let bg = st.bg;
  if (st.inverse) {
    const f = fg ?? "#ECEFF4";
    fg = bg ?? "#2E3440";
    bg = f;
  }
  const css = {};
  if (fg) css.color = fg;
  if (bg) css.background = bg;
  if (st.bold) css.fontWeight = "600";
  if (st.dim) css.opacity = "0.62";
  if (st.italic) css.fontStyle = "italic";
  if (st.underline || st.strike) {
    const decos = [];
    if (st.underline) decos.push("underline");
    if (st.strike) decos.push("line-through");
    css.textDecoration = decos.join(" ");
  }
  if (st.hidden) css.visibility = "hidden";
  return Object.keys(css).length > 0 ? css : null;
}

function pushSegment(out, text, st) {
  if (!text) return;
  out.push({ text, style: cssOf(st) });
}

/** 应用一段 SGR 参数(如 "1;32" 或 "38;5;208") */
function applySgr(st, params) {
  const codes = params === "" ? [0] : params.split(";").map((p) => (p === "" ? 0 : Number(p)));
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (Number.isNaN(c)) continue;
    if (c === 0) {
      resetState(st);
    } else if (c === 1) {
      st.bold = true;
    } else if (c === 2) {
      st.dim = true;
    } else if (c === 3) {
      st.italic = true;
    } else if (c === 4) {
      st.underline = true;
    } else if (c === 7) {
      st.inverse = true;
    } else if (c === 8) {
      st.hidden = true;
    } else if (c === 9) {
      st.strike = true;
    } else if (c === 21 || c === 22) {
      st.bold = false;
      st.dim = false;
    } else if (c === 23) {
      st.italic = false;
    } else if (c === 24) {
      st.underline = false;
    } else if (c === 27) {
      st.inverse = false;
    } else if (c === 28) {
      st.hidden = false;
    } else if (c === 29) {
      st.strike = false;
    } else if (c >= 30 && c <= 37) {
      st.fg = PALETTE[c - 30];
    } else if (c === 39) {
      st.fg = null;
    } else if (c >= 40 && c <= 47) {
      st.bg = PALETTE[c - 40];
    } else if (c === 49) {
      st.bg = null;
    } else if (c >= 90 && c <= 97) {
      st.fg = PALETTE[c - 90 + 8];
    } else if (c >= 100 && c <= 107) {
      st.bg = PALETTE[c - 100 + 8];
    } else if (c === 38 || c === 48) {
      const target = c === 38 ? "fg" : "bg";
      const mode = codes[i + 1];
      if (mode === 5) {
        const n = codes[i + 2];
        st[target] = Number.isNaN(n) ? null : color256(n);
        i += 2;
      } else if (mode === 2) {
        const r = codes[i + 2];
        const g = codes[i + 3];
        const b = codes[i + 4];
        const ok = [r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255);
        st[target] = ok ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : null;
        i += 4;
      } else {
        i += 1;
      }
    }
  }
}

/**
 * 处理含 '\r' 的行:按终端语义把光标移回行首后覆盖写入,
 * 而不是丢弃整行前半段(否则 `hello world\rhi` 会变成 `hi`,纯 ANSI reset 还会吞掉正文)。
 */
function parseWithCarriageReturns(text) {
  const st = newState();
  const cells = [];
  let cursor = 0;
  let i = 0;
  let styled = false;

  const writeText = (chunk) => {
    if (!chunk) return;
    // 同一文本段样式固定,只计算一次;相邻同样式单元才能正确合并
    const style = cssOf(st);
    if (style) styled = true;
    for (const ch of chunk) {
      cells[cursor] = { ch, style };
      cursor++;
    }
  };

  let runStart = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code !== ESC && code !== 13) {
      i++;
      continue;
    }
    writeText(text.slice(runStart, i));
    if (code === 13) {
      cursor = 0;
      i++;
    } else {
      const next = text[i + 1];
      if (next === "[") {
        let j = i + 2;
        while (j < text.length) {
          const c = text.charCodeAt(j);
          if (c >= 0x40 && c <= 0x7e) break;
          j++;
        }
        if (j < text.length) {
          if (text[j] === "m") applySgr(st, text.slice(i + 2, j));
          i = j + 1;
        } else {
          i = text.length;
        }
      } else if (next === "]") {
        let j = i + 2;
        while (j < text.length) {
          if (text.charCodeAt(j) === 0x07) { j++; break; }
          if (text.charCodeAt(j) === ESC && text[j + 1] === "\\") { j += 2; break; }
          j++;
        }
        i = j;
      } else if (next === "(" || next === ")") {
        i += 3;
      } else {
        i += 2;
      }
    }
    runStart = i;
  }
  writeText(text.slice(runStart));

  const segs = [];
  let current = null;
  for (const cell of cells) {
    if (!cell) continue;
    if (current && current.style === cell.style) {
      current.text += cell.ch;
    } else {
      current = { text: cell.ch, style: cell.style };
      segs.push(current);
    }
  }
  if (segs.length === 0) segs.push({ text: "", style: null });
  const plain = segs.map((s) => s.text).join("");
  return { segs, plain, styled };
}

/**
 * 解析一行终端文本。
 * @param {string} input 原始行(可含 ANSI 序列)
 * @returns {{segs: {text: string, style: Record<string,string>|null}[], plain: string, styled: boolean}}
 */
export function parseAnsiLine(input) {
  const raw = input ?? "";
  // 绝大多数日志行不含控制序列。原生 includes 比逐字符扫描快得多,
  // 直接返回单片段并复用原字符串,省下切片与拼接(也避免 plain 复制一份文本)。
  if (raw.indexOf("\u001b") < 0 && raw.indexOf("\r") < 0) {
    return { segs: [{ text: raw, style: null }], plain: raw, styled: false };
  }
  if (raw.includes("\r")) {
    return parseWithCarriageReturns(raw);
  }
  const text = raw;
  const segs = [];
  const st = newState();
  let i = 0;
  let start = 0;

  while (i < text.length) {
    if (text.charCodeAt(i) !== ESC) {
      i++;
      continue;
    }
    pushSegment(segs, text.slice(start, i), st);
    const next = text[i + 1];
    if (next === "[") {
      // CSI:参数 0x20-0x3F,终止字节 0x40-0x7E
      let j = i + 2;
      while (j < text.length) {
        const c = text.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) break;
        j++;
      }
      if (j < text.length) {
        if (text[j] === "m") applySgr(st, text.slice(i + 2, j));
        i = j + 1;
      } else {
        i = text.length;
      }
    } else if (next === "]") {
      // OSC:直到 BEL 或 ST(ESC \)
      let j = i + 2;
      while (j < text.length) {
        if (text.charCodeAt(j) === 0x07) {
          j++;
          break;
        }
        if (text.charCodeAt(j) === ESC && text[j + 1] === "\\") {
          j += 2;
          break;
        }
        j++;
      }
      i = j;
    } else if (next === "(" || next === ")") {
      i += 3; // ESC ( B 之类的字符集选择
    } else {
      i += 2; // 其余两字节序列
    }
    start = i;
  }
  pushSegment(segs, text.slice(start), st);

  let plain = "";
  let styled = false;
  for (const seg of segs) {
    plain += seg.text;
    if (seg.style) styled = true;
  }
  return { segs, plain, styled };
}
