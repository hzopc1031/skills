---
name: wechat-publish
description: >-
  用本机 Chrome 自动填写微信公众号图文消息，只保存到公众号草稿箱，不发表。
  当用户要把稿子存入公众号草稿箱，或排查公众号草稿填写和保存问题时使用。
  填写后显式点击「保存为草稿」，读回保存成功提示；未确认成功则报错。
metadata:
  version: "0.6.3"
  verified: "2026-11-14：石墨正文＋克莱因蓝 accent 统一；GitHub 热榜自动出 2100×900 封面并设为正文首图；封面自动选 21:9、保存前自动重试一次、保存后草稿箱核对；离线回归 28/28 见 scripts/tests/rich-html.test.mjs"
  runtime: "node >= 20"
  status: "v0.6.3：仅保存草稿；每篇独立封面且先压 1280×545；换封面删了重建；正文石墨＋克莱因蓝 accent；GitHub 热榜内置横版封面；封面自动选图并可显式指定 coverImage；保存前失败自动重试一次；保存后按完整标题核对草稿箱"
---

# 微信公众号草稿保存

## 执行规则：浏览器操作后必须关闭 Chrome（Liu，2026-11-13）

- 每次 `post` / `status` / `inspect` / `login` 等浏览器操作结束，无论成功、失败、登录过期、身份不符或异常，都必须关闭本次脚本启动或已核验并连接的整个 Chrome。`doctor` 若访问已核验的 CDP，也执行关闭；无监听时不启动。仅断开 CDP 或关闭标签页不算完成。
- CLI 在 `finally` 中等待清理后才输出 JSON 和退出；先重新核验端口与 profile，再发送 `Browser.close`，等待进程退出；必要时按精确 `--user-data-dir` 和已核验的 PID/创建时间结束对应 Chrome/Edge 及其子进程，并确认 `remaining:0`。清理阶段仅查询 Chrome/Edge 进程元信息，不输出命令行。端口冲突且未核验的其它 profile 不接管、不结束。
- `login` 等扫码成功并读回登录状态后再关闭；等待期间保持窗口，超时或异常也关闭。关闭后不删除登录 profile、cookie 或其它登录数据，下次复用同一 profile。`LOGIN_REQUIRED` 时改为请 Liu 重新运行 `login`，不要要求在已经关闭的窗口扫码。
- 正常操作禁止使用 `--keep-browser`。只有 Liu 明确要求调试保留窗口时才加该参数；调试结束仍须运行下面的关闭命令。临时无登录渲染浏览器始终在渲染结束后关闭，不受该参数影响。
- JSON 的 `browserCleanup` 报告关闭结果；关闭失败返回 `BROWSER_FAILED` / 退出码 6。原有发布或草稿操作可能已成功（如 `savedAsDraft:true`）；此时只补做关闭，不可因清理失败重复提交。SIGINT / SIGTERM / 未捕获异常亦尝试清理；系统强制终止 Node 或断电无法执行收尾，须补救。
- 自动关闭失败时，必须用本 skill 的 `scripts/close-browser.mjs --profile <本次实际绝对user-data-dir> --port <本次端口>` 结束对应 chrome 进程，并读回 `ok:true, remaining:0`，确认 0 个残留；否则不得声称已关闭。该命令只关闭，不启动浏览器、不操作网页、不发布、不登录。禁止用全局 `taskkill /IM chrome.exe` 误杀其它 profile；禁止删 profile 或读取凭据。临时渲染 profile 的清理失败信息也包含其绝对路径，按该路径补救。
- 同一 profile 一次只运行一个任务，避免另一任务仍在操作时被关闭。

默认数据根为 `%LOCALAPPDATA%\agent-publish`；设置了 `PUBLISH_SKILL_DATA` 时以它为准。以下命令仅在确需补救时执行，路径必须与本次实际 profile 一致：

```powershell
$publishData = if ($env:PUBLISH_SKILL_DATA) { $env:PUBLISH_SKILL_DATA } else { Join-Path $env:LOCALAPPDATA 'agent-publish' }
node "C:\Users\Mayn\.dsh\skills\wechat-publish\scripts\close-browser.mjs" --profile (Join-Path $publishData 'wechat\chrome-profile') --port 9335
```

本节覆盖下文历史记录中「只断开 CDP」「保留窗口」「匹配但无响应也不杀进程」的旧收尾规则；连接前对其它 profile 的隔离校验、发布授权及草稿限制继续有效。

