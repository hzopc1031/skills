# 辅助工具

命令中的 `S`、`W` 均替换为绝对路径。Windows PowerShell 使用 `python "S/scripts/skill_distiller.py" ...`；不需要 npm、pip、uv 或模型 key。

## 收集与查看

```text
python "S/scripts/skill_distiller.py" ingest "C:/项目/教程.md" --work "W"
python "S/scripts/skill_distiller.py" ingest "https://example.org/guide" --work "W"
python "S/scripts/skill_distiller.py" ingest "C:/项目/帖子.txt" --origin "https://x.com/author/status/123" --title "原帖标题" --work "W"
python "S/scripts/skill_distiller.py" ingest - --title "粘贴正文" --work "W"
python "S/scripts/skill_distiller.py" catalog --work "W"
python "S/scripts/skill_distiller.py" find --query "CSV 导出 检查"
```

`-` 从 stdin 接收正文。已有 web 工具返回完整正文时，先保存正文到 W 下文件，再带 `--origin` 导入；避免 shell 字符转义改动正文。`--origin` 和手填元数据只用于单个输入。可一次传多个文件/URL；有失败时保留已成功项并返回非零退出码。

本地支持 `.md/.markdown/.txt/.html/.htm`，UTF-8、带 BOM 的 UTF-16/32；其他编码用 `--encoding gb18030` 显式指定，不静默猜测。HTML 用标准库选取 article/main 内容，保留代码、链接、表格单元信息；复杂版式可能丢失，图片只记缺口。工具不启动浏览器、不使用 Cookie、不跟站、不绕限制；远端仅支持标准端口的公开 HTTP(S) URL，重定向也检查。X URL 直接提示 needs_content，不改采集范围。

来源快照按“原始位置 + 原文哈希 + 转换版本”标识；相同内容复用，来源更新创建新快照。读取网络内容用 `--refresh` 刷新，否则复用本工作目录同 URL 的快照。`catalog` 列出的分段文件用于选择性阅读；正文不因过短被丢弃。

## 建立候选

```text
python "S/scripts/skill_distiller.py" draft --name csv-export-check --mode workflow --description "检查导出 CSV 的列名、空值和重复标识。在交付 CSV 或排查导出数据问题时使用。" --source <来源ID> --work "W"
```

`--source` 可重复。只创建脚手架，不伪装成模型生成结果；agent 随后完成内容和证据。候选已有时拒绝覆盖。

## 检查与入库

```text
python "S/scripts/skill_distiller.py" validate "W/candidates/csv-export-check" --work "W" --report "W/validation.json"
python "S/scripts/skill_distiller.py" install "W/candidates/csv-export-check" --work "W"
python "S/scripts/skill_distiller.py" install "W/candidates/csv-export-check" --work "W" --replace
```

默认正式根是当前用户目录下的 `~/.dsh/skills`（Windows）或 `~/.agents/skills`（其他系统）；使用其他宿主目录或测试时，通过 `--root` 指定目标绝对路径。优先遵循用户已有统一目录约定。目标存在时必须显式 `--replace` 且目标由本工具管理，第三方目录不支持覆盖。替换采用同卷暂存、旧版备份和安装后哈希读回；失败返回非零并尽可能恢复旧目录，错误不当成功。

`validate --structure-only <目录>` 只做结构和静态内容检查，适合检查生成器自身；它不能通过 `install` 的完整门槛。frontmatter 检查支持本工具生成的保守子集：仅 name 和单行 description，双引号值用 JSON 字符串语法；不宣称替代完整 YAML 解析器。

退出码：0 成功，1 验证或某项导入失败，2 参数、依赖或操作错误。JSON 输出含确定性检查结果；行为真实性仍由实际执行者核验。
