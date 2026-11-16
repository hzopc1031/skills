---
name: x-publish
description: >-
  用本机 Chrome 把内容真实发布到 X（Twitter），不是草稿。
  当用户要把帖子发到 X、Twitter，或排查 X 发帖失败时使用。发布后必须读回确认，未确认则报错。
metadata:
  version: "0.1.0"
  status: "v0.1.0：独立 profile 9336；status/post 两个命令；默认只填不发，--submit 才真发；发后读回 toast 或 URL"
  runtime: "node >= 20"
---

# X（Twitter）发布

固定环境：

- 端口 **9336**，profile 在 `<PUBLISH_SKILL_DATA>/x/chrome-profile`（默认数据根 `D:\AIInfra\agent-publish`）。
- 入口 `scripts/x.mjs`，只用本机 Chrome + CDP，不依赖第三方库。

## 命令

```powershell
# 是否已登录
node <本skill>\scripts\x.mjs status

# 只填入、不提交（默认）
node <本skill>\scripts\x.mjs post --job <job.json>

# 真发
node <本skill>\scripts\x.mjs post --job <job.json> --submit
```

`job.json`：

```json
{ "text": "≤280 字正文", "images": ["可选：本地图片，最多 4 张"] }
```

退出码：`0` 成功；`2` 用法/文本超长；`3` `LOGIN_REQUIRED`；`4/5` 发帖框异常；`6` 找不到 Post 按钮；`1` 浏览器异常。

## 关键实现细节（实测得出）

- 发帖框选择器：`[data-testid="tweetTextarea_0"]`，先 `focus()` 再按坐标点击，然后 `Input.insertText` 一次写入（不要逐字符敲，X 的富文本会丢字）。
- Post 按钮：`[data-testid="tweetButton"]` 或 `[data-testid="tweetButtonInline"]`，取可见那个的矩形中心点击。
- 成功判定：出现 `[data-testid="toast"]` 且文案含 `Your post was sent`，或 URL 回到 `/home`、进入 `/status/`。两者都不满足视为失败，**不要当作已发布**。
- 长度校验按 X 计权算：中日韩字符算 2，拉丁算 1。默认上限 280；账号是 Premium，可用 `--max 2000` 放开长文（实测 700+ 计权值正常发布）。
- 登录态：profile 独立，首次需要在这个窗口里登录一次；之后长期有效。读取用户主 Chrome 的 Cookies 不可行——Chrome 运行时对 Cookies 加独占锁，复制会失败。
- **X 必须走代理，小红书和公众号直连**：启动参数加 `--proxy-server=http://127.0.0.1:12334`（取 `X_PROXY`，没设就回落到系统代理）。
- 上一次如果留下半开的发帖框，再导航会 `Page.navigate` 超时；发帖前先按两次 Esc 关掉。
- 字符计权：中日韩字符按 2 算；默认 280 上限，Premium 账号用 `--max` 放开。

## 与其他平台的衔接

- 这是**真实发布**，没有草稿箱兜底；`job.json` 先过一遍长度与事实核对再 `--submit`。
- 每日流程里每个栏目一条：小红书 → 公众号草稿 → X。X 文案与小红书标题同源，但要重写成适合 X 的说法（首句给结论、带具体数字或仓库名）。

## 配图与清理

- **一条只配一张 1600×900 横图**。手机端两张竖图并排会缩成看不清的小图，一张横图占位更大、字也看得清；多页留给 thread 或公众号。
  生成：`node <本skill>\scripts\render-x-card.mjs --spec card.json --out card.png`
  `card.json`：`{kicker,date,title,lead,bullets:[{name,num,desc}],source}`，bullets 最多 5 条，超出会挤。
- 发帖时在 job 里加 `"images": ["card.png"]`，最多 4 张；X 里单图按 16:9 展示，1600×900 不会被裁。
- 文案：**第一行必须是结论**，不要重复标题（手机只显示三行，标题占掉一行就没人看下去）；正文 3–5 行说完，长文会被「显示更多」折叠。清单类内容（五个仓库、八条热点）走 thread：主帖一句话＋一张横图，其余每条回复一个条目。
- 删帖：`node <本skill>\scripts\delete-post.mjs "<正文前缀>"`。**必须先 `scrollIntoView`**——时间线上的推文常在视口外，直接按坐标点会点到空气（这个坑踩过）。
- 想改已发内容：1 小时内可用推文的「Edit post」，超过就删了重发。