## 2026-11-13 端口核验修复

监听查询使用 netstat -ano -p tcp，按唯一监听 PID，经 PowerShell UTF-16LE EncodedCommand 执行定点 Get-CimInstance -Filter，读取进程名与绝对 user-data-dir；按原始字节收集后解码，避免中文路径乱码。不枚举全部进程，不输出完整命令行；之后再次 netstat 核对 PID 未变化。进程非 Chrome/Edge、元信息不可读、路径相对/不匹配、多 PID、监听变化均失败，不会返回 PID-only/profileUnverified 成功。PUBLISH_SKIP_PROFILE_VERIFY=1 是硬错误，不是诊断开关。CDP /json/version 不作为 profile 证据。失败不接管其它 profile、不清理登录态；无监听才启动原 profile。ai=9333，house=9334，公众号=9335；草稿保险丝不变。


## 2026-11-11 草稿箱导航修正

优先复用已验证就绪的草稿列表标签；当前已在草稿箱时不重复点击侧栏入口，避免缓存首页的过期入口导致跳转失败。显式保存成功后额外记录 `savedScreenshot`，保存前截图仍保留。

零依赖 CLI，和 `xhs-publish` 同一套底层（Chrome DevTools 协议），独立 profile、独立端口（默认 **9335**，与小红书 house 的 9334 分开）。

## 交稿后先按平台改稿（执行者必做）

本节是执行本 skill 的 Agent（通常是 Codex）的操作要求。交来的稿件经常是同一份源稿，多为 X 帖风格；脚本只做外链转述（`sanitizeLinks` / `linkPolicy`）、话题自动加 `#`、超长截断告警等机械处理，不会按平台重写标题、语气和结构，不能代替以下改稿步骤。

1. 收到稿件后、调用脚本填写或保存草稿之前，必须先把源稿改写成「公众号版本」。
2. 将改写结果写成单独的任务文件 `job.wechat.json`，放在原稿旁边，不要覆盖原稿，再调用脚本。
3. 向调用方报告改了什么，包括标题、结构、删除的 X 痕迹、话题和外链转述等。
4. 只改形式，不改事实、数字、观点和结论。若篇幅或平台限制导致不砍含义就放不下，停止并报告，不要为了塞进去而删改原意，也不要依赖脚本截断。
5. 若交来的已经是公众号专用版本，只需核对限制并做最小修正，不要再大幅重写。

公众号改稿规则：

- 标题 ≤64 字；必须写或保留摘要（`digest` / `caption`）≤120 字，写入任务文件时使用本文已有的 `caption` 字段。
- 改写成公众号文章结构：导语、小标题、分段正文，而不是短帖口吻。
- 正文不能放外链；外链只允许出现在「原文链接」字段，且需要认证号。正文里的 URL 按已有 `linkPolicy` 转述为文字。
- 去掉 X 风格的 hashtag 和 `@`。`topics` 如需保留，按本文现有规则追加到文末即可，不要写成 X 式标签墙。
- 本技能只保存到公众号草稿箱，绝不发表。改稿后执行时也不得使用 `--submit` 或把 `job.submit` 设为 `true`；这两项仍然必须报错，既有仅草稿规则保持不变。


## 封面与视觉（v0.6.3，2026-11-15 整合）

这一节取代此前散落的 11-14/11-15 封面记录，只保留当前有效的规则。

### 1. 每篇都必须有封面，没有封面就不存

按优先级自动补齐，调用方不用传参：

1. `coverImage`（本地图，必须是正文已上传的那张）或 `coverFromBody:true`：走「从正文选择 → 下一步 → 确认」，按 21:9 挑图并做视觉证明。
2. `htmlFile` 富文本任务：正文 hero 首图即封面。
3. 其余任务：`prepareWechatCover` 本地先出一张 2100×900 放 `images[0]`，再自动开 `coverFromBody`；文件名 `wechat-cover-<date>.png`，可设 `coverOut`，版式浅纸底＋克莱因蓝，可用 `coverTitle` / `coverSubtitle` 覆盖文字。
4. 兜底才用微信「一键生成」`makeCover`，最多两次；仍失败就 `UPLOAD_FAILED`，**绝不保存空白封面草稿**。

**每篇用自己的封面**：按本篇标题渲染，不能复用同轮其它文章的封面（实测过复用了合辑封面，结果两篇封面写着别的标题）。

