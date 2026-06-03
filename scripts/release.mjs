// ============================================================
//  发行版打包脚本： npm run release
//
//  作用：构建后，把「部署所需的最小文件集」复制到
//        release/字幕翻译_v<版本>_<时间戳>/ 目录，便于上传服务器或归档。
//
//  依据 Next.js standalone 产物（next.config 已开启 output:'standalone'）：
//  最小部署 = standalone 服务端 + .next/static + public，启动命令 `node server.js`。
//
//  用法：
//    npm run release            # 先构建再打包
//    npm run release -- --no-build   # 跳过构建，用现有 .next 打包
// ============================================================

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--no-build");

function log(msg) {
  console.log(`\x1b[36m[release]\x1b[0m ${msg}`);
}

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// 手写递归复制：避开 Windows 上 fs.cpSync 在大/含符号链接目录树时的崩溃（0xC0000409），
// 并对符号链接做「解引用」（复制其真实文件），保证 standalone/node_modules 完整可用。
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    let isDir = entry.isDirectory();
    let realSrc = s;
    if (entry.isSymbolicLink()) {
      try {
        realSrc = fs.realpathSync(s);
        isDir = fs.statSync(realSrc).isDirectory();
      } catch {
        continue; // 失链则跳过
      }
    }
    if (isDir) copyDir(realSrc, d);
    else fs.copyFileSync(realSrc, d);
  }
}

// 读版本号
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version || "1.0.0";

// 1) 构建
if (!skipBuild) {
  log("执行 next build ...");
  execSync("npm run build", { cwd: root, stdio: "inherit" });
} else {
  log("跳过构建（--no-build）");
}

const standalone = path.join(root, ".next", "standalone");
const staticDir = path.join(root, ".next", "static");
if (!fs.existsSync(standalone)) {
  console.error("\x1b[31m错误：未找到 .next/standalone，请先 npm run build（且 next.config 开启 output:'standalone'）。\x1b[0m");
  process.exit(1);
}

// 2) 目标目录
const name = `字幕翻译_v${version}_${ts()}`;
const outDir = path.join(root, "release", name);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
log(`打包到 release/${name}/`);

// 3) 复制 standalone（含 server.js、最小 node_modules、package.json）
copyDir(standalone, outDir);

// 4) 复制静态资源（standalone 默认不含）
copyDir(staticDir, path.join(outDir, ".next", "static"));

// 5) 复制 public（若有）
const publicDir = path.join(root, "public");
if (fs.existsSync(publicDir)) {
  copyDir(publicDir, path.join(outDir, "public"));
}

// 6) 附带文档（便于交接）
const docsOut = path.join(outDir, "docs");
fs.mkdirSync(docsOut, { recursive: true });
for (const f of ["产品手册.md", "使用说明.md", "站点定制说明.md", "发布流程.md"]) {
  const src = path.join(root, "docs", f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(docsOut, f));
}

// 7) 启动说明
const startup = `字幕翻译 v${version} —— 部署/启动说明
打包时间：${new Date().toLocaleString()}

【这是什么】
Next.js standalone 最小部署包。已含服务端、必要依赖与静态资源，无需再 npm install / npm run build。

【启动】
  node server.js
默认监听 3000 端口。可用环境变量：
  PORT=3000        端口
  HOSTNAME=0.0.0.0 监听地址（公网/反代场景常设 0.0.0.0）
示例（Linux）：
  PORT=3000 HOSTNAME=0.0.0.0 node server.js

【宝塔「Node 项目」】
  项目目录指向本文件夹；启动命令：node server.js；用 PM2 守护。
  再用「反向代理」把域名转到该端口，开 HTTPS，并设置网站密码（Basic Auth）。

【更换 logo/标题/描述】
  这些在构建时已固化。需要修改请回到源码改 src/config/site.ts 后重新 npm run release。
  详见 docs/站点定制说明.md。
`;
fs.writeFileSync(path.join(outDir, "启动说明.txt"), startup, "utf8");

log(`完成 ✅  目录：release/${name}/`);
log("部署：把该目录上传服务器，执行 `node server.js`（详见目录内 启动说明.txt）。");