## 内容要亮眼（2026-11-15）

- 第一行给冲突或结果，不重复标题：反例「飞书应用删除教程」，正例「飞书应用删不掉？因为你先找错了地方」。
- 教程类配本人实操截图（最多 4 张），每张能独立看懂。
- 只写具体动作和具体坑，不写「建议收藏」这类空话。

## X Article（长文，图片可插正文中间）

普通 Post 只能把图排在正文后面；要图文混排必须用 Article。

入口：侧边栏 **Articles** → `x.com/compose/articles`（Drafts / Published 两个页签，右上角蓝色 **Write**）→ 编辑器 `x.com/compose/articles/edit/<id>`，标题是 `textarea`（placeholder「Add a title」），正文是 Draft.js 的 `[contenteditable=true]`，右上角 Preview / Publish，**自动保存**（页面显示 Last saved）。

### 正文怎么写

脚本 `scripts/write-article.mjs`：填标题（`Input.insertText`）→ 点正文区 → 逐块 `Input.insertText` + 回车。段落文字可靠，图片要单独插（见下）。

### 封面（5:2，1500×600）

1. 点正文顶部灰色占位区（提示 "We recommend an image with a 5:2 aspect ratio"）
2. 用 `DOM.setFileInputFiles` 塞进页面上的 `input[type=file]`（这是**封面专用**的那个，`querySelector` 取第一个）
3. 弹出「Edit media」裁切框，**必须点右上角 Apply**，否则只是预览不落地

### 正文插图（这是 Article 的核心价值）

1. 光标点到目标段落末尾，先按一次回车留位置
2. 点工具栏 **Insert** → 菜单里点 **Media**（菜单项依次是 Media / GIF / Posts / Link preview / Divider）
3. 用 `DOM.querySelector('input[type=file]')` 取**第一个** nodeId（实测第一个才是媒体上传口，取最后一个会没反应）
4. `DOM.setFileInputFiles` 塞图，等 6–8 秒
5. **不需要 Apply**，图直接落在光标处（悬停出现 Edit 按钮）

### 两个必知坑

- 封面和正文用的是两个不同 file input，塞错不会报错、只是没反应，必须靠"第一个 / 最后一个"区分。
- 连续插多张时，Insert 菜单可能因上一次没关闭而展开失败（返回 no-media）。每插一张前按 Esc 关菜单，或刷新页面重新定位光标。

判定成功：`document.querySelectorAll('[contenteditable=true] img').length` 增加，且截图上能看到图。

## X 封面规范（2026-11-16 加，踩过两次）

封面是整篇文章最显眼的一屏，**必须是设计图，不能直接拿 UI 截图顶上**。

- 尺寸 1500×600（5:2）。左边大标题（≤14 字，给冲突）+ 一行副标题，右边放**截图局部**当证据，底部一行署名。
- 只放一张截图当封面 = 不合格：裁切后只剩界面中间一块，还带着 Edit / × 悬浮按钮（真实翻车案例）。
- 判断标准：缩到 200px 宽还能读出「这是什么、为什么点」。

换封面（已有封面时，占位提示会消失，不要再找 `5:2 aspect ratio`）：

1. 鼠标移到现有封面上 → 出现 **Edit** 按钮 → 点它
2. 塞新图（`DOM.setFileInputFiles`，用第一个 file input）
3. 「Edit media」裁切框里点右上角 **Apply**

## 插图排版（2026-11-16 加）

- **插图前不要预先按回车**。光标停在段末直接 Insert → Media，图片块自带间距；多按一次回车会在段落和图片之间留出一大块空白（本篇就留了，用户手动清掉的）。
- 插图用的 file input 是**第一个**（`DOM.querySelector`），不是最后一个；取最后一个不会报错、只是没反应。
- **验证必须截图**：`document.querySelectorAll('img')` 在 X 编辑器里几乎恒为 1，不代表没插进去。判据是滚动到目标段落截一张图，肉眼确认图在对应文字下面。
- 一次插一张，插完等 10 秒以上再插下一张；中途按 Esc 会把正在上传的图撤掉。