### 2. 封面尺寸：先压到 1280×545 再上传

2100×900 直接上传时微信会重编码成 1280×54x，视觉证明的误差比常在 0.35–0.47，超过 0.30 阈值被判失败；压到 **1280×545** 后误差比降到 0.07 左右，稳定通过；用 548 会被平台裁成 545，误差比 0.33 仍可能被拒。渲染时仍出 2100×900 存档，上传前再压。

### 3. 已有草稿要换封面：删了重建，别在编辑器里改

实测编辑器里没有可靠换封面路径：点封面区只出现「拖拽或选择封面」；隐藏的 `input[type=file]` 属于正文图片上传器，上传结果进正文而不是封面；悬停预览也不出现「修改」链接。

正确做法：按完整标题删除该稿，再用 `post` 重新保存一次。重建前确认 `job.wechat.json` 的 `inlineImages` 首图就是本篇自己的封面。

### 4. 草稿箱卡片图标（悬停后出现）

从左到右：**删除（垃圾桶）→ 编辑（铅笔）→ 发表**。删除会弹确认框，确认后数量立即减少。按位置盲点极易误删（已误删过一次合辑稿），删除前必须先确认目标卡片，编辑只点中间那个。

### 5. 自动重试与保存后核对

- 自动重试只覆盖「还没点保存」的填写阶段（`PAGE_CHANGED` / `UPLOAD_FAILED` / `BROWSER_FAILED`），最多 1 次；已点保存或 `savedAsDraft:false` 绝不重试。
- 保存成功并截图后，自动回草稿箱按完整标题检索（NBSP 归一后等值匹配），回执带 `draftVerified` 与 `draftListCheck`；列表核对失败只记证据，不改变已确认的保存结果。
- 同一 profile 禁止并发：`acquireProfileLock` 已在 `ensureBrowser` 里调用，第二个进程排队等待，不会把登录会话顶掉；关闭时先优雅关闭等 8 秒再考虑强杀。

### 6. 正文视觉：石墨＋克莱因蓝 accent

正文保持石墨灰（`#27272A` / `#52525B`），只用克莱因蓝 `#002FA7` 标章节序号与关键词下划线。生成 `article.wechat.html` 后跑一次：

```powershell
node <本技能>\scripts\theme-accent.mjs --in <gzh-design 输出的 section.html> --out <article.wechat.html>
```

只替换三处：章节序号色（`color:#E4E4E7`）、关键词下划线（`border-bottom:2px solid #52525B`）、引言卡左竖线（`border-left:3px solid #27272A`）；其余 HTML 原样保留。输入必须是单个 `<section>`，输入输出同路径或输出已存在都拒绝。替换后跑 `validate_gzh_html.py`，ERROR/WARNING 必须为 0。

### 7. GitHub 热榜封面

`prepareGithubIntro` 在同一次渲染里顺带产出 2100×900 封面（`gh-cover-<date>.png`，可设 `githubIntro.coverOut`），排在 `job.images[0]`，并自动打开 `coverFromBody`。版式：浅纸底＋克莱因蓝，三栏前三名＋今日增量，URL 与裸域名一律清除；溢出直接 `RENDER_FAILED(8)`。

## 2026-11-13 图文草稿实测与查找

已在 TwoPeanuts的AI 真实保存新版图文草稿：正文横封面＋3章插图、石墨极简 HTML、摘要及正文首图派生封面。`savedAsDraft:true`、`richBodyVerified:true`、4张正文图、首图裁切后新 JPEG 的真实渲染证明、显式“已保存”提示及 `remaining:0` 均已记录在[本次业务回执](<D:/AIInfra/publish-jobs/2026-11-13-redesign/draft.wechat.visual-verified.json>)；随后草稿箱可见唯一新版完整标题及新封面。助手只保存草稿，未发表。用户随后明确告知“公众号已经被我发表了”；该发表状态来源为用户确认，不冒充助手操作或独立发表核验。已停止后台查找；草稿消失不作为重建／重发理由。

草稿查找可先用不含空格的辨识关键词检索，再对候选的**完整标题**仅作 NBSP→普通空格的表示归一后等值匹配。平台可能将 contenteditable 的空格保存成 NBSP，不能因原始字符串不同就判不存在并再建一篇；多篇同名、分页未查全或列表未就绪均不允许声称“不存在”。本地手机排版预览、离线测试与保存业务回执是三类独立证据，不能互相替代。

