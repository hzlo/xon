// 包装 tauri CLI:确保本机非标准路径的 Rust 工具链(cargo)对 npm script 可见,
// 任意终端直接 npm run tauri dev / build,不需要手动配 PATH。
//
// 注意:直接用 node 运行 @tauri-apps/cli 的 JS 入口,而不是 spawn npm.cmd ——
// 新版 Node 出于安全考虑禁止 spawnSync 直接调 .cmd(静默 EINVAL),不要改回去。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

const RUSTUP_HOME = "D:\\repo\\rust";
const CARGO_HOME = "D:\\repo\\packages\\cargo";
const CARGO_BIN = `${CARGO_HOME}\\bin`;

// 仅在本地非标准路径存在且非 CI 环境时注入环境变量
if (!process.env.CI && existsSync(RUSTUP_HOME)) {
  process.env.RUSTUP_HOME ??= RUSTUP_HOME;
  process.env.CARGO_HOME ??= CARGO_HOME;
  if (!process.env.PATH.includes(CARGO_BIN)) {
    process.env.PATH = `${CARGO_BIN};${process.env.PATH}`;
  }
}

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("@tauri-apps/cli/package.json");
const pkg = require(pkgPath);
const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.tauri;
const cliEntry = join(dirname(pkgPath), binRel);

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [cliEntry, ...args], {
  stdio: "inherit",
});
if (result.error) {
  console.error("tauri CLI 启动失败:", result.error);
}
process.exit(result.status ?? 1);
