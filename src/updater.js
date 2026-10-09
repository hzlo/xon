import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./api.js";

/**
 * 检查应用更新
 * @returns {Promise<import("@tauri-apps/plugin-updater").Update | null>}
 */
export async function checkUpdate() {
  if (!isTauri) {
    return null;
  }
  try {
    const update = await check();
    return update;
  } catch (err) {
    console.error("检查更新失败:", err);
    throw err;
  }
}

/**
 * 下载并安装更新，完成后自动重启
 * @param {import("@tauri-apps/plugin-updater").Update} update
 * @param {(progress: { state: string, downloaded?: number, contentLength?: number, percent?: number }) => void} [onProgress]
 */
export async function installUpdate(update, onProgress) {
  if (!update) return;
  let downloaded = 0;
  let contentLength = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        onProgress?.({ state: "started", contentLength, percent: 0 });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        const percent = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0;
        onProgress?.({ state: "progress", downloaded, contentLength, percent });
        break;
      case "Finished":
        onProgress?.({ state: "finished", percent: 100 });
        break;
    }
  });

  // 触发重启应用以生效新版本
  await relaunch();
}