## 端口与只存草稿（必须遵守）

- 固定调试端口是 **9335**；`--port` 只接受 9335。ai 的 9333、house 的 9334 以及其它端口均拒绝使用。
- `doctor` 检查监听 PID 的 `--user-data-dir`，报告 `profileVerified` / `listenerPids`；无监听时 `browserRunning:false`，不启动浏览器。`status` / `login` / `inspect` / `post` 无监听时通过 `launch()` 打开同一 `profileDir('wechat')`，不创建替代 profile。正常退出或意外关闭 Chrome 后可按此恢复。
- 9335 已监听时，先核验进程名和 `--user-data-dir` 与 wechat profile 一致，再连接并复用；不匹配或无法核验均报 `BROWSER_FAILED`，不会结束占用进程、删除 profile 或清理登录数据。profile 匹配但 CDP 无响应也停止，并在收尾阶段关闭已核验的该 profile，不自动重启。
- 重开保留原 profile 的登录态，但不保证会话仍有效；仅当前工作标签真实显示扫码页才报 `LOGIN_REQUIRED`，关闭本次浏览器并请 Liu 运行 login 重新打开扫码；不读取、导出或填写 cookie、token、凭据。
- 本技能只保存到公众号草稿箱，绝不发表。`--submit` 和 `job.submit: true` 都会报错并退出，不会点发表或群发。
- `LOGIN_REQUIRED` 只用于当前工作标签确实显示微信扫码登录界面。旁路标签的「请重新登录」、无 token home 或加载失败不足以证明会话失效；后台状态不明报 `PAGE_CHANGED`。不读取、不显示 cookie、token 值或登录凭据。


## 规则清单（必须写在脚本里，不能只改当天 job）

| 规则 | 实现位置 |
|---|---|
| 只保存到公众号草稿箱，绝不发表；`--submit` 和 `job.submit: true` 都报错退出 | `scripts/wechat.mjs`、`scripts/lib/wechat.mjs`：`publish` 开头；本文件「端口与只存草稿」 |
| 固定 9335；无监听时重开同一 wechat profile；有监听先核验 PID/profile，冲突或无法核验则停止、不杀进程 | `scripts/lib/cdp.mjs`：`launch` / `verifyBrowserProfile`；`scripts/lib/wechat.mjs`：`ensureBrowser`；`scripts/wechat.mjs`：`doctor` |
| 已有 9335 且 profile 匹配时复用，不碰 ai 9333 / house 9334，不清理登录数据 | 同上 |
| 话题只保留一个 `#AI`，自动删除 `#蓝V交友`、`#AI面试` 及其它标签 | `scripts/lib/util.mjs`：`readJob` 过滤 `topics` |
| 正文开头不重复标题 | `scripts/lib/util.mjs`：`stripRepeatedTitle`（`formatWechatHtml` 内调用） |
| 导语用加粗引用样式，段落间距正常，不用大段空行 | `scripts/lib/util.mjs`：`formatWechatHtml`；`scripts/lib/wechat.mjs`：`fillBody` 通过编辑器 HTML paste handler 写入，等待完整正文和链接读回 |
| 来源改成「序号 来源名称」并可点击，不铺完整长 URL；GitHub 仓库做成小标题分段 | `scripts/lib/util.mjs`：`formatWechatHtml` |
| 任务里的配图插入正文（封面仍可自动生成） | `scripts/lib/wechat.mjs`：`insertBodyImages` |
| 文末只放一个 `#AI` | `formatWechatHtml` |
| 仅当前工作标签的真实扫码登录页返回 `LOGIN_REQUIRED`；不读不显示凭据 | `scripts/lib/wechat.mjs`：`loginState` / `requireLoggedIn` |
| 封面自动挑最接近 21:9 的正文图；都不合适时在打开浏览器前停止 | `scripts/lib/util.mjs`：`coverPlan` / `preflight`；`scripts/lib/wechat.mjs`：`chooseBodyCover` |
| 保存前失败自动重试一次；已点击保存后绝不重试 | `scripts/lib/wechat.mjs`：`publish` |
| 保存后按完整标题核对草稿箱，只作附加证据、不改变保存结论 | `scripts/lib/wechat.mjs`：`verifyDraftInList` |

公众号保留链接（做成可点的来源名称），与小红书默认删链接不同。填写后显式点「保存为草稿」并确认成功提示。

## 快速上手

