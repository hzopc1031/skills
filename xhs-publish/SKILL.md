---
name: xhs-publish
description: >-
  用本机 Chrome 发布小红书图文和编辑原笔记；纯文字先离线制卡并验收。当用户要发小红书、
  把稿子发到小红书、批量或定时发帖、编辑已发布笔记标题/正文/图片、或排查发布页报错时使用。
  支持独立多账户 profile、发布前身份校验与纯离线推广风险预检；正文和图片同审，默认只填不提交，job.submit:false 始终阻止提交。
metadata:
  version: "0.9.0"
  runtime: "node >= 20"
  verified: "2026-11-13：推广预检及原安全机制210项离线测试通过；本版未操作实际笔记。端口历史实测见2026-11-13-portfix/RESULT.md。"
---

# 小红书自动发帖

## 2026-11-13 发布前推广风险检查（优先于下方历史规则）

先读 [推广与站外引导审阅规范](<references/promotion-review.md>)，再改稿、出图或操作发布页。**删网址、改成站点称呼或把正文转进图片，都不等于完成合规审阅。** 标题、正文、caption、话题、附录、项目简介、卡片尾页和图片中的可见文字均要核对。

- 用户提供的审核截图明确指向“推广其他平台”，标出“免费可用”、产品安利和“直接换过去试”等片段。它提供风险线索，不证明品牌名本身被禁；顶部注明笔记已修改、仅展示历史记录，不能据此断言当前仍受限或已经恢复。
- 中性提及品牌、来源、开源仓库名不一律拦截；重点审第三方目标与换用/下载/注册/购买等行动引导、优惠/免费等利益承诺、站外联系方式及领取入口的组合。
- 不用谐音、拆字、隐藏字符、去域名后指路、转图/评论/主页/私信搬运等方式保留同样的引导意图，也不以删帖重发规避处置。原意本身属于推广时，给出实质修改建议并取得改稿授权，不能偷偷改事实或换暗号。
- 文本启发式预检不代替逐张看图。新图须记录实际文件 SHA-256、完整可见文字及具体视觉审阅说明；文件变化后重新检查。保留的原图只在另获编辑授权、读取同一原笔记后核对，未检查不称为已通过。
- **0.9.0 兼容性变化：** 旧版无本地图的“平台一键排版长文”不能在缺少最终卡片审阅时继续。离线报告写 pendingGenerated，即使文字无命中也不代表能发布；先独立在本地制成卡片、逐张审阅并绑定哈希，再走图文流程。不能先向已登录平台上传/预填来试探。下方保留的长文历史记录不覆盖这条新门禁。
- 新增纯离线命令 `preflight --job <任务> --kind post|edit`；不登录、不读账户配置、不连接 Chrome、不上传、不写回任务。先预检再运行任何 status/post/edit。`CONTENT_REVIEW_REQUIRED` 退出码为 `9`，先解决明确风险与已知图片待审，不能反复重试发布。若仅余 pendingExisting/pendingGenerated，可在已有相应授权下只读核对原帖或独立本地出图；未知状态不是上传、改写或提交许可。
- 明确站外行动引导不能用审阅声明放行。中性报道的误报可用绑定具体命中的人工说明复核；图片审阅记录仅是声明与文件绑定，不是脚本已执行 OCR 的证明。任何放行都不是平台审核/流量保证，也不构成发布授权。

```powershell
$S = Join-Path $env:USERPROFILE '.dsh\skills\xhs-publish\scripts'
node "$S\xhs.mjs" preflight --job "D:\path\job.xhs.json" --kind post
node "$S\xhs.mjs" preflight --job "D:\path\job.edit.json" --kind edit
```

编辑的离线预检仅知道显式新字段，未知的保留正文/原图必须标为待核验。实际执行已获授权的 edit 时，在同 ID 原编辑页取得 before 快照后、第一次输入/上传/删除前再检查最终有效内容；有风险就停，不擅自清洗或改写未授权字段。`job.submit:false`、身份/profile 核验、同 ID 保存读回和精确浏览器关闭规则全部继续有效。

## AI 图文配图与验收

AI 日报／工具消息的图片重做、五页图文、公众号章节图与手机预览，先遵循 [AI 图文流程](references/ai-editorial-workflow.md)。用户已选择浅底克莱因蓝 Swiss 卡组＋公众号石墨极简；不能退回旧单张深蓝列表图。严格核验 profile，不接受 skip／pid-only 成功；执行记录用字节保真的 run-cli-safe.mjs 留存。

**2026-11-14 起全账号只用一套视觉系统**：纸白 `#FAFAF8`、墨 `#0A0A0A`、克莱因蓝 `#002FA7`、灰 `#52525B`；五种固定卡型（封面／单点／数字／对比双栏／清单），清单每页 ≤6 行，深色不做满版。GitHub 榜单也已并入同一套 token（`render-github-intro.mjs`）。某期内容结构不适配时重排布局，但不另换配色与字号体系；改版式只改渲染器，不在单期成稿里改。

## 改已发布笔记的图片（2026-11-15 打通并验证）

按顺序做，别跳步：

1. **拿 note id**：在 `note-manager` 读 `.note-card` 的 `data-impression` 属性，里面有 `"noteId":"..."`；不用点开卡片。
2. **进编辑页**：新开浏览器后**只保留一个标签**，直接 `goto /publish/update?id=<id>&noteType=normal`。多标签或复用已有标签时，`Runtime.evaluate` 会 30 秒超时（实测反复出现）。
3. **删旧图**：悬停 `.img-container` → 点 `.close-btn`。**至少保留 1 张**，删到剩 1 张就停，否则点不动。
4. **传新图**：`DOM.setFileInputFiles` 打到页面的 `input[type=file]`，等 15 秒。
5. **删掉那张旧图**：再次 `.close-btn`（此时总数 >1，允许删）。
6. **发布**：底部按钮是自定义元素 `xhs-publish-btn`，文本不在 DOM 里、按文字找不到；取它的 `getBoundingClientRect()`，点中心坐标（`mousePressed` + `mouseReleased`）。发布成功后跳回 `/new/note-manager`，编辑后的笔记会进入「审核中」。
## 笔记管理里的「编辑」入口

已发布笔记的编辑入口不是文字链接：在 `creator.xiaohongshu.com/new/note-manager` 里，**鼠标悬停到笔记卡片**，右上角才出现一排图标——用户、置顶、数据、**编辑（铅笔）**、删除。按文字「编辑」找不到会误报 `PAGE_CHANGED`；审核中的笔记也允许编辑。




## 2026-11-13 原笔记安全编辑（真实原帖更新与保存后核验已通过）

`edit` 只从笔记管理的明确「编辑」入口进入原笔记 `/publish/update`；不调用 `post`、不进入新建页、不删帖。只在用户授权的范围内更新标题、正文、话题或整组图片。修改前后的原笔记 ID、完整标题/正文、正式话题实体与有序图片来源均留证；保存后重新打开**同一个原编辑 URL**读回核验，不能用同名新笔记代替。

将任务另存为新的 `job.edit.json`，不要覆盖源稿/原任务。推荐字段如下（图片路径相对这个新任务文件）：

