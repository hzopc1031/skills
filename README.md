# Skills

把可复用的工作方法整理成 Agent Skills，让 AI 按明确规则处理任务，而不是每次从头解释要求。

- **少重复交代规则**：每个 Skill 独立存放，包含入口说明、参考资料和必要脚本。
- **知识库文档少被切碎**：按内容关系处理空行和标题，而不是只做视觉美化。
- **不同文档分别处理**：故障分析按检索问题重组；手册、方案保留原内容结构。
- **提交前先检查**：用只读脚本定位多块、碎块、超长块和表格引导句，再人工复核。

## 先看一个结果

当前收录：[知识库文档编写规范](<knowledge-base-doc-authoring/SKILL.md>)（`knowledge-base-doc-authoring`）。

给 AI 的示例请求：

> 用 knowledge-base-doc-authoring 整理这份操作手册，保留内容和章节顺序，只调整换行与从属小标题。另存 Markdown，并检查哪些内容可能被拆成碎块。

仓库内的[合规示例](<examples/compliant.md>)实际检查结果摘要：

```text
Document 数（标题数）: 1
块数: 1
块数 - 标题数: 0（应为 0）
最长块: 210 字符
排版检查通过。
```

[分块反例](<examples/fragmented.md>)在同一个标题下插入空行，会报告 2 个块以及第 3 行的内部空行。

## 三步快速上手

以下为 Windows PowerShell 示例。这里安装的是 Skill 文件，不是 DSH 插件，不使用 `dsh plugin add`。

1. **下载仓库到本地。** 在你准备存放代码的目录执行：

   ```powershell
   git clone https://github.com/hzopc1031/skills.git
   Set-Location skills
   ```

2. **复制要使用的 Skill。** 本机 DSH 的用户级技能目录为 `$env:USERPROFILE\.dsh\skills`。下面的命令遇到同名目录会停止，避免覆盖已有修改：

   ```powershell
   $target = Join-Path $env:USERPROFILE '.dsh\skills\knowledge-base-doc-authoring'
   if (Test-Path -LiteralPath $target) { throw '目标已存在，请先比较或备份。' }
   New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
   Copy-Item -LiteralPath '.\knowledge-base-doc-authoring' -Destination $target -Recurse
   ```

   其他支持 Skill 目录的工具，应按各自文档选择安装位置；不承诺所有工具使用同一路径。

3. **新开会话，得到第一份结果。** 确认技能列表出现 `knowledge-base-doc-authoring`，再提交上面的示例请求及待处理文档。如果工具未重新扫描技能，重启该工具后再试。需要独立验证示例时，安装 Python 3.10 或更新版本，并在仓库根目录执行：

   ```powershell
   python knowledge-base-doc-authoring/scripts/check_doc.py examples/compliant.md
   ```

   成功时会显示一个标题、一个块，以及“排版检查通过”。没有 Python 时仍可阅读规范或让 AI 按规范整理，但不能执行此自检脚本。

## 日常使用

### 整理手册、方案、规范

保留原文内容和章节顺序，只处理同一主题内部的空行及从属标题；步骤、注意事项和配图说明尽量保持在同一语义块中。不要为了减少块数合并不同主题。

### 整理故障分析、根因说明、排查指南

按[故障分析参考规范](<knowledge-base-doc-authoring/references/fault-analysis.md>)组织：结论与适用前提、现象、根因、判断与自查、解决方案、预防。判断与预防可选；未知事实应向用户核实，不能为了填满结构而编造证据。

### 检查待入库 Markdown

```powershell
python knowledge-base-doc-authoring/scripts/check_doc.py "待入库文档.md" 2048
```

- `2048` 是可选的单块字符上限，默认也是 `2048`，不是 token 数。
- 退出码 `0` 表示检查通过；`1` 表示需要处理或人工复核；`2` 表示参数、文件或编码错误。
- 检查器只读本地文档，不自动改写、上传 Dify、执行修复命令或发布内容。
- 表格造成的多块、三级标题是否保留，需要结合文档类型人工判断。

### 以后增加新的 Skill

在仓库根目录新增一个以 Skill 名命名的目录，至少包含 `SKILL.md`，并在其中写明名称、触发场景和执行规则。参考资料放在该目录的 `references/`，脚本放在 `scripts/`；不要提交账号凭据、私人文档或本机配置。

## 补充说明

### 来源与复原边界

首个 Skill 来自用户提供的 8 张照片：主规范 3 张、自检脚本 2 张、故障分析参考 3 张。正文以等价 Markdown 恢复；照片没有显示原始 Markdown 标记，不能保证标点和空格逐字节一致。

检查器保留[照片原版脚本快照](<knowledge-base-doc-authoring/references/check_doc.photo-original.py.txt>)，运行版本修正了空输入、标题前内容丢失等边界问题，详见[复原说明](<knowledge-base-doc-authoring/references/restoration-notes.md>)。没有上传原始屏幕照片、浏览器截图或本地私密文件。

### 分块模型与兼容范围

“标题 + 空行”是照片规范采用的近似模型，不是对所有 Dify 版本、抽取器、父子分段、分隔符或重叠设置的保证。实际入库前，以目标知识库的分段预览和检索测试为准。脚本只标记超长块，不执行真实硬切；围栏代码内的空行仍可能被本模型拆分。

通用文档的格式整理不等于事实校验；故障分析规范里的存储系统示例也不是对未知生产环境的操作建议。不要直接执行文档中的破坏性命令。

### 测试

使用 Python 标准库即可运行回归测试：

```powershell
python -B -m unittest discover -s tests -v
```

当前本地验证包括 28 项单元测试，以及合规示例、分块反例、错误参数、缺失文件 4 项真实命令行检查。尚未对特定 Dify 实例进行上传或检索验证，也未完成所有 Skill 宿主的兼容性测试。