先按「交稿后先按平台改稿（执行者必做）」在原稿旁写成 `job.wechat.json`，再将该任务文件传给脚本。

```powershell
$W = "C:\Users\Mayn\.dsh\skills\wechat-publish\scripts"

node "$W\wechat.mjs" post --job job.json     # 填写内容，显式保存草稿并确认结果
```

只保存到公众号草稿箱，不发表。`--submit` 已禁用，传入即报错；`job.submit` 为真也报错，绝不会发表。旧任务中的 `submit: false` 可保留，也可删除。

标准错误输出是日志，标准输出是 JSON。`post` 成功时包含 `savedAsDraft: true` 和保存成功提示；点击失败或未确认成功时包含 `savedAsDraft: false`、明确错误及保存前截图路径，并以非零退出码结束。保存失败沿用错误码 `PUBLISH_FAILED`（退出码 5）。

## 任务文件

沿用 `xhs-publish` 的内容字段，但禁止请求发表：

```json
{
  "title": "文章标题，上限 64 字",
  "content": "正文全文，支持多段",
  "caption": "摘要，上限 120 字；留空自动取正文开头",
  "topics": ["GitHub", "开源"],
  "linkPolicy": "describe",
  "images": []
}
```

- `topics` 会以 `#话题` 段落追加到正文末尾
- `linkPolicy` 沿用小红书那套外链转述（`describe` / `strip` / `keep`）
- 公众号正文本身也不能放外链，只有「原文链接」字段可以（需认证号）

## 富文本 HTML 与章节内配图（本地增强，2026-11-13）

AI 更新/AI 日报文章必须先按 `gzh-design` 排版并配章节图，不得把文字草稿或仅有自动封面的文章当作完成。使用 `type:"ai-update"`（或 `requireInlineImages:true`）启用代码级硬检查：没有 `htmlFile` 和非空 `inlineImages` 立即停止，绝不退回纯文字。每个预期章节图都必须在清单和 HTML 中一一对应；不能因为素材还没生成而删掉清单/占位继续保存。

新增字段（旧 `content` + `images` 任务不变）：

