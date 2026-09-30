// 去浏览器味:抹掉 WebView2/浏览器残留的网页行为。
// 优先级:Rust 侧已通过 ICoreWebView2Settings 原生关闭右键菜单/自动填充/缩放/加速键,
// 这里只做跨端兜底(浏览器预览也生效)与 WebView2 原生开关覆盖不到的部分。
import { isTauri } from "./api.js";

export function installWebviewHardening() {
  // 1) 把文件拖进窗口:禁止 webview 导航打开文件(树内拖拽用的是自定义数据类型,不受影响)。
  //    dragDropEnabled=false 后此项必须在页面层拦住,否则拖个 .json 进来会把整个应用"导航走"。
  const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  document.addEventListener("dragover", (e) => {
    if (isFileDrag(e)) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    if (isFileDrag(e)) e.preventDefault();
  });

  // 2) 网页式文本/图片拖拽:禁掉;我们自己的树节点带 draggable="true",不受影响。
  document.addEventListener(
    "dragstart",
    (e) => {
      if (!e.target.closest?.('[draggable="true"]')) e.preventDefault();
    },
  );

  // 3) Ctrl+滚轮缩放(浏览器预览兜底;WebView2 侧已由 IsZoomControlEnabled 关闭)。
  document.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );

  // 4) 中键自动滚动指示器(桌面应用不需要)。
  document.addEventListener("auxclick", (e) => {
    if (e.button === 1) e.preventDefault();
  });

  if (isTauri) {
    // 5) 右键菜单:原生已关,兜底防漏(未来若做自定义菜单,在此拦截处替换)。
    document.addEventListener("contextmenu", (e) => e.preventDefault());

    // 6) 浏览器式快捷键兜底(发布版;原生加速键关闭后一般不会触发,双保险)。
    //    开发版刻意不拦:F5 刷新、F12 devtools 调试要用。
    if (import.meta.env.PROD) {
      document.addEventListener(
        "keydown",
        (e) => {
          const key = e.key.toLowerCase();
          if (e.key === "F5" || e.key === "F3" || e.key === "F7") {
            e.preventDefault();
            return;
          }
          if (e.ctrlKey && !e.altKey && ["r", "p", "s", "f", "g", "j", "d", "o", "u"].includes(key)) {
            e.preventDefault();
          }
        },
      );
    }
  }
}