```json
{
  "account": "ai",
  "date": "2026-11-13",
  "images": ["assets/01_cover.png", "assets/02_detail.png"],
  "submit": false,
  "edit": {
    "targetTitle": "原笔记的完整标题",
    "title": "经授权的新标题",
    "content": "经授权的新正文，短段落之间用换行。",
    "replaceImages": true
  }
}
```

| 字段 | 编辑语义 |
|---|---|
| `edit.targetTitle` | 原笔记完整标题，精确匹配，不压缩、不截断、不做子串搜索。别名 `edit.originalTitle` / 顶层 `originalTitle`；多个显式定位字段必须相同。旧图片任务的顶层 `title` 仍可作为定位标题。 |
| `edit.date` / 顶层 `date` | 可选业务发布日期 `YYYY-MM-DD`；两者同时存在必须相同。提供后须与笔记管理中可见完整日期匹配；同名笔记日期读不到、日期冲突、或结果不唯一，均停止。不是电脑运行日期，不自行猜测。 |
| `edit.title` | 可选；仅该字段授权改标题，省略保持原题。≤20发布页计数字，超限直接 `USAGE`，不压缩。顶层 `title`/`xhsTitle` 不会被写回。 |
| `edit.content` | 可选；仅该字段授权改正文，省略保持原文，`""` 明确清空正文。只净化 URL/域名、蓝V与整行纯文本话题；不套用 GitHub 短正文、不自动转图、不删重复首行、不截断。≤1000字，且须给保留/新话题留出空间。 |
| `edit.topics` | 可选正式话题名数组；省略保留原话题ID/名称。改正文时会重新从平台候选插回原话题并核验原ID。`[]` 明确删除全部正式话题。显式替换时必须选到真实正式话题并读回，失败不静默跳过。顶层 `topics` 不授权替换。 |
| `edit.replaceImages` | 可选布尔值。`true` 用顶层 `images` 整组替换；`false` 保留原图，即使任务有顶层 `images` 也不上传。省略时有非空 `images` 则替换，以兼容旧图片任务；没有图片则保持。只替换整组，不承诺局部删图/排序。 |
| `images` | 新图片有序路径数组；启用替换时必须1–18张、每张≤32MB且为可读非空 PNG/JPEG/WebP 文件；扩展名、文件头和图片尺寸/容器先预检，再开始任何删除/文本改动。UI 上传数量必须精确相等且无处理中状态；不能用 `>=` 或上传超时冒充成功。 |
| `submit` | `false` 始终阻止保存，即使命令行加 `--submit`；`true` 请求保存，或省略后由 `--submit` 请求。未请求保存只预填原编辑页，返回 `submitted:false, dryRun:true`，不是已保存；这不是离线操作。 |

旧任务 `{ "title":"原题", "content":"源稿", "topics":["AI"], "images":["new.png"] }` 只替换图片：顶层 `content`、`caption`、`topics` 不会意外改写现有正文和话题。`edit` 仅为兼容旧调用接受合法的 `--link-policy strip|describe|keep` 参数，但不应用该策略：显式新正文固定净化链接，现有未授权正文保持原样。

```powershell
$S = "C:\Users\Mayn\.dsh\skills\xhs-publish\scripts"
# 仅在允许操作浏览器、图片已验收后预填；job.submit:false，不点击保存
node "$S\xhs.mjs" edit --job "D:\path\job.edit.json" --account ai
# 用户已授权保存后，在新的编辑任务将 submit 设为 true（或省略 false）再执行一次
node "$S\xhs.mjs" edit --job "D:\path\job.edit.json" --account ai --submit
```