- `htmlFile`：UTF-8 `.html` / `.htm` 正文文件，绝对路径或相对任务文件目录。必须是 `gzh-design` 的纯 `<section>…</section>` 片段、内联样式及 `<span leaf="">`，不是带复制按钮的预览页。先运行该 skill 的 `validate_gzh_html.py`，ERROR/WARNING 修到 0。正文 HTML 原样保留，不重排、不改写、不自动追加/删除标题或 `#AI`；调用者须在 HTML 中安排不重复标题、来源纯文字和文末唯一 `#AI`。
- `inlineImages`：`[{"id":"section-01","file":"images/section-01.png"}]`。`id` 唯一、1–64 位英文/数字/下划线/连字符；每个文件必须是存在的本地普通图片（png/jpg/jpeg/webp/gif/bmp）。不接受远程 URL、data URL、file URL 或网络共享路径。所有路径相对任务文件解析，不依赖当前工作目录。
- HTML 中的对应位置放精确注释 `<!--WECHAT_INLINE_IMAGE:section-01-->`，每个 ID 恰好一次。可放在主题图片容器的 `<section>` 内；图片说明等仍由主题组件提供。输入 HTML **不含 `<img>`**，须将原图片标签改成这些占位；禁止伪造远程图片 URL 或把本地路径当作微信图片地址。
- `type:"ai-update"` / `requireInlineImages:true`：至少有一张章节内图；不能用自动封面或普通 `images` 代替。`inlineImages` 已列出的图片无论是否开启该开关，都必须全部上传成功。
- `images` 仍按旧行为上传并放在导语后。与 `htmlFile` 混用时，HTML 必须另放一个 `<!--WECHAT_BODY_IMAGE-->` 决定这一组图的位置；GitHub 简介图与 HTML 混用也需要此槽位。
- 可保留完整纯文字 `content` 作为工作稿；`htmlFile` 是实际粘贴和正文长度检查的权威输入。省略 `content` 时从 HTML 提取预检文字；建议显式提供 `caption`（≤120 字）。
- `coverFromBody:true`（可选布尔值，默认 false）：不生成随机 AI 封面，改经可见 UI「从正文选择 → 正文首图 → 下一步 → 确认」使用**最终 HTML 正文顺序中的首张实际上传图片**。例如将 `<!--WECHAT_INLINE_IMAGE:hero-->` 放在所有其它图片之前，并映射本地重设计的 hero 图。不是清单数组第一项，也不按文件名猜测。必须找到与首图来源匹配且唯一的可见弹窗缩略图，按钮可用、裁剪确认结束，并确认 `coverApplied` 及封面预览来源匹配；任一环节缺失/歧义都停止保存，不回退 AI 封面或沿用旧图。默认/false 继续原 `makeCover` 行为。成功 JSON 增加 `coverSource:"body-first-image"` 和 `coverBodyImageIndex:0`。缩略图选择始终按正文首图 origin/path 严格匹配（允许查询参数不同）。应用后必须只有一个可见封面预览和一个文章卡片，两者来源完全一致、为同源公开微信图片 CDN；原路径未变走严格快速确认。若微信裁剪把 PNG 重新编码为新对象 JPG，只在预览/卡片都不是选择前旧来源、正常选择及裁剪确认已完成时，调用本地 `visual-proof.mjs` 的 `compareRenderedSources`，以 `235×100`、`fit:'cover'` 渲染原首图与派生图，经真实 CDP PNG 截图对比且 `verified:true` 才接受；不读 canvas、不绕过 CORS、不通过私有接口取图。没有 helper、验证异常或结果不通过均停止；没有 job/CLI 跳过证明的参数。回执 `coverVisualVerification` 含确认方法、比较指标与证据截图路径，失败证明也随错误返回；仍须浏览器执行者检查实际封面。仍须验收封面裁剪后的视觉效果。当前实测图片选择器使用 `span.appmsg_content_img.cover` 的单一 CSS background-image；只将这一已证实的选择器与 `img[src]` 合并匹配，去重同一真实元素后仍要求唯一 origin/path 匹配，不用位置/顺序猜图、不归一化 `/0` 等路径后缀。首图缩略图缺失/不唯一，或后续下一步/裁剪/确认/应用预览检查失败时，运行时额外保存带失败 stage 的截图与有界可见弹窗 DOM 摘要（包含图片及 CSS background-image、首张正文图的公开微信 CDN origin/path；删除所有 URL 查询参数/hash/userinfo，其它来源隐藏；不导出 outerHTML、认证 URL、cookie 或隐藏状态）。失败 JSON 的 `screenshot` / `diagnostic` 给出文件路径；采集失败也不覆盖原错误、不点击、不重试、不保存草稿。仅诊断增强，不放宽匹配。

```json
{
  "type": "ai-update",
  "title": "AI 更新｜今日观察",
  "caption": "这期更新的重点与影响。",
  "htmlFile": "article.wechat.html",
  "inlineImages": [
    {"id":"section-01","file":"images/section-01.png"},
    {"id":"section-02","file":"images/section-02.png"}
  ],
  "images": [],
  "submit": false
}
```

纯离线检查，不启动/连接浏览器、不生成 GitHub 图片、不查询 profile、不保存草稿：

```powershell
$W = "C:\Users\Mayn\.dsh\skills\wechat-publish\scripts"
node "$W\wechat.mjs" check --job "<单独修订的 job.wechat.json>"
node --test "$W\tests\rich-html.test.mjs"
```

由获授权的浏览器执行者保存（代码维护/素材设计阶段不执行）：

```powershell
node "$W\wechat.mjs" post --job "<单独修订的 job.wechat.json>"
```

实际执行逐张经既有 UI 文件上传器上传章节图，只使用上传后读回的真实图片 DOM；确认唯一新增图片、HTTPS src、已加载及自然宽度，随后按稳定 ID 插回原 HTML 位置（自动加自适应图片样式），不依赖批量完成顺序。缺文件、缺映射、重复/未绑定槽位、上传超时、图片读回数量/顺序不符均失败并停止显式保存。富文本任务另在正文填入后及保存前校验全文、图片身份/顺序/加载和关键内联样式值；样式被降为纯文字也停止，不静默重试。该读回检查不等于保存后视觉验收，仍必须检查保存截图/草稿预览。

`post` 成功 JSON 增加 `htmlFile`、`inlineImageIds`、`bodyImageCount`、`richBodyVerified:true`。`savedAsDraft:true` 仍只由原有显式点击「保存为草稿」后出现的新成功提示决定；`check` 不返回此成功标志。禁止 `--submit` / `job.submit:true`、9335/profile 核验、凭据边界及 CLI finally 浏览器清理完全保留。不要覆盖用户原始 job，也不要修改 `gzh-design` / Guizang 上游技能。

