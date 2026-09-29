import { createApp } from "vue";
// 字体本地打包(Tauri 离线可用,不依赖 Google Fonts CDN)
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles/base.css";
import App from "./App.vue";

createApp(App).mount("#app");
