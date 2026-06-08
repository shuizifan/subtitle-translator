# Subtitle Translator

上传字幕 → 调用 AI 大模型翻译 → 生成双语字幕 → 按媒体服务器规范命名导出。

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fshuizifan%2Fsubtitle-translator"><img src="https://img.shields.io/badge/Deploy%20to%20Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Deploy to Vercel" /></a>
  <a href="https://app.netlify.com/start/deploy?repository=https://github.com/shuizifan/subtitle-translator"><img src="https://img.shields.io/badge/Deploy%20to%20Netlify-00C7B7?style=for-the-badge&logo=netlify&logoColor=white" alt="Deploy to Netlify" /></a>
  <a href="https://railway.com/new/template?template=https://github.com/shuizifan/subtitle-translator"><img src="https://img.shields.io/badge/Deploy%20to%20Railway-0B0D0E?style=for-the-badge&logo=railway&logoColor=white" alt="Deploy to Railway" /></a>
  <a href="https://zeabur.com/new?template=subtitle-translator&username=shuizifan"><img src="https://img.shields.io/badge/Deploy%20to%20Zeabur-6C47FF?style=for-the-badge&logo=zeabur&logoColor=white" alt="Deploy to Zeabur" /></a>
</p>

## 功能特性

- **多格式支持**：SRT 与 ASS/SSA 双格式，ASS 无损保留原有样式
- **多服务商支持**：兼容 OpenAI、DeepSeek、Moonshot、智谱、Ollama 等所有 OpenAI 兼容接口
- **双语布局**：双轨（同时间轴）/ 单轨（同条双行）/ 仅译文，语言顺序可调
- **双语配色**：译文白色、原文彩色，支持颜色一键调换
- **ASS 字号编辑**：译文大、原文小，跨设备显示一致；可选保留源样式或强制统一
- **行对齐保障**：带 ID 的结构化 JSON I/O + 条数校验 + 缺失项单独重试，杜绝时间轴错位
- **编码自动探测**：支持 GBK、Big5、Shift-JIS、UTF-16 等非 UTF-8 字幕，置信度低时提示手动选择
- **标签保护**：翻译前抽离 `<i>`、`<font>`、`{\an8}` 等格式标签，译完精准回填
- **断点续传**：中断或失败后保留已完成译文，可从未完成处继续
- **整页拖拽上传**：拖入文件即可上传，替换已有文件时弹窗确认
- **媒体服务器命名**：导出文件名符合 Plex / Jellyfin / Emby 字幕语言识别规范
- **链接分享配置**：通过 URL 参数一键导入 API 配置，方便分享给他人
- **深浅主题**：跟随系统 / 浅色 / 深色三态切换，偏好持久化

当前支持格式：**SRT**、**ASS / SSA**。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15（App Router）+ TypeScript |
| UI | React 18 + Tailwind CSS + Zustand |
| 上传 | react-dropzone |
| 编码探测 | jschardet + iconv-lite |
| 并发控制 | p-limit |
| 测试 | Vitest |

架构：`上传 → Parser（SRT / ASS）→ SubtitleDocument（时间统一毫秒）→ Translator → Serializer（双语 + 样式）→ 导出`

`src/core/` 为纯逻辑层，不依赖 React / 浏览器，可直接用 Vitest 覆盖测试。

## 本地开发

**环境要求**：Node.js ≥ 18、npm

```bash
npm install
npm run dev       # 开发服务器 http://localhost:3000
npm test          # 运行单测（SRT/ASS 解析往返、行对齐、编码、命名等）
npm run build     # 生产构建
```

API 配置（Base URL / API Key / 模型名）在页面设置中填写，仅存浏览器 localStorage，不写入源码。

## 部署

> 本项目带有服务端转发路由，需要能运行 Node.js 的平台，不能用纯静态托管。所有平台均无需配置环境变量。

### 一键托管（免费）

| 平台 | 免费额度 | 特点 |
|---|---|---|
| **Vercel** | 充足 | Next.js 官方平台，零配置，推荐首选 |
| **Netlify** | 充足 | 稳定，国内访问一般 |
| **Railway** | $5/月额度 | 常驻 Node 服务，无冷启动 |
| **Zeabur** | 有免费额度 | 对国内访问较友好 |

点击上方对应按钮，连接 GitHub 仓库后直接部署即可。

### 宝塔面板（自托管）

```bash
# 1. 在项目目录构建
npm install && npm run build

# 2. 宝塔「Node 项目」中启动命令填写：
npm start          # 默认监听 3000 端口，PM2 托管
```

然后在宝塔「网站」中添加站点，配置反向代理指向 `127.0.0.1:3000`，开启 Let's Encrypt HTTPS。

> 公网部署强烈建议在站点设置中启用「网站密码（Basic Auth）」，防止转发接口被滥用。

更多平台细节见 [在线部署指南](docs/在线部署指南.md)。

## 链接分享 API 配置

在 URL 中附加参数，打开页面时会自动导入为新的 API 配置：

```
https://your-site.com/?apiKey=sk-xxx&baseURL=https://api.deepseek.com/v1&model=deepseek-chat&name=DeepSeek
```

| 参数 | 别名 | 说明 |
|---|---|---|
| `apiKey` | `api_key` | API 密钥 |
| `baseURL` | `base_url`、`base` | 接口地址（OpenAI 兼容） |
| `model` | — | 模型名称 |
| `name` | — | 配置名称（可选） |

导入后 URL 参数会被自动清除，API Key 不会残留在浏览器历史记录中。

## 文档

- [使用说明](docs/使用说明.md)：操作流程、本地运行、宝塔部署、FAQ
- [在线部署指南](docs/在线部署指南.md)：Vercel / Netlify / Railway / Cloudflare 等平台对比与步骤
- [站点定制说明](docs/站点定制说明.md)：修改站点标题、描述等（只需编辑 `src/config/site.ts`）
- [产品手册](docs/产品手册.md)：架构、模块职责、关键算法、扩展指南