本次四个既有文件修改前均备份为 `.before-rich-html-20261113-1901`。离线回归仅使用临时测试文件及模拟页面，不建立任何浏览器连接。

## 草稿保存与确认

填写标题、正文、摘要并尝试封面后，保留原有读回校验，并保存 `before-save-*.png` 截图，然后显式点击「保存为草稿」。

只接受点击后新出现的可见「已保存」「保存成功」等提示，最多等待 15 秒。点击前已有的提示不能作为本次保存成功的依据。

找不到按钮、按钮禁用、点击异常、确认超时或页面连接异常均报错，不以后台自动保存作为成功依据。未确认成功时，应先人工核对草稿箱再决定是否重试，以免重复创建草稿。

## 编辑器定位

| 环节 | 做法 |
|---|---|
| 登录 | `mp.weixin.qq.com` 扫码，登录态存独立 profile |
| 编辑页 | 从可见 UI「草稿箱 → 新的创作 → 文章」进入，不提取或拼接认证参数 |
| 标题 | 编辑器里**第一个 `div.ProseMirror`**（会同步到隐藏的 `textarea#title`），字数显示 `x/64` |
| 正文 | **第二个 `div.ProseMirror`** |
| 作者 | `input#author` |
| 摘要 | `textarea#js_description`（`x/120`） |
| 保存按钮 | 底部「保存为草稿」；只点击此保存操作 |

## 封面与保存验证

1. **封面核对**：自动封面可能复用带旧日期的图片，必须看保存后截图。2026-11-12 实测发现 GitHub 自动封面带 11.10，已在同一草稿内通过「从正文选择 → 下一步 → 确认」改用 11.12 简介图并重新保存；不要因换封面重复创建文章。
2. **显式保存与确认**：2026-11-12 科技24小时、GitHub 两篇均实测读到「已保存」，刷新草稿箱后各一篇。若后台按钮或提示结构变化，仍报错并返回 `savedAsDraft: false`，需核对草稿箱。

## 踩过的坑

- **AI 封面弹窗跨连接会自己关掉**：必须在一个进程里从触发到确认一次跑完，
  分步用不同 node 进程探查会一直失败
- 编辑器里的 `textarea#title` 高度为 0，坐标点不了，要直接 `focus()` 再输入
- 「新的创作 → 文章」是用 `window.open` 开新标签页，点完要去 `/json/list` 里找新 target；
  只附加本次 UI 新开的 target，排除原有编辑器；不要构造认证 URL
- 后台会弹「优选联盟带货」引导弹窗，挡住界面，先点「稍后再说」
- **新建编辑器可能恢复上一篇草稿**：同一个账号有其它自动化在写时，内容会串

## 实现结构

```
scripts/wechat.mjs        CLI 入口
scripts/lib/cdp.mjs       CDP 驱动（与 xhs-publish 同源，多了 openWithUrl / attachByUrl）
scripts/lib/wechat.mjs    草稿填写、保存与确认流程（保留 publish 导出名以兼容调用）
scripts/lib/util.mjs      参数、预检、外链转述、数据目录
```