- 整组换图采用先追加新图、验证原图有序前缀及每张新图的本地视觉证据，再逐一删除预期原图的策略；不会要求编辑页暂时零图。当前要求原图＋新图总数≤18，超出在任何文本/图像修改前停止，不擅自分批。每次删除必须精确减1，且剩余图片的来源、身份与顺序完全符合预期。
- 身份校验、账户独立 profile/端口核验完全沿用；未核验不进管理/编辑页，不读取 cookie、token 或存储。CLI 原有 `finally` 仍负责关闭已核验浏览器，正常不得 `--keep-browser`。
- 编辑入口须有可辨认的文字、aria/title、edit/pencil图标语义或原编辑链接；不再假设第4个按钮。编辑 URL 须含唯一 `noteId` / `note_id` / `id`。页面不能可靠识别时返回 `PAGE_CHANGED`，不猜、不走新建回退。
- 保存只在原 `/publish/update`、原ID校验通过后点击表单的保存/修改/更新按钮；某些平台版本按钮仍叫「发布」，仅在该原编辑路由允许。成功提示或回到笔记管理后，必须重新打开原编辑 URL，逐项核验完整标题、正文、正式话题ID、图片对象/顺序及同一ID；原图和保存后持久读回仍须 HTTP/CDN 图片。新上传图若只提供 `blob:` 预览，必须逐张按有序本地文件做可见渲染对比：上传后、保存前、保存后新打开的原编辑页各验证一次。只有 Node 内部 WeakMap 认证、绑定本地文件 SHA256 和当前源的视觉证据可作新图身份；DOM/job/JSON 字段不能伪造。保存后若仍为 blob 或图像/顺序不符，返回未知失败，不以数量代替核验。
- 返回 `before` / `staged` / 保存后 `after`、`noteId`、`saveVerified`、`editEvidence` 与截图。失败证据也保存在账户 artifacts；保存点击后超时/失败/读回不符返回错误及 `submissionAttempted:true, saveOutcome:"unknown"`，绝不报成功，也不得盲目重跑。关闭失败时原操作可能已经保存，不重做编辑。
- 2026-11-13 已真实单次修改原笔记 `6af6e6f0000000001601832a`。平台显示“更新成功”；初次 CLI 未识别该中间页而保留 unknown 原回执，未重新提交。之后只读打开相同原编辑 URL，核对新标题、完整正文、空话题、5张持久 CDN 图片与本地文件的有序视觉证据，并另从主页核对管理页原条目（原18:31时间、总数31不变）。[只读确认回执](<D:/AIInfra/publish-jobs/2026-11-13-redesign/xhs.saved-original.confirmed.json>)。保存成功不等于保证后续审核／推荐；未来流程已补充识别严格的“更新笔记＋更新成功＋唯一立即返回”中间页，仍强制保存后同ID内容读回。
- 离线测试不启动 Chrome、不连接CDP、不读写 profile：`node --test tests/note-edit.test.mjs`（从本 skill 根目录运行）。

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
node "C:\Users\Mayn\.dsh\skills\xhs-publish\scripts\close-browser.mjs" --profile (Join-Path $publishData 'xhs\chrome-profile') --port 9333
```

本节覆盖下文历史记录中「只断开 CDP」「保留窗口」「匹配但无响应也不杀进程」的旧收尾规则；连接前对其它 profile 的隔离校验、发布授权及草稿限制继续有效。

## 2026-11-13 端口核验修复

监听查询使用 netstat -ano -p tcp，按唯一监听 PID，经 PowerShell UTF-16LE EncodedCommand 执行定点 Get-CimInstance -Filter，读取进程名与绝对 user-data-dir；按原始字节收集后解码，避免中文路径乱码。不枚举全部进程，不输出完整命令行；之后再次 netstat 核对 PID 未变化。进程非 Chrome/Edge、元信息不可读、路径相对/不匹配、多 PID、监听变化均失败，不会返回 PID-only/profileUnverified 成功。PUBLISH_SKIP_PROFILE_VERIFY=1 是硬错误，不是诊断开关。CDP /json/version 不作为 profile 证据。失败不接管其它 profile、不清理登录态；无监听才启动原 profile。ai=9333，house=9334，公众号=9335；身份校验和提交保险丝不变。

## v0.8.0 GitHub 手机阅读布局（当前默认，优先于下方历史说明）

GitHub 热榜以图片为阅读主体，不再把 10 条完整简介和总评堆在正文里。`type: github-ranking` 或启用 `githubIntro` 的任务在 `readJob` 阶段自动采用以下规则，每天都生效，不依赖当天 job 的特殊处理。

- 正文：一句主线判断，空行，前 3 项，每项一个独立条目（序号、完整 owner/repo、今日 +N、一句极短简介），条目之间空行，末尾「完整N个项目见图」。长仓库名自然换行，不硬截仓库名。正式话题仍由平台下拉选择，预览核对真实话题 ID 和高亮。
- 主线可用 `githubLayout.mainLine` 指定；否则取原正文「我的看法」的第一句。前 3 项取 `githubIntro.projects`（其次顶层 projects）的 repo/today/intro，可用每项 `bodyIntro` 提供更短且不改事实的表述。缺少数据返回 USAGE，不编造；短正文加话题仍超限也停止，不截断。
- 完整 `appendix` 转详情图，原正文的完整「我的看法」迁到最后一张详情图的总评区。无附录则保留原正文全文转图。原 content 仍保存在 contentOriginal，原稿文件不覆盖。GitHub 的 caption 不绕过短正文规则，旧 caption 如有不同则一并迁入详情图。
- 首图默认 1242×1660，浅底深字、绿色序号、棕色今日增量、清楚的分隔线。10 项均保留序号、完整仓库名、今日 +N、原中文简介；仓库 39px、简介 37px、增量 37px；允许自然换行，禁止省略号和裁字。移除压缩阅读空间的语言角标；语言仍在详情元信息里保留。显式 width/height 仍可用，但放不下即 RENDER_FAILED。
- 详情默认 1242×2080，每页 2 项，保留全文，按「仓库名 → 语言/总 star/今日增量 → 是什么 → 适合谁 → 我的看法」分层，项目之间有分隔。页幅加高用于同时保留两项全文和大字，避免靠小字号塞入 1660 高度。正文从 44px 开始测量，最低 40px，行距 1.4；最后一页可附完整总评。两个项目在最低字号仍放不下即 RENDER_FAILED(8)，不删内容、不继续缩字、不用旧图或空图。
- 没有可识别的编号项目附录时沿用原来的无损分页，不假造「是什么/适合谁/看法」。一般文章（如科技24小时）保留原通用分页；后续改为短正文时也要保留完整事实与观点到图，本次不改科技24小时的写稿规则。
- 图片和正文均去除 URL、裸域名路径、蓝V标签；保留无域名的 owner/repo。来源只写名称。字体可用性、替换乱码字符、实际 DOM 边界在截图前检查；机器检查不能替代亲自打开每张图和手机宽度预览。
- 顺序为总览 → 详情 → 用户配图；总数≤18，超过返回 USAGE。纯本地渲染只启动独立临时 profile 的 headless Chrome、随机端口，显式拒绝 9333/9334/9335，不操作任何已登录浏览器。
- 用户只要效果图时，保持 submit:false，只运行本地渲染，不运行 status/post/inspect/login，不接触已公开笔记。模拟图中的蓝色话题只是设计效果，不能声称已做平台下拉与高亮核验。

实现：`scripts/lib/util.mjs` 的 `githubReadingBody` / `readJob`；`scripts/lib/overflow.mjs` 的双项目全文分页；`scripts/render-github-intro.mjs` 的无裁字总览；`scripts/lib/local-renderer.mjs` 的隔离渲染。旧文件已逐个备份为 `.before-layout`。

11.12 离线样稿：`D:\AIInfra\publish-jobs\2026-11-12-github-layout\`，包括 short-body.txt、6 张图片、phone-preview.png、render-result.json 与 RESULT.md。正文220个 Unicode 字符（含空白，不含正式话题），话题预留22，共242/1000；详情实际44/41/44/44/40px。项目与净化链接后的详情全文一致，观点不改写。手机预览只模拟排版，不代表平台预览、话题核验或发布。

以下 v0.5–v0.7 的实测和规则是历史记录；涉及 GitHub 正文、字号与图尺寸时以本节为准。

## 2026-11-11 日期查重修正

任务可显式设置 `date: "YYYY-MM-DD"`。设置后，提交前及发布后核验按完整标题和可见发布日期共同查重，昨天的同名笔记不算今天已发布。同名笔记无法读到日期时返回 `PAGE_CHANGED`，停止而不猜测。未设置 date 的任务保留原有按标题查重行为。

零依赖 CLI：用 Chrome DevTools 协议驱动本机 Chrome，独立 profile 保存登录态。
不装 playwright，不碰后台接口，就是「像人一样打开发布页、填内容、点发布」。

## 2026-11-10 全自动发布（v0.5.0）

根因（已修复）：图文流程的 `submit()` 原先按文字依次找「发布笔记 / 发布 / 立即发布」。创作者左侧栏按钮就叫「发布笔记」，脚本点到它后只展开菜单并进入空白「上传视频」页，真正的表单「发布」按钮（闭合 shadow DOM，须走无障碍树）根本没点到。随后只在页面正文里等「发布成功|已发布|笔记已提交|审核中」，60 秒后报 `PUBLISH_FAILED`。失败截图可见侧栏「发布笔记」是展开的。草稿箱里同名稿是离开预览页时的本地自动保存，不是发布成功。

现行规则：

- 只点击表单底部「发布」或「立即发布」（优先 AX 树，取页面最下方的按钮），**绝不点击侧栏「发布笔记」**。出现「确认发布 / 继续发布 / 我知道了」等弹窗会尝试关掉或确认。
- `--submit` 时，填写前先到笔记管理「全部」和「审核中」按完整标题核验；已有同标题则跳过，返回 `alreadyPublished: true`，不重发。
- 点发布后最多等 120 秒，成功信号包括：发布成功/提交成功等提示、跳转到笔记相关 URL。若页面回到空白上传入口，或超时，会自动再去笔记管理/审核中按标题核验；命中即视为成功并尽量返回链接。都找不到才报 `PUBLISH_FAILED`。不要盲目重发。
- 标题超过发布页20字计数时自动按规则压缩，仍超限返回USAGE，绝不硬截断；返回titleOriginal/titleFinal/titleCompressed/titleRule。无配图走「写长文」文字卡片链路。
- 端口：`ai=9333`，`house=9334`，公众号默认 **9335**（不再和 house 抢 9334）。端口被其它 profile 占用时返回 `BROWSER_FAILED` 并说明实际 profile，**不会结束**正在登录的 house 或其它浏览器进程。
- `LOGIN_REQUIRED` / `ACCOUNT_MISMATCH` 仍然立即停止；不读取、不显示 cookie/token/凭据。


## 交稿后先按平台改稿（执行者必做）

本节是执行本 skill 的 Agent（通常是 Codex）的操作要求。交来的稿件经常是同一份源稿，多为 X 帖风格；脚本只做外链转述（`sanitizeLinks` / `linkPolicy`）、话题自动加 `#`、标题规则压缩、超长转图等机械处理，不会按平台重写标题、语气和结构，不能代替以下改稿步骤。

