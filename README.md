# 问题树 v2.2 · P1 公网体验版

写一句卡住的事，三问之后得到一条今晚能走的路线。答案在知乎，这里只把问题收窄。

## 直接体验

**GitHub Pages（稳定入口）：** https://oliverww-afk.github.io/qtree/

**公网 HTTPS（临时后端）：** https://bvskdr-ip-117-158-222-122.tunnelmole.net

GitHub Pages 负责页面外壳；模型接口由本机 `server.js` + Tunnelmole 隧道提供。电脑关机、隧道进程退出或重启后接口会失效，页面会自动回退到离线路线；重新启动后把新的 `https://...tunnelmole.net` 写进 `config.js` 的 `endpoint`，并在末尾加 `/api/compile`。

```powershell
cd "D:\西亚斯\知乎黑客松S3\ui-design-runs\用这个UI设计去设计前端-20261120-232542-07e7\h5\pwa-v2.1"
node server.js
```

另开一个终端启动隧道：

```powershell
node "C:\Users\111\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.sessions\38455170610716930\agents\m_0cweJwKHTCN\.tools\tm-run.mjs"
```

隧道启动后把新的 `https://...tunnelmole.net` 写进 `config.js` 的 `endpoint`，并在末尾加 `/api/compile`。

## 本机启动

```powershell
cd "D:\西亚斯\知乎黑客松S3\ui-design-runs\用这个UI设计去设计前端-20261120-232542-07e7\h5\pwa-v2.1"
node server.js
```

打开 `http://127.0.0.1:8787/`。健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

## 三种模型路线

当前默认：**DeepSeek V4.1-Flash**（API 模型名 `deepseek-flash`，Base `https://api.deepseek.com/v1`）。服务端健康检查为 `provider: "remote"`。

### 1. 站点统一使用远程模型（当前已启用）

在 `.env` 里填：

```dotenv
QTREE_API_BASE=https://api.deepseek.com/v1
QTREE_API_KEY=sk-...
QTREE_API_MODEL=deepseek-flash
```

Key 只在服务端 `.env`，不会进入前端、页面源码或日志。

### 2. 本机 Ollama（无远程配置时兜底）

`server.js` 会调用本机 `http://127.0.0.1:11434` 的 `qwen2.5:7b`。7B 能返回 JSON，但问题偏泛，质量闸门会把它退回“离线路线”。这不是接口没通，是模型输出不够具体。

### 3. 访问者自带 Key（BYOK）

页面右下角「模型设置」支持两种模式：

- **只存本机，直接调 API**：Key 存在浏览器 `localStorage`，不经过问题树服务器。要求目标 API 允许浏览器 CORS。
- **交给代理转发**：Key 随 `X-API-Key / X-API-Base / X-API-Model` 头发给代理，由代理临时转发、不写日志、不落盘。但 Key 会经过代理，适合信任站点或自己部署的代理。

服务端不把 Key 写入响应、日志或文件。代理只接受 HTTPS 的公开 API 地址，拒绝 localhost / 内网地址。

## P1 已完成

- **分享**：带走页有「分享链接」和「存成图片」。分享链接把三问、搜索词和今晚动作编码进 `#card=`，打开后直接显示分享卡；不把原始输入正文放进链接。
- **七天回访**：第一次带走问题卡时，在本机 `localStorage` 记一份快照。第 7 天以后打开入口，会看到上次的三个问题，并可选「做了一点 / 还没动 / 先收起来」。
- **本地统计**：入口「本地统计」显示三问完成率、路线展开率、来源点击率、分享/图片/回访/安全出口次数。只记次数，不采集正文，不上传。
- **没问出口**：入口有「有句话我没问出口」。可以只存本机 `localStorage`，或匿名提交到 `POST /api/unsaid`；不建公开广场，服务端不记录 IP、不写日志，只把文字和时间写入 `unsaid.ndjson`。

`.env`、`unsaid.ndjson`、日志文件已被静态服务拒绝访问。匿名提交接口只在 `server.js` 可用；`worker.js` 需要绑定 `UNSAID_KV` 才能接收。

## 免费 HTTPS 代理

当前使用 **Tunnelmole**（免费、无需账号）：

- 已在 `.tools` 安装，并已跑通 `https://...tunnelmole.net`。
- 它是“本机 → 公网”的隧道，不是独立云函数；电脑必须开机且进程常驻。
- 地址是临时的，重启会变。

更稳的长期方案是 `worker.js`：一个 Cloudflare Worker，免费额度足够，支持 `/api/compile`、`/api/health` 和 BYOK 请求头。部署需要 Cloudflare 账号与 Workers 权限，未自动部署。

## PWA

- `manifest.webmanifest`：192 / 512 PNG 图标，`display: standalone`。
- `sw.js`：`qtree-v10`，缓存页面外壳，断网可启动。
- 公网 HTTPS 下 Chrome 可安装；`Page.getInstallabilityErrors` 只报 `in-incognito`，说明正常窗口没有 manifest / icon / SW 硬错误。

## 测试

```powershell
node tests\compiler.js
node tests\e2e.js
node tests\byok.js
node tests\offline.js
node tests\p1.js
node tests\real-deepseek.js
node tests\pages.js
node tests\pages-api.js
```

- `compiler.js`：5 条输入的路线、三问、来源、搜索词、今晚动作。
- `e2e.js`：浏览器全流程、复制、PNG 下载、375/768/1440、危机词拦截。
- `byok.js`：mock 直连 API，验证设置保存与“模型路线”。
- `offline.js`：`qtree-v10` 缓存与断网启动。
- `p1.js`：分享链接打开、七天回访、本地统计不泄正文、本机/匿名安全出口。
- `real-deepseek.js`：真实 DeepSeek V4.1-Flash 前端全流程，确认显示“模型路线”。
- `pages.js`：GitHub Pages 入口、manifest、Service Worker、设置弹窗。
- `pages-api.js`：从 Pages 跨域调用公网后端，确认 `provider: remote`。

## 还没闭环

- 公网地址仍是 Tunnelmole 临时隧道，电脑关机或进程退出后会变。评委演示前必须确认后端在线，或者改用已部署的 Cloudflare Worker。
- `worker.js` 未部署；匿名安全出口在 Worker 上需要绑定 `UNSAID_KV`。
- 知乎 OAuth 未接入；PWA 当前不读知乎用户数据。
- P2 按约定未做。