数据目录：`%LOCALAPPDATA%\agent-publish\wechat\`

## 2026-11-10 本次执行修正

草稿创作通过可见 UI「草稿箱 → 新的创作 → 文章」进入，不再提取或构造 URL 中的认证参数。只连接本次操作新开的文章标签页，不复用旧编辑器。GitHub 小标题保留语言、总 star 和今日增长元信息。只保存草稿、独立 9335 端口等规则保持有效。

## v0.4.1 多标签登录判断与清理

`ensureBrowser` 固定使用 9335：已有监听先核验 PID 的 `--user-data-dir` 等于 wechat profile 再复用；无监听则调用 `launch()` 重开同一 profile。不另启替代 profile、不接管其它端口、不删除登录数据。按 URL 模式优先选择带 token 参数的后台标签，但只判断参数存在、不提取值。逐个用当前页面可见后台控件确认登录，跳过无 token home、过期页面和旧编辑器；旁路文字不参与工作标签登录判断。

若没有合适标签，新开干净标签访问站点根地址，等待网站自行跳转。当前工作标签真实显示二维码或微信扫码界面才报 `LOGIN_REQUIRED` 并停止；没有明确后台或扫码证据报 `PAGE_CHANGED`。`status`、`inspect`、`post` 共用选标签逻辑。输出及 inspect 文件统一脱敏认证查询参数。

操作过程只关闭本次创建且不再需要的标签；命令结束按上方执行规则关闭已核验的整个公众号 Chrome。新编辑器按创建前 target ID 排除旧页，保存后关闭自己的编辑器。失败重试前必须再次核验草稿箱精确标题，最多重试一次。不得因此关闭、重启或结束 house 的 9334 Chrome。

### 本次保存与预览验证发现

原生 `execCommand('insertHTML')` 会被现有编辑器归一化，导致导语、段落格式或链接丢失；现改为真实按键清空正文后触发 HTML 粘贴处理，等待全文读回再继续。正文插图已修复正则转义错误，上传失败停止保存；上传后把图片放回导语后的预留位，保证 #AI 在末尾。图片计数排除没有 src 的 ProseMirror separator。

保存成功与排版通过必须分别核验。2026-11-10 该账号的正文外链在保存后被后台去除；可见超链接窗口仅接受公众号或服务号相关链接，输入 CNBC 来源地址返回「请输入公众号或服务号相关链接，并以http://或https://开头」。因此此账号的外部来源名称在预览中为纯文本，不能将编辑器里短暂出现的 a 标签当成链接已生效，也不应以重新保存或发表尝试绕过限制。回执必须报告这个未满足项并附截图。

## GitHub 热榜项目简介图（v0.5.0）

job 含 `githubIntro` 对象，或 `type:"github-ranking"` 且有顶层 `projects` 时，主流程先本地生成简介 PNG，再连接发布浏览器。`githubIntro.projects` 优先于顶层 `projects`；不从正文猜测简介。`githubIntro.enabled:false` 关闭生成。

默认尺寸 `githubIntro.width/height = 1242/1656`；可设 `title/subtitle/footer`。输出默认在 job 同目录 `gh-intro-<YYYY-MM-DD>.png`，日期取 `githubIntro.date`、`job.date` 或本机当天；`githubIntro.out` 可指定绝对路径或相对 job 的 PNG 路径。

生成图成为首张正文配图，按现有规则置于导语之后、其余配图之前；正文完整保留，文末唯一 #AI。只保存草稿，`--submit` 和 `job.submit:true` 仍拒绝。

intro 从原稿提炼为一句话，约≤25字（中英混排注意实际宽度），不编造、不放链接。repo 用 owner/repo 短名；rank/lang/today 保留原榜数据。渲染器会移除 URL。

```json
{
  "type": "github-ranking",
  "date": "2026-11-10",
  "title": "GitHub热榜｜今日开源精选",
  "content": "保留经平台改写的完整正文；小红书图文须不超过1000字。",
  "topics": [
    "AI",
    "GitHub",
    "开源"
  ],
  "images": [],
  "submit": false,
  "githubIntro": {
    "title": "GitHub热榜｜11.10 今日项目",
    "width": 1242,
    "height": 1656,
    "projects": [
      {
        "rank": 1,
        "repo": "anthropics/skills",
        "lang": "Python",
        "today": "+1,038",
        "intro": "Anthropic官方Claude Agent Skills示例与规范"
      },
      {
        "rank": 2,
        "repo": "meta/astryx",
        "lang": "TypeScript",
        "today": "+3,278",
        "intro": "Meta开源设计系统，面向人和AI助手一起搭界面"
      }
    ]
  }
}
```

独立生成（接受完整 job 或只含 title/projects 的 intro.json）：

```powershell
node scripts\render-github-intro.mjs --data <job或intro.json> --out <png>
```

脚本用独立临时 profile、随机 CDP 端口与 headless Chrome；只结束自己启动的进程，不连接9333/9334/9335。生成 JSON 包含 ok/overflow/warnings。生成错误或 overflow:true 返回 RENDER_FAILED（主流程退出码8），必须停止，不可用旧图或空图继续。成功后仍需亲眼看图确认中文、项目数量与无链接。

实现：`scripts/render-github-intro.mjs`、`scripts/lib/github-intro.mjs`（可独立调用 `prepareGithubIntro(readJob(jobPath))` 离线验证），在 publish 分发前接入。成功结果含 `githubIntro` 渲染信息。

生成流程补充：没有导语、直接以项目小标题开头时，公众号配图放在全文最前；保存前读回图片数量，缺图即 UPLOAD_FAILED 停止。RENDER_FAILED 的退出码为8。