1. 收到稿件后、调用脚本填写或发布之前，必须先把源稿改写成「小红书版本」。
2. 将改写结果写成单独的任务文件 `job.xhs.json`，放在原稿旁边，不要覆盖原稿，再调用脚本。
3. 向调用方报告改了什么，包括标题、结构、删除的 X 痕迹、话题和外链转述等。
4. 默认只改形式，不改事实、数字、观点和结论。若原意本身包含站外推广，实质删除 CTA 或改为中性报道须在用户授权内完成，否则先给修改建议并停止；不能仅去网址、换品牌暗号或转图保留相同意图。若篇幅或平台限制导致不砍含义就放不下，同样停止并报告，不依赖脚本截断。
5. 若交来的已经是小红书专用版本，只需核对限制并做最小修正，不要再大幅重写。

小红书改稿规则：

- 标题 ≤20 字，做成钩子式标题。超限按规则压缩，仍超限返回 USAGE；可用 xhsTitle 覆盖，禁止依赖平台静默截断。
- 正文用短段落，可少量使用表情；有图时正文 ≤1000 字。纯文字长文上限仍按后文「平台限制」，脚本约 10000 字；发布页正文框的 1000 字限制也须核对。
- 正文和 caption 不能出现 URL，也不能留下去掉 https 之后的域名路径（如 cnbc.com/2026/11/09/...）。脚本默认 `linkPolicy: strip`，发布前自动删除这类文本，并清掉空的「链接：」行。不含域名的 `owner/repo` 仓库短名保留。不要用「链接见评论区」掩饰 URL。
- 去掉 X 平台痕迹：`@handle`、`RT`、帖串标记（如 `1/5`）和仅适用于 X 的措辞。
- 写 3–8 个相关话题到任务文件的 `topics` 字段，不要在正文里把 `#AI` 写成纯文本。禁止蓝V相关话题（`#蓝V交友`、`蓝V互关` 等，那是 X 专用的）；脚本会自动删掉含「蓝V」的标签，并按正式话题插入（输入 # 后从下拉选择或点「话题」按钮），发布前在预览里核对话题已高亮。
- 正文开头不要重复标题；脚本会自动去掉与标题相同的首行。
- 按账户调整语气：`ai` = AI/科技口吻，`house` = 杭州房产口吻。不确定账户就停下来问 Liu，不要猜。


## house 房产图文配图：介绍图永远第 1 张，官方图与真实地图放第 2、3 张（Liu，2026-11-13 更新）

适用于房产号 house（「杭房有趣说」，redId 94587684568）的每一篇图文，包括土拍、挂牌出让、挂地，以及其他规划、规划公示类帖子。**本节替换今天上午「第 1 张必须是官方位置示意图或官方原图」及「两类图固定前两张」的旧规则。改的是顺序、取舍和数量，土拍、挂地必需图门槛仍然有效。** 本节由执行者人工核对，不代表脚本已自动识别图类、可读性或顺序。

1. **第 1 张永远是介绍图或封面**，用于介绍主题；不要再用官方示意图占用第一张。已有合适介绍图时直接使用，例如 `01_cover.png`。
2. **第 2、第 3 张优先放一眼能看懂的官方图**，例如官方位置示意图、地块红线图、清楚的规划公示图。
   - **土拍、挂牌出让、挂地类：至少要有一张能看清地块位置的图**，放在第 2 或第 3 张即可，不再要求官方原图与真实底图两张齐备。来源优先级：官方公告及附件 → 机构图（杭州日报、都市快报、浙报传媒地产研究院、克而瑞、中指院等）；**不得使用个人账号、自媒体、项目软文配图**。仍须标注「示意图，以官方红线为准」。
   - 其他规划、规划公示类：有易读官方公示图就放第 2、第 3 张；缺少易读官方图时再用真实地图位置图，不为了填满两个位置而加无用图。此回退不适用于土拍、挂地必需官方原图的门槛。
3. **排除密集扫描件**：整页文字很密的「建设用地规划条件（土地储备专用）」表格、周边市政设施示意图、出让须知和其他密密麻麻的文字页，不放进第 2、第 3 张，也不往后追加凑数。原文件可留在本地来源档案，不能因其“官方”就全部上传。
4. **不要多：建议总共最多 4 到 5 张，通常控制在 4 张，最多 5 张。** 第 4、5 张仅在确实增加必要信息时保留，例如清楚的官方现场照；不为了凑数加指标图、数据图或扫描件。不足 4 张无需补齐，平台 18 张上限不是 house 的配图目标。
5. **官方原图来源与真实地图要求**：土拍、挂地必须亲自打开规资局、浙江省自然资源智慧交易服务平台等官方公告或附件，取得本宗地、当次版本的一眼能看懂的区位/红线原图，保留未改动原文件。来源清单记录公告标题、发布机关、页面及附件地址、获取时间和对应地块；媒体转载、其他版本图不得冒充当次官方原图。真实地图须注明天地图、高德等底图来源及「示意图，以官方红线为准」；位置、范围依据官方红线/四至核对，无法确认精确边界时只作位置提示，不伪装成测绘红线。完整来源地址留在本地，正文不放网址或域名。
6. **缺图即停止**：土拍、挂牌出让、挂地类任一必需图缺失、不清楚、来源/地块/版本无法确认，均不得预填、上传或提交，不得用封面、指标图、数据图、密集扫描件替代。在 `publish_result.json` 记录已核验来源、缺图及原因，`submit` 保持 false。
7. **最终顺序验收**：更新 `job.images` 后逐张打开本地图，核对第 1 张介绍主题，第 2、3 张图类与来源正确，排除了密集扫描件，总数控制在 4–5 张以内。自动生成的详情图、指标图也不能挤占这三个位置或额外凑数。预填/提交前核对实际有序上传清单与预览；无法保证则停止。发布/编辑结果记录有序图片、来源及截图。
8. 修改文稿、任务文件和 skill 均使用无 BOM 的 UTF-8；仅执行已授权账号与操作，不读取或输出 cookie、token、localStorage 或登录凭据。

### 已发布/审核中笔记的图片调整

仅在 Liu 授权后，从笔记管理找到原笔记的「编辑」入口，在原笔记编辑页调整图片并保存；标题、正文和话题按授权范围保持原样。不得调用 `post` 重发来代替编辑，不得删帖。没有编辑入口、编辑页不支持删图或排序、保存失败时立即停止，记录原因。保存前后记录原笔记 ID、图片清单及截图，读回成功提示并重新打开同一笔记核验图片、标题、正文和话题。浏览器保留、扫码与收尾按本次明确授权及执行规则处理，不自动登录。

