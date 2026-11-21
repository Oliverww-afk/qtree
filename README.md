# 问题树 v2.1 · 公网体验版

写一句卡住的事，三问之后得到一条今晚能走的路线。答案在知乎，这里只把问题收窄。

## 直接体验

**公网 HTTPS（临时）：** https://d3oupc-ip-117-158-222-122.tunnelmole.net

这个地址由本机 `server.js` + Tunnelmole 隧道提供。电脑关机、隧道进程退出或重启后地址会失效；失效时重新跑：

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

### 1. 本机 Ollama（默认兜底）

`server.js` 默认调用本机 `http://127.0.0.1:11434` 的 `qwen2.5:7b`。当前 7B 能返回 JSON，但问题偏泛，质量闸门会把它退回“离线路线”。这不是接口没通，是模型输出不够具体。

### 2. 站点统一使用远程模型

在 `.env` 里填：

```dotenv
QTREE_API_BASE=https://api.example.com/v1
QTREE_API_KEY=sk-...
QTREE_API_MODEL=model-name
```

Key 只在服务端 `.env`，不会进入前端、页面源码或日志。服务端健康检查会变成 `provider: "remote"`。

### 3. 访问者自带 Key（BYOK）

页面右下角「模型设置」支持两种模式：

- **只存本机，直接调 API**：Key 存在浏览器 `localStorage`，不经过问题树服务器。要求目标 API 允许浏览器 CORS。
- **交给代理转发**：Key 随 `X-API-Key / X-API-Base / X-API-Model` 头发给代理，由代理临时转发、不写日志、不落盘。但 Key 会经过代理，适合信任站点或自己部署的代理。

服务端不把 Key 写入响应、日志或文件。代理只接受 HTTPS 的公开 API 地址，拒绝 localhost / 内网地址。

## 免费 HTTPS 代理

当前使用 **Tunnelmole**（免费、无需账号）：

- 已在 `.tools` 安装，并已跑通 `https://...tunnelmole.net`。
- 它是“本机 → 公网”的隧道，不是独立云函数；电脑必须开机且进程常驻。
- 地址是临时的，重启会变。

更稳的长期方案是 `worker.js`：一个 Cloudflare Worker，免费额度足够，支持 `/api/compile`、`/api/health` 和 BYOK 请求头。部署需要 Cloudflare 账号与 Workers 权限，未自动部署。

## PWA

- `manifest.webmanifest`：192 / 512 PNG 图标，`display: standalone`。
- `sw.js`：`qtree-v8`，缓存页面外壳，断网可启动。
- 公网 HTTPS 下 Chrome 可安装；`Page.getInstallabilityErrors` 只报 `in-incognito`，说明正常窗口没有 manifest / icon / SW 硬错误。

## 测试

```powershell
node tests\compiler.js
node tests\e2e.js
node tests\byok.js
node tests\public.js
node tests\installability.js
```

- `compiler.js`：5 条输入的路线、三问、来源、搜索词、今晚动作。
- `e2e.js`：浏览器全流程、复制、PNG 下载、375/768/1440、危机词拦截。
- `byok.js`：mock 直连 API，验证设置保存与“模型路线”。
- `public.js`：公网页面、manifest、Service Worker、设置弹窗。
- `installability.js`：Chrome 安装性错误。

## 还没闭环

- 第三方模型的 `QTREE_API_BASE` / `QTREE_API_MODEL` 还没填，因为还没确认这个 Key 属于哪家服务、用哪个模型。**不能凭 Key 格式猜端点，避免把 Key 发到错误服务商。**
- `worker.js` 未部署，公网地址仍是 Tunnelmole 临时隧道。
- 知乎 OAuth 未接入；PWA 当前不读知乎用户数据。
- P1 / P2 按约定未做。
