# Skills

把可复用的工作方法整理成 Agent Skills，让 AI 按明确边界处理任务，并说明做了什么、哪些还需要确认。

- **少重复交代规则**：每个 Skill 独立包含入口说明、参考资料和必要脚本。
- **整理知识库文档时保留原意**：先判断文档类型和分段配置，不以“删空行、少分块”为唯一目标。
- **不同内容分别处理**：手册保持原顺序，问题分析按证据重组，混合文档按章节分流。
- **结果可以复核**：代码、命令、数字等默认保护；另存正文，给出修改摘要和待确认项，检查结果按严重程度区分。

## 先看一个结果

当前收录：[知识库文档整理](<knowledge-base-doc-authoring/SKILL.md>)（`knowledge-base-doc-authoring`）。

示例请求：

> 用 knowledge-base-doc-authoring 整理这份操作手册。只调格式，保留代码、命令、数字和章节顺序；目标按空行分段，上限 2048 字符。另存文档，并列出修改和待确认事项。

**示意交付，不是某份真实业务文档的处理结果：**

```text
整理正文：手册-kb.md，原文未覆盖。
修改摘要：合并同一操作模块的无意义空行；代码内部空行未改。
待确认：一张比较表可能独立分段，保留表格，等待平台预览确认。
```

检查器只负责只读结构提示；文档分类、语义关系和事实保真由 AI/人工复核，不能仅凭脚本返回 `0` 就声称检索效果已提升。

## 三步快速上手

以下为 Windows PowerShell 示例。这是 Skill 文件，不是 DSH 插件，不使用 `dsh plugin add`，不需要按插件安装流程退出桌面端。

1. **下载仓库。** 在准备存放代码的目录执行：

   ```powershell
   git clone https://github.com/hzopc1031/skills.git
   Set-Location skills
   ```

2. **复制要用的 Skill。** 本机 DSH 已核对的用户级目录为 `$env:USERPROFILE\.dsh\skills`。遇到同名目录先比较并备份，不要直接覆盖已有修改：

   ```powershell
   $target = Join-Path $env:USERPROFILE '.dsh\skills\knowledge-base-doc-authoring'
   if (Test-Path -LiteralPath $target) { throw '目标已存在，请先比较或备份。' }
   New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
   Copy-Item -LiteralPath '.\knowledge-base-doc-authoring' -Destination $target -Recurse
   ```

   其他支持 Skill 的工具按各自文档选择安装位置；不承诺所有宿主都使用这个路径。

3. **新开会话得到第一份结果。** 确认技能列表出现 `knowledge-base-doc-authoring`，提交上面的请求及待处理文档。未重新扫描时重启所用工具。独立运行检查器需要 Python 3.10 或更新版本，可在仓库根目录验证[示例文档](<examples/compliant.md>)：

   ```powershell
   python knowledge-base-doc-authoring/scripts/check_doc.py examples/compliant.md
   ```

   没有 Python 仍可按规范整理，但不能执行自检脚本；未确认实际分段配置时，不要把脚本默认值当成平台设置。

## 按任务使用

### 整理通用、问题分析或混合文档

- **手册、方案、规范**：保持内容和顺序，只处理必要格式；表格、独立标题和段落空行不一律删除。
- **故障说明、根因分析**：读取[问题分析参考](<knowledge-base-doc-authoring/references/fault-analysis.md>)。允许的重组以证据为准，不强填六章，不制造矛盾，不把假设改成根因。
- **混合文档**：按章节分类，记录原章节与输出位置；不确定部分保守保留。

默认另存整理正文，并提供[修改摘要与待确认报告](<knowledge-base-doc-authoring/references/report-template.md>)。代码、命令、日志、参数、数字与单位、版本、路径及限定条件需要保真核对。检查器目前不对比原文，也不执行 Word/PDF 转换。

### 按目标配置检查

```powershell
python knowledge-base-doc-authoring/scripts/check_doc.py "文档-kb.md" --split-mode blank-lines --max-chars 2048 --min-chars 60
python knowledge-base-doc-authoring/scripts/check_doc.py "文档-kb.md" --split-mode headings --format json
```

- `blank-lines`：标题与代码区域外的空行触发近似分块；默认采用这个探索模型，不表示已确认 Dify 的真实配置。
- `headings`：近似只按标题分块，保留章节内段落空行。
- `--max-chars` 默认 `2048`，`--min-chars` 默认 `60`，都以字符而非 token 计数。旧式位置参数 `文档.md 2048` 仍可用，不能与显式 `--max-chars` 同时使用。
- 常见反引号/波浪线围栏和缩进代码受到扫描保护，代码内标题与空行不当作普通分隔点；这不保证目标知识库也这样处理。
- JSON 包含模型、参数、摘要和问题行号，不含正文；标题与文件名仍可能敏感，不默认公开业务报告。

### 理解检查级别与退出码

- **error 错误**：空文档、超过配置长度上限、未闭合围栏等。
- **warning 警告**：短块、一个标题下多块、无标题内容、可疑表格引导句等。需要人工判断，不直接要求删空行或改表格。
- **info 信息**：连续空行等结构观察，不等于内容有误。

退出码 `0` 表示没有 error，仍可能有 warning；`1` 表示有 error，或启用了 `--strict` 且有 warning；`2` 表示参数、文件或编码错误。严格门禁示例：

```powershell
python knowledge-base-doc-authoring/scripts/check_doc.py examples/fragmented.md --strict
```

[多块提示示例](<examples/fragmented.md>)在默认空行模型下会产生 warning；默认返回 `0`，严格门禁返回 `1`。这只是模型相关提示，不代表所有多段落文档都不合格。

### 验证实际检索

在获得平台和文档上传授权后，检查真实分段预览，选 3–5 个由原文可回答的问题，比较整理前后是否找到正确对象、完整前提和可用答案。没有实测，只给验证计划，不编造召回率或提升百分比。

### 增加其他 Skill

在仓库根目录新增以 Skill 名命名的目录，至少包含 `SKILL.md`，并说明触发场景、执行边界和交付结果。参考资料放 `references/`，必要脚本放 `scripts/`；不提交私密文档、账号凭据或本机配置。

## 补充说明

### 来源与兼容边界

首个 Skill 源于用户提供的 8 张照片，后经用户授权优化。照片复原基线与本次规则修改明确分开，入口和问题分析的旧版文本、153 行原版脚本均保留，见[来源与变更说明](<knowledge-base-doc-authoring/references/restoration-notes.md>)。未上传原始屏幕照片、本机安装备份或浏览器截图。

检查器是启发式近似模型，不是完整 Markdown 解析器或 Dify 官方分块器；不模拟父子分段、分段重叠、嵌入、token 限额或真实超长硬切，不验证事故结论或遗漏事实。必要时保留合理短块、表格或多块，不为统计数字牺牲语义。

### 测试与安装状态

```powershell
python -B -m unittest discover -s tests -v
```

当前本地 64 项回归测试全部通过，覆盖分级、参数、JSON、代码区域、标题和不可变历史快照。Windows 下还有 [15 项真实 CLI 检查](<tests/smoke_cli.ps1>)，包括输入文件哈希不变；可在仓库根目录执行：

```powershell
powershell -File tests/smoke_cli.ps1 -Python python
```

具体范围见 [变更说明](<knowledge-base-doc-authoring/references/restoration-notes.md>)。特定 Dify 实例的上传、分段与检索尚未验证；本地文件同步、技能被发现和实际任务效果是不同的验证结论。