## 规则清单（必须写在脚本里，不能只改当天 job）

以下规则由脚本自动执行，并在本文件说明。今天的稿件只用来验证，不要把规则只写进某一份 job.json。

| 规则 | 实现位置 |
|---|---|
| 发布前去掉 URL 和域名路径（默认 `linkPolicy: strip`），清掉空的「链接：」行；`owner/repo` 短名保留 | `scripts/lib/util.mjs`：`sanitizeLinks`、`collapseLinkShells`、`readJob`；本文件「外链 / 链接规则」 |
| 去掉含「蓝V」的话题和正文标签，保留 `#AI` 等通用标签 | `scripts/lib/util.mjs`：`filterTopics`、`stripLanVTags` |
| 正文里的纯文本 `#标签` 行先删掉，再按正式话题插入 | `scripts/lib/util.mjs`：`stripHashtagLines`；`scripts/lib/xhs.mjs`：`insertOfficialTopics`、`verifyTopicsHighlighted`、`fillBody`；长文发布页同样走这两步，不再把 `#AI` 整段粘贴后再 Escape |
| 输入 `#` + 关键词，从下拉选择或点「话题」按钮；预览里必须看到话题高亮才算插入成功 | 同上 `insertOfficialTopics` / `verifyTopicsHighlighted` |
| 正文首行与标题重复则自动去掉 | `scripts/lib/util.mjs`：`stripRepeatedTitle`（在 `readJob` 中调用） |
| 标题按页面计数，超20字规则压缩，保留栏目及日期；仍超限USAGE，禁止截断 | `scripts/lib/util.mjs`：`titleLen`、`compressTitle`、`readJob` |
| 超长正文及appendix按项目转1242×1656详情图，单项仅超整页才标续；总图数≤18，溢出RENDER_FAILED(8) | `splitBody`、`scripts/lib/overflow.mjs`、`scripts/render-overflow.mjs` |
| 话题候选轮询8秒，删除查询重输至多一次；精确名称、排除创建项，失败瞬间截图+inspect | `insertOfficialTopics`、`verifyTopicsHighlighted`、`captureFailure` |
| 点发布后多种成功信号 + 超时后到笔记管理/审核中按标题核验；120 秒超时 | `scripts/lib/xhs.mjs`：`submit`、`waitPublished`、`findPublishedOrReviewing` |
| 只点表单「发布 / 立即发布」，绝不点侧栏「发布笔记」 | `scripts/lib/xhs.mjs`：`submit` |
| 发布前按完整标题核验笔记管理/审核中，已有则跳过，返回 `alreadyPublished`，不重发 | `scripts/lib/xhs.mjs`：`publishImage` / `publishText` |
| 账户独立端口与 profile：ai=9333，house=9334；端口被其它 profile 占用只报错、不杀进程（尤其不杀正在登录的 house） | `accounts.json`；`scripts/lib/cdp.mjs`：`verifyBrowserProfile`、`launch` 复用同端口同 profile；本文件账户与端口节 |
| 每个账号只复用一个已有 Chrome 实例，不新开第二份同一 profile | `scripts/lib/cdp.mjs`：`launch` / `Page.open` |
| `LOGIN_REQUIRED` / `ACCOUNT_MISMATCH` 立即停止；不读不显示凭据 | `scripts/lib/xhs.mjs`：`assertAccount`；`scripts/xhs.mjs` |

无配图时走「写长文」文字卡片。`job.submit:false` 始终阻止提交。

## 账户选择（必须遵守）

**房产稿用 house，AI/科技稿用 ai；不确定该用哪个号就停下来问 Liu，不要猜。**

**代理：** 每个账户可在 accounts.json 设 `"proxy": "direct"`（默认）或 `"system"`。direct 时脚本启动的 Chrome 加 `--no-proxy-server` 直连（小红书走海外代理 IP 会被识别异常/跳 rednote），不改系统代理；只对脚本新启动的 Chrome 生效，已开着的实例要关掉重开才生效。

skill 根目录的 `accounts.json` 登记公开身份和路由，不放登录凭据：

```json
{
  "default": null,
  "accounts": {
    "ai": { "label": "AI/科技号", "dataDir": "xhs", "port": 9333, "expectedNickname": "TwoPeanuts", "expectedRedId": "7247802890" },
    "house": { "label": "房产号", "dataDir": "xhs-house", "port": 9334, "expectedNickname": "杭房有趣说", "expectedRedId": null }
  }
}
```

- `status/login/inspect/doctor` 必须给 `--account <别名>`，只有配置非空 `default` 才可省略。本配置保持 `default:null`。
- `post` 最终账户来自 `--account` 或 `job.account`；两者同时存在必须相同。两者都缺失、冲突、未知别名都在连接/启动浏览器前返回 `USAGE`。post 即使不提交也不使用 default；请求提交时同样必须显式确定账户。
- 所有命令支持 `--accounts-file <路径>`，覆盖默认的 skill 根目录配置；相对路径按当前工作目录解析。
- `dataDir` 是 `dataRoot()` 下的相对目录名（只允许字母、数字、下划线、连字符）；账户之间端口和 dataDir 必须独立。端口只从配置读取，不支持 `--port` 覆盖。
- 默认 `dataRoot() = %LOCALAPPDATA%\agent-publish`，也可由 `PUBLISH_SKILL_DATA` 指定；profile 为 `<dataRoot>\<dataDir>\chrome-profile`，截图/inspect 为 `<dataRoot>\<dataDir>\artifacts`。ai 保留原有 xhs 目录，house 使用 xhs-house，可同时运行。公众号 wechat-publish 默认端口改为 9335，不要再占用 house 的 9334。端口 profile 不匹配时只报错、不杀进程。
- Windows 连接前后核验监听端口的 PID（`netstat -ano -p tcp`），经 `Get-CimInstance Win32_Process` 仅提取该进程的 `--user-data-dir`，确认是 Chrome/Edge 且 profile 绝对路径匹配。复用和新启动都验证；不匹配或无法可靠读取就返回 `BROWSER_FAILED`，不继续操作页面。尚未实现其它平台的进程校验，其上直接拒绝连接。
- 不读取或输出 cookie、token、localStorage 或登录凭据，不自动登录、不输入密码；登录由用户自己运行 `login --account <别名>` 扫码完成。

## 发布前身份校验

每次 post（含不提交的预览）都先打开 `XHS.home` 创作者首页，从可见 DOM 读取昵称和小红书号；校验完成前不打开发布页、不上传、不填写任何内容。
未登录返回 `LOGIN_REQUIRED`；昵称读不到、与 `expectedNickname` 不符、期望昵称未配置/为空，或者非空的 `expectedRedId` 读不到/不符，均返回 `ACCOUNT_MISMATCH`（退出码 7），消息包含期望值和实际值。
昵称要求精确相等（仅去除首尾空白）；多个身份昵称冲突时也拒绝。小红书号只有配置非空时才强校验。
`status` 只读，不操作笔记、不填写或提交；输出 `account/label/port/profile/loggedIn/nickname/redId/expectedNickname/nicknameMatches`，以及小红书号匹配情况。

