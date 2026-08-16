# dsh-highlighter — DeepSeek Harness 高亮标注插件

在 DeepSeek Harness 页面内为对话文本提供高亮标注：选中即高亮、8 种经典颜色、
写想法、打标签、一键复制/删除，并在界面**右侧生成彩色圆标**用于快速定位。
圆标与每次标注绑定：颜色与高亮一致，位置与上下文一致（上方的标注圆标在上、
下方的在下，并随内容高度按比例映射）。

## 功能

| 操作 | 说明 |
|---|---|
| 选中文字 | 弹出工具栏：3 个快捷色（红/黄/蓝）+ 调色板（8 色）+ 标签 + 复制 |
| 点击已高亮文字 | 管理工具栏：换色 / 写想法 / 打标签 / 复制 / 删除 |
| 悬停已高亮文字 | 显示该高亮的想法与标签 |
| 右侧圆标条 | 每条高亮一个圆标，按文档上下文位置从上到下排列；点击圆标平滑滚动定位并闪烁高亮 |
| 持久化 | 记录保存在页面 localStorage（键 `dshhl_highlights`），刷新不丢失 |

8 种经典颜色：红 `#F6A6A6`、橙 `#FFCC80`、黄 `#FFF176`、绿 `#B9F6CA`、
青 `#69F0D8`、蓝 `#A8D8FF`、紫 `#D3B0FF`、粉 `#FFB3DE`。

## 安装

### 方式一：从 GitHub 克隆（推荐）

```powershell
git clone <仓库地址> dsh-highlighter
cd dsh-highlighter
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

### 方式二：直接使用本项目目录

```powershell
# 在项目目录（本目录）执行
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

安装脚本会：
1. 把插件包部署到 `$DSH_HOME\profiles\node_modules\dsh-highlighter`（默认 `~\.dsh\...`）；
2. 在 `$DSH_HOME\profiles\web\cordis.patch.yml` 追加 loader entry（幂等，可重复执行）。

然后**完全退出并重新启动 DeepSeek Harness**（右上角关闭后重新打开，或退出托盘图标），
插件即随应用启动自动加载。无需任何手动注入。

## 验证

重启后，在页面开发者控制台（F12）执行：

```js
window.__dshHighlighterDiagnostics.health()   // { ok: true, ... }
await window.__dshHighlighterDiagnostics.selfTest()  // 只读自检，不写入数据
```

- `health().ok === true`：插件已加载并挂载。
- `selfTest().ok === true`：选区工具栏能正常弹出且未污染存储。

也可以直接选中一段文字试一下。

## 工作原理

- 插件是 DSH 的静态客户端插件（`dsh.client` bundle）：部署到用户 profile 的
  `profiles/node_modules`，通过 `cordis.patch.yml` 的 `insert` 列表登记 entry；
  host 侧的 `client-modules` 服务把 bundle 扫入 `window.__DSH_BOOT__` 启动图，
  页面加载时由内核自动导入并激活（无需 cordis 工具、无需打包工具链）。
- 高亮用 `<span class="dsh-hl">` 包装选区文本；记录以「文本 + 前后文」存入
  localStorage；React 重渲染导致 span 丢失时，MutationObserver 按文本索引重新锚定。
- 圆标条使用 Shadow DOM 隔离样式；圆标纵向位置 = 高亮在滚动内容中的比例位置。

## 卸载

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

然后重启 DeepSeek Harness。已标注数据保留在 localStorage，不会丢失。

## 文件

| 文件 | 用途 |
|---|---|
| `client.js` | 浏览器半 bundle：全部高亮功能 |
| `index.js` | host 半占位插件（保证 entry 有存活 fiber） |
| `package.json` | 包清单：`dsh.client.platform: web` + `exports["./client"]` |
| `install.ps1` / `uninstall.ps1` | 部署 / 卸载 |

## 已知限制

- 高亮记录按页面 origin 存储（浏览器标签页与桌面窗口可能各自独立）；
- AI 流式输出/重渲染瞬间，高亮可能短暂消失，随后自动重新锚定（约 0.7s）；
- 输入框、可编辑区域内的文本不会被高亮。
