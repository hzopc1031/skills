# 发布页结构（2026-11-07 实测）

小红书创作服务平台是 Vue SPA，class 名带 hash，选择器一律用**语义属性**（placeholder、
文字、AX 树），不要依赖 hash class。

## 入口 URL

| 用途 | URL |
|---|---|
| 图文发布 | `https://creator.xiaohongshu.com/publish/publish?from=menu&target=image` |
| 长文发布 | `https://creator.xiaohongshu.com/publish/publish?from=menu&target=article` |
| 笔记管理 | `https://creator.xiaohongshu.com/new/note-manager` |
| 首页 | `https://creator.xiaohongshu.com/new/home` |

顶部 tab 是 `div.creator-tab > span.title`，文案：上传视频 / 上传图文 / 写长文 / 发播客。
点 tab 会改 URL 的 `target` 参数（image / article / video / podcast）。

## 图文模式（target=image）

- 文件输入：`input[type=file].upload-input`，`accept=".jpg,.jpeg,.png,.webp"`，可见
- 用 `DOM.setFileInputFiles` 塞文件，不弹系统对话框
- 上传成功后缩略图出现在「图片编辑」区，会显示「笔记图片生成中，请稍后…」
- 标题框：`input[placeholder*="填写标题"]`（占位「填写标题会有更多赞哦」）
- 正文：`div.ProseMirror`（TipTap），右下角计数器 `0/1000`
- 底部按钮：「暂存离开」「发布」—— 见下方 shadow DOM 说明

## 长文模式（target=article）

1. 列表页有「新的创作」「导入链接」「长文合集」「新建长文合集」
2. 点「新的创作」进入编辑器：
   - 标题：`textarea[placeholder="输入标题"]`，`maxlength=64`
   - 正文：`div.ProseMirror`（TipTap）
   - 底部：「暂存离开」「一键排版」
3. 「一键排版」后进入排版预览页：
   - 左侧是按模板生成的文字卡片（1/3、2/3、3/3），右侧是模板列表
     （清晰明朗 / 黑白极简 / 简约基础 / 理性现代 / 逻辑结构 / 交叉拓扑…）
   - 底部：「暂存离开」「下一步」
4. 「下一步」进入发布表单：
   - 「图片编辑」区（卡片缩略图 + 每张的「编辑」按钮）
   - 标题：`input[placeholder="填写标题会有更多赞哦"]`
   - 正文/短评：`div.ProseMirror`，计数器 `0/1000`
   - 工具条：「# 话题」「@ 用户」「表情」
   - 「内容设置」：加入长文合集 / 原创声明 / 添加组件 / 关联活动 / 更多设置
   - 底部：「暂存离开」「发布」
   - 有新手引导弹窗「图片可以编辑啦」，需要点「我知道了」关掉

## 底部按钮：闭合 shadow DOM

DOM 里只有：

```html
<xhs-publish-btn is-publish="true" is-save-draft="true"
                 submit-text="发布" save-text="暂存离开"
                 submit-disabled="false" submit-loading="false"></xhs-publish-btn>
```

`el.shadowRoot === null`（closed mode），`innerText` 为空，`querySelectorAll` 找不到
里面的 button。**只能用无障碍树**：

```js
await page.cdp.send('Accessibility.enable');
const { nodes } = await page.cdp.send('Accessibility.getFullAXTree');
// 找 name.value === '发布' 且 role.value === 'button' 的节点
const box = await page.cdp.send('DOM.getBoxModel', { backendNodeId: node.backendDOMNodeId });
// 取 border 四边形中心 → Input.dispatchMouseEvent 点击
```

实测坐标（1424×905 视口，footer 在 y≈860）：暂存离开 (621, 860)、发布 (765, 860)。
**不要写死坐标**，用 AX 树每次算。

按钮禁用状态也在 AX 节点属性里（`properties` 里 `disabled: true`），可以据此判断
「为什么点不动」。

## 其他实测细节

- 页面里只有一个 iframe，`about:blank`、尺寸 0×0，与发布无关
- 话题联想面板在输入 `#xxx` 后弹出，会盖住正文区，按 `Escape` 关闭
- 「文字配图」按钮是另一个功能（用文字生成图片），不是纯文字发布
- 发布成功跳到 `/publish/success`，页面显示「发布成功 / 5 秒后将返回发布页」
- 刚发布的笔记在笔记管理里状态是「审核中」

## 首页身份（2026-11-10 实测）

发布前固定先进入 `https://creator.xiaohongshu.com/new/home`，校验所选账户；不通过不进入上述发布链路。
首页昵称位于可见的 `.account-name`，头像旁昵称是 `.user-info .name-box`；多个昵称不一致视为不可读取。
小红书号来自首页可见文本 `小红书账号: 7247802890`（支持中文冒号），不读 cookie、token、localStorage 或应用内部状态。
实测 ai 昵称为 TwoPeanuts；期望身份以 accounts.json 为准。选择器变化导致无法读取昵称时返回 ACCOUNT_MISMATCH（7），不会猜测昵称或继续填内容。

所有命令先选账户：`inspect --account ai`、`status --account house`。profile 是 `<dataRoot>\<dataDir>\chrome-profile`，截图/inspect 输出是 `<dataRoot>\<dataDir>\artifacts`。

## 2026-11-11 v0.7.0 实测

标题计数：21个中文=21、21个ASCII英文/数字/空格=11，混排中AB12 Z=4，合计半字向上取整。计数位于标题祖先内的.count-tip（未接近上限时可能不显示）。

话题候选容器为#creator-editor-topic-container，行.item，名称.name；#AI查询同时有新建#AI和已有#ai，须排除行内新建/创建并不分大小写精确匹配。8秒轮询能看到已有#ai；不将输入串当成实体。选中后验证a[data-topic]的ID及高亮。失败保存候选瞬间截图，inspect不先跳空白入口。

## house 配图与原笔记编辑

房产号每篇图文的配图顺序、取舍、数量与土拍必需图门槛，统一见 [SKILL.md 的 house 房产图文配图规则](../SKILL.md)。第 1 张永远介绍主题；第 2、3 张优先易读官方图，土拍/挂地必须同时含官方原图和真实地图。排除密集扫描件，建议最多 4 到 5 张。原笔记编辑只走笔记管理中的编辑入口；若缺入口、不支持删图/排序或保存失败就停止，不删帖、不重发。上文是新发笔记的页面结构，不代表已发编辑页一定具备相同能力，须现场核验。