## v0.5.1 同机双 profile 防认错

路由配置在连接浏览器前强制校验：`ai=9333+xhs/chrome-profile`、`house=9334+xhs-house/chrome-profile`，即使传入自定义 accounts 文件也不得互换。每次复用先按端口查监听 PID，再校验该进程的 `--user-data-dir`；不匹配或无法确认即 `BROWSER_FAILED`，不杀进程。新启动 ai 保持 direct / `--no-proxy-server`，不设置 HTTP(S)_PROXY。

`status` 与 post 都调用 `assertAccount`：读取创作者首页可见昵称及小红书号，ai 必须对应 TwoPeanuts / 7247802890；身份缺失或不匹配立即 `ACCOUNT_MISMATCH`，不继续填写。house 不因其它账号检查而重启、关闭或接管。本次仅修逻辑并核对 ai 身份，不执行任何小红书 post。

## 快速上手

```powershell
$S = "C:\Users\Mayn\.dsh\skills\xhs-publish\scripts"

node "$S\xhs.mjs" preflight --job job.json --kind post  # 先本地审阅，待审项解决前停
node "$S\xhs.mjs" doctor --account ai        # 预检完成且已获浏览器授权后再自检
node "$S\xhs.mjs" status --account ai        # 只读首页身份，不操作笔记
node "$S\xhs.mjs" login --account house      # 首次扫码，之后免登录
node "$S\xhs.mjs" post --job job.json --account ai  # 填内容不发布 → 看截图
node "$S\xhs.mjs" post --job job.json --account ai --submit  # 经用户确认且 job.submit 不为 false 才提交
```

stdout 只输出 JSON，日志走 stderr。

> **PowerShell 注意**：别用 `2>&1` 合并输出，否则 PowerShell 会把 stderr 当错误、把退出码
> 变成 1。用 `2>$null`，或者直接判断 JSON 里的 `ok` 字段。

## 两条发布链路

| `images` | 走哪条路 | 说明 |
|---|---|---|
| 空 | **源稿待本地制卡** | 0.9.0 标记 pendingGenerated；先本地渲染并逐张验收，缺少最终本地图时在浏览器前停止 |
| 有图 | **上传图文** | 1–18 张图，标题 ≤20 字，正文 ≤1000 字 |

以下仅为旧版纯文字链路的历史实测，**0.9.0 不允许在最终卡片未审时执行此路径**：

1. `publish/publish?target=article` → 点「新的创作」
2. 填标题（`textarea[placeholder="输入标题"]`，上限 64 字）+ 正文（`div.ProseMirror`）
3. 点「一键排版」→ 平台生成文字卡片（这一步要等 10–40 秒）
4. 点「下一步」→ 进入发布表单
5. 正文框再填一遍全文（默认用 `content`）+ 话题 → 点「发布」

> 长文形态下，卡片里的文字是图片，**笔记下方正文框是另一块可编辑区域**（上限 1000 字）。
> 所以脚本先离线检查正文；超限部分转本地详情图，有图即走图文链路，正文不截断。

## 外链与站外引导：工作流规则，不是审核保证

本工作流保守处理公开正文/卡片中的 URL、域名和站外联系方式，不把它们默认带入发布内容。这是本账号工作流的内容约束，不能据此推断每次提及链接或品牌都会被平台处罚。

`readJob` 的 `linkPolicy:strip` 仍负责机械净化；历史 `describe`/`keep` 参数仅保留兼容，不绕过推广风险 gate。`linkChanges` 记录发生了什么，不代表转换后就符合平台规则。来源地址保留在本地来源档案，不把净化后的站点名改成搜索/下载指路。

- 标题、正文和准备转图的原始文本都要先检查；不得以短正文干净为由忽略附录、caption 或图片。
- “去某平台搜”“直接换过去试”“评论区/主页领下载地址”等即使没有 URL，也需要处理实质引导。站内的正常讨论或查看合集，不仅凭“评论/主页”两个字就推断为站外导流。
- 品牌名、来源名、无域名的 `owner/repo` 可用于必要的中性事实描述，不自动定为违规；免费、价格、权益和比较结论必须有来源和适用条件，不能拼成无依据的安利。
- 不能把公开外链改成暗号、谐音、拆字、二维码、评论区/私信入口或转图继续指路。删除 CTA 或改成中性报道可能改变原稿意图，超出已有授权时先报告，不暗改观点。
- 当用户另行索取材料时按该请求单独处理；不在发布稿中预埋引导去主页、评论或私信取站外地址的路径。

## 任务文件（job.json）

```json
{
  "account": "ai",
  "title": "标题，小红书笔记上限 20 字",
  "content": "长文全文，可以写很多行\n换行用 \\n",
  "caption": "可选：发布页正文。留空 = 自动用 content 全文",
  "topics": ["GitHub", "开源"],
  "linkPolicy": "strip",
  "images": [],
  "submit": false
}
```

- 上面是源稿骨架，不是可直接发布的完整任务；`images` 为空时先本地制卡并逐张审阅，再提供最终图文任务。相对路径按 job.json 所在目录解析。
- 图文发布页写入最终 `content`（含正式话题≤1000字）；超限正文或附录迁入详情图时仍要全文审阅。不要为塞进正文框丢失原意。
- `caption` 是兼容字段，长文历史路径曾用它覆盖发布页正文，GitHub 路径也可能把它迁入详情图。它不是存放免审宣传文字的区域；实际字段如何展示以当前任务链路为准。
- `topics` 自动加 `#`；`submit: false` 是保险丝：命令行加 `--submit` 也不会发。用户确认后若要提交，需移除 false 或改成 true；job.submit:true 本身也会请求提交。预览务必保持 false。

## 命令与退出码

| 命令 | 作用 |
|---|---|
| `preflight --job <f> [--kind post|edit]` | 纯离线审阅推广风险与图片检查记录，不读账户配置、不连接浏览器；未解决项退出9 |
| `doctor --account <别名>` | 自检 Chrome、profile、端口 |
| `status --account <别名>` | 只读检查首页登录态及身份 |
| `login --account <别名> [--timeout 1800]` | 打开登录页等扫码，登录态落盘 |
| `inspect --account <别名>` | dump 发布页结构到 JSON（选择器排查） |
| `post --job <f> [--account <别名>] [--submit]` | 身份校验后填写；默认不提交，job.submit:false 始终阻止提交 |
| `edit --job <f> [--account <别名>] [--submit]` | 精确定位原笔记，只改显式 edit 字段/图片；原编辑路由保存并同ID读回，job.submit:false 始终阻止保存 |

