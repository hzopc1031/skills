# 故障排查

按退出码定位，再按现象查表。

## 退出码 2：LOGIN_REQUIRED

页面 URL 里出现 `login?redirectReason=401` 就是登录态没了。

```powershell
node scripts/xhs.mjs login --account <别名>
```

- 会在独立 profile 里打开 `creator.xiaohongshu.com`，等用户扫码
- **扫码后不要关浏览器窗口**，脚本要轮询到登录成功才退出
- 登录态存在 `<dataRoot>\<accounts[别名].dataDir>\chrome-profile`（ai 为 `%LOCALAPPDATA%\agent-publish\xhs\chrome-profile`，house 为 `...\xhs-house\chrome-profile`），只要不删就一直有效
- 这个 profile 和你日常用的 Chrome 是分开的：日常 Chrome 已登录 ≠ 这里已登录

## 退出码 3：PAGE_CHANGED

说明选择器对不上了。**不要猜，先 dump 结构**：

```powershell
node scripts/xhs.mjs inspect --account <别名> --out inspect.json
```

然后看 `inspect.json` 里的 `inputs` / `editables` / `buttons`，把真实选择器补进
`scripts/lib/xhs.mjs` 顶部的 `SEL` / `LF` 常量。

常见原因：

| 现象 | 真实原因 | 处理 |
|---|---|---|
| 找不到 `input[type=file]` | 没停在「上传图文」tab | 点 tab 或改用 `?target=image` |
| 找不到标题框 | 页面还在 loading，或换成了 textarea | 等 `document.readyState` + 重试 |
| 找不到正文框 | 编辑器换了组件 | TipTap/ProseMirror 都是 `div.ProseMirror`，Quill 是 `.ql-editor` |
| 找不到「发布」 | **它在闭合 shadow DOM 里** | 用 `Page.clickByAx('发布')`，别用 querySelector |
| 长文编辑器没打开 | 「新的创作」坐标点击无效 | 用 `clickJsByText`（JS 派发五个事件），见 `openLongformEditor` |
| 一键排版后没到排版页 | 判据用了「一键排版」（编辑器里也有） | 等页面出现「下一步」 |

## 截图超时 / 页面操作变慢

`Page.captureScreenshot` 30s 超时，多半是**窗口在后台或被最小化**：

```powershell
$w = New-Object -ComObject WScript.Shell
$w.AppActivate((Get-Process chrome | Where-Object { $_.MainWindowTitle -like "*创作服务*" })[0].Id)
```

代码里已做：先 `Page.bringToFront`，失败降级 `fromSurface:false`。

## 浏览器实例与账户端口

先检查 `accounts.json` 与 `doctor --account <别名>`，不要批量停止浏览器，不要移动/清空其它账户的 profile。ai 的 9333 与 house 的 9334 应分别使用各自 dataDir。
连接复用和新启动都核对监听 PID 对应的 Chrome/Edge `--user-data-dir`；不匹配或读不到就以 `BROWSER_FAILED` 失败关闭，不自动终止进程或切换端口。

## 退出码 7：ACCOUNT_MISMATCH

post 在创作者首页校验，尚未打开发布页。核对错误消息中的期望/实际昵称及小红书号，再运行 `status --account <别名>` 只读查看身份。
昵称期望值未配置或读取失败也会拒绝，不要为了通过校验随意修改期望身份；先与 Liu 确认账号归属。
账户别名缺失、冲突或未知返回 USAGE（1），发生在启动/连接浏览器前。

## 退出码 4：UPLOAD_FAILED

- 图片格式：png / jpg / jpeg / webp / gif / bmp
- 单张别超 10MB
- 网络慢时把 `uploadImages` 的 `timeout` 调大（默认 120s）
- 一次塞 18 张会明显变慢，一般建议 ≤9 张；house 依 SKILL.md 现行规则建议总共最多 4 到 5 张，排除密集扫描件，不用指标/数据图凑数

## 退出码 5：PUBLISH_FAILED

分两种，别混：

1. **按钮灰着（禁用）** —— 表单没通过校验，通常是协议没勾、必填项没填、图片还在上传。
   让用户手动看一眼再发。
2. **点了弹报错** —— `message` 里会带平台原话（如「内容包含违规词」）。
   **不要原样重试**，改内容再说。

## 浏览器相关

- 端口被占：按 accounts.json 的账户端口查 `Get-NetTCPConnection -LocalPort <端口>`；不支持 --port 临时覆盖，不动其它账户进程
- Chrome 找不到：设 `CHROME_PATH` 环境变量
- profile 和 artifacts 都从所选账户的 dataDir 解析；不要删除已登录的 profile 或批量清理数据根目录

## 已知的平台坑（来自小工具发布经验）

- 页面某些按钮对合成事件不敏感 —— 本项目统一用真实坐标 `Input.dispatchMouseEvent`，
  按钮点不动时先确认它没被遮挡（弹窗、引导蒙层）
- 中文输入走 `Input.insertText`，比逐键输入快且不会漏字；但**不要在输入法组词状态下操作**
- 内容超过 1000 字平台会静默截断，脚本会提前拦

## v0.7.0 标题、详情图及话题

USAGE(1)：标题规则压缩后仍超20，请给xhsTitle；正文保留榜单/看法后仍超bodyLimit应改正文；总图数超18不可继续。禁止截断。

RENDER_FAILED(8)：查看render-overflow的JSON；测量自动分页后仍溢出、中文字体或Chrome不可用均停止，不能上传旧图。渲染使用临时profile随机端口，与9333/9334/9335隔离。

PAGE_CHANGED(3)话题失败：先看错误JSON的screenshot与inspect，它们保留失败瞬间候选框；不要先inspect命令导航到空白页。每个话题已轮询8秒，至多安全重输一次，仍失败不重试post。已有#ai与新建#AI会同时出现，只接受已有正式话题ID及高亮。
