# 在线字幕翻译工具（v1）

上传字幕文件 → 调用 OpenAI 兼容大模型翻译 → 生成双语字幕 → 按媒体服务器命名规则导出下载。

v1 仅处理**字幕文件**（不处理视频、不做语音识别/转码/内嵌），格式支持 **SRT**。
ASS / VTT / LRC 解析与完整 ASS 样式为后续阶段。

> 实现依据见 [`双语翻译字幕示例/字幕翻译工具-实现规范.md`](双语翻译字幕示例/字幕翻译工具-实现规范.md)。

## 文档

- 📘 [产品手册](docs/产品手册.md)：维护交接版——架构、模块职责、关键算法、扩展指南、速查表。
- 📖 [使用说明](docs/使用说明.md)：本地运行 + 宝塔在线部署 + 逐步操作流程 + FAQ。
- 🎨 [站点定制说明](docs/站点定制说明.md)：改 logo / 标题 / 描述（只改 `src/config/site.ts`）。
- 🚀 [发布流程](docs/发布流程.md)：优化 → 发版（`npm run release`）→ 交接 的标准流程。
- ☁️ [在线部署指南](docs/在线部署指南.md)：Vercel / Netlify / Railway / Cloudflare 等一键托管对比与步骤。

## 技术栈

- **Next.js（App Router）+ TypeScript**：前端 SPA + 唯一的后端转发路由（`src/app/api/translate/route.ts`），同仓库一次部署。
- **React + Tailwind CSS**、**Zustand**（工作流状态）、**react-dropzone**（上传）。
- **jschardet + TextDecoder**（编码探测/转换）、**Vitest**（核心逻辑单测）。
- 只做 **OpenAI 兼容协议**（`/v1/chat/completions`）一种。

## 架构

```
上传 → [Parser] → SubtitleDocument（时间统一毫秒）→ [Translator] → 带译文的 Document → [Serializer 双语+样式] → 导出
```

`src/core/` 为不依赖 React/浏览器的纯逻辑（parsers / serializers / translator / bilingual / styling / naming / encoding / tags），可直接用 Vitest 测试。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 运行核心单测（解析往返、行对齐、命名、编码等）
npm run build      # 生产构建（standalone 产物）
```

API 配置（Base URL / API Key / 模型名）在页面第 3 步手填，存浏览器 localStorage，
经转发路由穿透——**不写进源码、不打进前端包**。

## 关键设计

- **行对齐**（字幕机翻头号风险）：带 ID 的结构化 JSON I/O + 条数校验 + **仅对缺失项重试**；多次失败标记「未翻译」，绝不静默错位。
- **编码探测**：字节 → jschardet 探测 → TextDecoder 解码（gbk/big5/shift_jis/utf-16…）→ 去 BOM。置信度低时提示手动选编码。
- **标签保护**：翻译前抽离 `<i>`/`<font>`/`{\an8}` 等标签、翻译纯文本、译完按位置回填。
- **客户端编排**：由浏览器循环驱动批次、逐批调 `/api/translate`、自更新进度，支持取消与断点续传；后端无状态。
- **双语布局**：双条目同时间轴（默认）/ 单条目双行 / 仅译文；语言顺序可调。

## 宝塔（Node 项目）部署

1. 宝塔新建「Node 项目」指向本仓库目录；先 `npm install && npm run build`，启动命令 `npm start`（默认 3000 端口，PM2 托管）。
2. 「网站/反向代理」把域名反代到该端口，开 SSL（Let's Encrypt 一键 HTTPS）。
3. 站点设置加**网站密码（HTTP Basic Auth）**，把整站挡在登录后。

> 公网 + 带 key + 必须 HTTPS + 网站密码。密钥仅残留在用户输入它的浏览器里；如需更彻底，可改为服务端 `.env` 存 key（见规范 §9 后续可选）。

## 版本

未发行前版本号统一为 1（见 `package.json` `"version": "1.0.0"`）。