| 退出码 | code | 含义 | 该做什么 |
|---|---|---|---|
| 0 | — | 成功 | 读 JSON 的 url / screenshot |
| 1 | `USAGE` | 参数错 / 标题压缩仍超20 / 总图数超18 / 保留正文仍超限 | 改job或给xhsTitle，不截断 |
| 2 | `LOGIN_REQUIRED` | 未登录 | 让用户自行跑 `login --account <别名>` |
| 3 | `PAGE_CHANGED` | 页面结构变了 | 跑 `inspect` 改选择器 |
| 4 | `UPLOAD_FAILED` | 图片上传超时 | 查格式/大小 |
| 5 | `PUBLISH_FAILED` | 发布被拒/按钮禁用 | 别盲目重试，看截图 |
| 6 | `BROWSER_FAILED` | 浏览器异常或端口/profile 核验失败 | 查 CHROME_PATH、账户端口和监听进程 profile |
| 7 | `ACCOUNT_MISMATCH` | 期望身份未配置、不可读取或不匹配 | 核对 accounts.json 与实际登录账户，停止填写/发布 |
| 8 | `RENDER_FAILED` | 本地渲染失败、PNG无效或自动分页后仍溢出 | 停止，不上传旧图或空图 |
| 9 | `CONTENT_REVIEW_REQUIRED` | 明确站外引导、未解决的推广语境、图片未审或记录已失效 | 看结构化审阅报告，实质改稿或逐项人工复核；不重试发布、不用布尔值跳过 |

## 五个必须知道的坑（都是实测踩出来的）

1. **「发布」按钮在闭合 shadow DOM 里**。`document.querySelectorAll` 和 `innerText`
   完全看不到它，只能通过无障碍树：`Accessibility.getFullAXTree` → 找 name=发布 的
   button → `DOM.getBoxModel` 取坐标 → 真实鼠标点击。代码在 `Page.clickByAx()`。
2. **「新的创作」用坐标点点不动**，得用 JS 派发 pointerdown/mousedown/pointerup/mouseup/click
   五个事件，见 `Page.clickJsByText()`。
3. **截图要求窗口在前台**。窗口被最小化或遮挡时 `Page.captureScreenshot` 会 30s 超时；
   代码里先 `Page.bringToFront`，失败再降级 `fromSurface:false`。
4. **一键排版后别用 `一键排版` 判断是否完成**——编辑器里那个按钮还在，会误判。
   要等页面出现「下一步」。
5. **小红书标题按半字计数**：ASCII英文/数字/空格/半角标点为0.5，中文/全角标点为1，总和向上取整；脚本超20先压缩，禁止截断。

## 平台限制

- 标题 ≤ 20 字（长文编辑框能写 64，但笔记标题仍受 20 字限制）
- 图文正文 ≤ 1000 字；纯文字长文可长得多（脚本给到 10000 字上限）
- 图片格式：jpg / jpeg / png / webp，单张 ≤ 32MB，最多 18 张
- 发布后进审核，通常几分钟到几十分钟

## 实现结构

```
scripts/xhs.mjs          CLI 入口（doctor/status/login/inspect/post）
scripts/lib/cdp.mjs      零依赖 CDP 客户端：启动 Chrome、页面操作、AX 树、截图
scripts/lib/xhs.mjs      两条发布链路 + 选择器
scripts/lib/util.mjs     账户配置、参数、预检、日志、账户目录
accounts.json           账户别名、端口、dataDir、期望身份
references/publish-page.md   实测的页面结构与选择器
references/troubleshooting.md 故障排查
```

账户数据目录：`<dataRoot>\<accounts[别名].dataDir>\`，每个账户独立保存 profile 和 artifacts；不移动/清空已有账户目录，不批量结束浏览器进程。

## 给 Agent 的建议流程

执行以下流程前，先按「交稿后先按平台改稿（执行者必做）」完成改稿，并在原稿旁写成 `job.xhs.json`。 house 每一篇图文均须通过上文配图门槛：第 1 张永远介绍图/封面，第 2、3 张优先易读官方图；土拍、挂地的官方原图与真实地图必须同时位于第 2、3 张。排除密集扫描件，建议总共最多 4 到 5 张；缺少必需图或无法保证顺序时停止，不进入预填、上传或提交。

1. 先对独立的小红书任务运行 `preflight`，审原稿、最终文本与完整图片；需生成卡片时先做隔离本地渲染、逐张看图并记录最终文件哈希。明确文本风险与已知图片待审解决前不运行浏览器命令、不上传测试；仅剩 pendingExisting/pendingGenerated 时，按已有授权只做相应只读核对或独立出图，最终 gate 仍必须在改写/上传前通过。
2. 根据稿件确定账户；仅在已获浏览器操作授权后用 `status --account <别名>` 检查实际昵称、期望昵称和小红书号。
3. 未登录 → 让用户自行跑 `login --account <别名>` 扫码，**不要尝试自动登录**。
4. job 中写入 account 并保持 submit:false；`post --job <f> --account <别名>`（不带 `--submit`）→ 核对有序图片、完整正文及真实话题，给用户看截图。预填也会上传内容，不能作为绕过预检的试验。
5. 用户确认账户和内容并授权发布后，才移除 job.submit:false 或改为 true，再执行 `post --job <f> --account <别名> --submit`；审阅通过不等于自动获得发布授权。
6. 交付返回的 URL/截图及明确状态。发布或原笔记保存成功、平台审核通过、推荐/搜索恢复是三个不同结论；历史处罚页面不能证明后两者。

出现 `PAGE_CHANGED` 不要重试，先 `inspect` 看结构变了什么。

## 2026-11-10 本次实测修正

正式话题使用真实 `#` 按键事件触发候选框，选择 `.item .name` 中已有话题，不接受新建话题或纯文本回退。核验必须读取编辑区 `a[data-topic]` 的非空话题 ID、名称及高亮色，忽略隐藏的 `[话题]#` 标记。平台现有 AI 话题的规范名称为 `ai`，名称匹配不区分大小写；预览截图需看到蓝色话题。

## GitHub 热榜项目简介图（v0.6.0）

job 含 `githubIntro` 对象，或 `type:"github-ranking"` 且有顶层 `projects` 时，主流程先本地生成简介 PNG，再连接发布浏览器。`githubIntro.projects` 优先于顶层 `projects`；不从正文猜测简介。`githubIntro.enabled:false` 关闭生成。

默认尺寸 `githubIntro.width/height = 1242/1656`；可设 `title/subtitle/footer`。输出默认在 job 同目录 `gh-intro-<YYYY-MM-DD>.png`，日期取 `githubIntro.date`、`job.date` 或本机当天；`githubIntro.out` 可指定绝对路径或相对 job 的 PNG 路径。

生成图成为 `images[0]`，其余配图顺延，自动走图文链路。完整 content 不截断；超出正文上限的部分及 appendix 自动转详情图（见v0.7.0）。仍按原规则去 URL、蓝V、重复标题，从下拉插入正式话题并核验高亮。

intro 从原稿提炼为一句话，约≤25字（中英混排注意实际宽度），不编造、不放链接。repo 用 owner/repo 短名；rank/lang/today 保留原榜数据。渲染器会移除 URL。

```json
{
  "account": "ai",
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

RENDER_FAILED 的退出码为8。


## v0.7.0 标题压缩 / 正文超长转图 / 话题选取修复

标题先按实际发布页计数：ASCII（英文、数字、空格、半角标点）每个0.5字，其它UTF-16单元每个1字，总数向上取整。2026-11-11实测：21个中=21/20，21个A=11/20，21个1=11/20，21个空格=11/20，`中AB12 Z`=4/20；原题页面为22/20。emoji采取UTF-16保守计数。先去日期括号、将年月日缩为M.D，再去「今天最火的/今天最值得知道的/今日/今天/的」等可省词，日期移到栏目后。必要时「N个开源项目」缩成「开源N选」。保留栏目、日期、数字及含义，绝不slice标题；仍超20即USAGE。显式xhsTitle直接校验，超限同样USAGE。

`readJob`接受content或unifiedPost，先清理链接、蓝V和纯文本标签行。正文超bodyLimit（默认1000，含话题预留）或带appendix时，保留榜单和「我的看法」，其余整段移到图；如果保留部分仍放不下则USAGE，要求完整且较短的正文。普通长文按完整段落移图，单段超限可全部放图。把「每条详细介绍和链接见评论」改成「每个项目的详细介绍见图」。附录里的数字、观点和原文内容除链接/标签形式处理外不改；job内appendix仍保存输入原文。

图片为1242×1656，微软雅黑34px正文、栏目+日期抬头、总页码。先按项目分块贪心排页，只有单项目超一整页才允许分续页。续页二分测量最大可放内容并优先句末/段末分割，保留全部字符。DOM测量布局及截图前再次检查尺寸/边界，仍溢出返回RENDER_FAILED(8)。URL专行删除，owner/repo保留；正文里的裸域名去顶级域名和点转成「站点」称呼，避免残句，不生成链接。图片不含蓝V或#标签行。

主流程先prepareOverflow，再prepareGithubIntro，最后才连接发布浏览器。一般任务的上传顺序：简介图→详情图1..n→用户额外配图，总数超过18返回USAGE。house 图文优先满足上文现行规则：介绍图/封面第 1 张，易读官方图及地图第 2、3 张（土拍、挂地两类缺一不可），排除密集扫描件，建议总共最多 4 到 5 张；通用自动分页不得打乱该顺序或额外凑图，无法保证则停止。详情图由独立临时profile和随机CDP端口渲染，显式拒绝9333/9334/9335，只结束本函数启动的Chrome。简介图沿用同样的隔离机制；本日页码1/11至11/11。

话题输入真实#按键后输入关键词，每次轮询最多8秒；精确匹配名称（兼容平台AI规范名称ai，忽略大小写），排除「新建/创建」行。未出现则在能确认查询串时只删除该串并重输一次。选中已有候选后，必须核对编辑区a[data-topic]的非空且非newTopic_Id话题ID和高亮色。失败在导航前保存候选框截图及可见DOM inspect，返回PAGE_CHANGED(3)，停止；不通过纯文本回退。不重试post；调试查询结束清空测试内容。

新增或明确的job字段：

| 字段 | 类型/含义 |
|---|---|
| xhsTitle | 可选字符串；发布标题覆盖，仍须≤20发布页计数字 |
| appendix | 可选字符串/字符串数组；按项目或段落全部转图 |
| bodyLimit / limits.body | 可选1..1000整数；正文与正式话题合计上限 |
| overflow.outDir | 相对job目录或绝对目录，默认out |
| overflow.prefix | 文件名前缀，默认xhs_overflow_MMDD |
| overflow.heading | 详情图栏目名，默认原题栏目 |
| duplicateTitles | 提交前也按完整标题+date查重的旧标题数组 |
| githubIntro.pageNumber / totalPages | 自动填写简介图页码及总图数 |

结果JSON增加titleOriginal/titleFinal/titleCompressed/titleRule/titleCount、bodyCount、images（有序完整路径）、overflow（pages/path/page/total/overflow/font/text）、topicVerification。退出码1=不能无损满足输入限制，8=渲染失败或仍溢出；其它退出码不变。

独立生成（不连接登录浏览器）：

```powershell
node scripts/render-overflow.mjs --data <job> --out-dir <dir>
```

零依赖离线可调用readJob/compressTitle/titleLen/splitBody/detailBlocks；主流程上传前自动生成全部图片。发布仍须精确校验TwoPeanuts/7247802890，LOGIN_REQUIRED/ACCOUNT_MISMATCH立即停。job.submit:false保险丝、完整标题+date查重、仅表单底部发布、direct直连、不读凭据、不动house9334/PID25828和公众号9335、一次只跑一个任务等原规则继续有效。已有本会话自动发布授权时，完成预览验收后按授权提交一次，无需重复请求授权。


### 2026-11-11 本次实测结果

原题「GitHub热榜｜今天最火的10个开源项目（11.11）」计22字，规则压缩为「GitHub热榜｜11.11 10个开源项目」计15字（22个原始字符，未硬截断）。正文874个Unicode字符，页面插入正式话题后显示877/1000。已有正式话题规范名为ai、GItHub、开源，均按忽略大小写精确匹配，编辑区与预览区均有真实ID及蓝色高亮。11图已逐张检查。2026-11-11 09:03只点一次表单发布，页面显示发布成功；笔记管理全部及审核中均命中同标题同日笔记，最终审核中，页面未给出笔记URL，未臆造链接。job.submit已恢复false。单项超长续页测试4页且全文一致；19张图返回USAGE；无法容纳的单项标题返回RENDER_FAILED。未连接/关闭9334、9335。

## 内容要亮眼（2026-11-15，Liu 明确要求）

- **标题先给冲突或结果，不描述栏目**：反例「飞书应用删除教程」，正例「飞书应用删不掉？先停用再删」。
- **第一段必须说清「卡在哪 / 值不值得看」**，不要从背景讲起。
- **教程类用本人实操截图**，每一步一张卡：步骤号 + 截图 + 3–4 条要点；截图里的红框保留，那是可信度来源。
- 卡片要有页眉（标题/日期/栏目）和页码，缺了会像随手拼图。
- 不写空话（「非常实用」「建议收藏」），只写具体动作和具体坑。

## 小红书草稿怎么存（2026-11-15 实测，可直接照做）

**结论：不用点任何保存按钮。填好内容后直接关闭/离开页面，草稿自动保存。**

操作顺序：

1. `node scripts/save-draft.mjs <job.json> <out.json>`——内部用 `ensureBrowser → gotoPublish → uploadImages → fillTitle → fillBody` 把图文笔记填完，然后直接退出；不要点「发布」。
2. 页面一关闭，小红书就把这份内容写进草稿箱（服务端按浏览器 profile 存，不是本地文件）。
3. 验证：打开 `creator.xiaohongshu.com/publish/publish`，点右上角 **草稿箱(N)** → 切到 **图文笔记** tab，第一条就是刚存的，带「编辑／删除」。

注意：

- 网页端**没有「存草稿」按钮**，找不到按钮不是页面异常；之前误判成「只能 App 存」是错的。
- 草稿绑定**当前浏览器 profile**（由 `PUBLISH_SKILL_DATA` 决定），换 profile 或清缓存就没了；确认用的是 `C:\Users\Mayn\AppData\Local\agent-publish\xhs`.
- 每填一次就多一份草稿，反复调试会积出多份同名稿。清理：`node scripts/dedupe-drafts.mjs "<标题关键字>" 1`（保留最新一份，删掉其余）。
- 草稿箱分四个 tab：视频笔记／图文笔记／长文笔记／播客笔记，图文笔记才是我们要的。