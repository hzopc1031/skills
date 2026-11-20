# 候选稿的证据契约

1.1.0 更名为 skill-distiller；读取时兼容旧 content-to-skill 的管理标记和安装收据，新记录使用新名称。旧资料快照无需重新导入。

`draft` 生成候选目录及 `evidence.json`。后者是本工具的来源记录，不属于 Agent Skills 必填字段。

```json
{
  "schema_version": 1,
  "managed_by": "skill-distiller",
  "mode": "workflow",
  "sources": ["来源ID"],
  "claims": [
    {"rule": "交付前检查重复标识", "basis": "source", "source_id": "来源ID", "section_id": "s001"},
    {"rule": "按本机路径保存报告", "basis": "adaptation", "reason": "用户已经指定统一目录"}
  ],
  "dependencies": [],
  "known_gaps": [],
  "blocking_gaps": []
}
```

`basis` 可选 `source`、`official`、`adaptation`、`inference`。source/official 指向已导入快照中的 section；本机适配或推断写清理由。校验器检查分段哈希与引用存在，agent 核对该分段是否真正支持规则。不能为了通过校验填入无关来源。

`known_gaps` 记录一般限制；不能完成核心行为的资料缺口放 `blocking_gaps`，清空前不能入库。移除缺口应有实际补充或范围调整的依据。

有运行依赖时列出：

```json
{"name": "工具名", "required": true, "status": "available", "evidence": "checks/dependency.md"}
```

`status` 是 available/missing/unverified。available 必须有对应证据文件，写清实际检查及观察，不写凭据。缺少必需依赖会阻止入库，但可以保留候选稿。无需依赖时留空数组。

验收完成后由执行者编写 `acceptance.json`：

```json
{
  "schema_version": 1,
  "verified_by": "当前 agent，实际执行并核对产物",
  "package_sha256": "用 fingerprint 命令取得的候选内容哈希",
  "cases": [
    {"kind": "normal", "input": "具体输入", "expected": "可检查的预期", "observed": "实际观察", "result": "pass", "evidence": "checks/normal.md"},
    {"kind": "transfer", "input": "不同于原例的新输入", "expected": "可检查的预期", "observed": "实际观察", "result": "pass", "evidence": "checks/transfer.md"}
  ]
}
```

工具命令：`python "S/scripts/skill_distiller.py" fingerprint "候选目录"`。哈希覆盖候选运行文件与 evidence.json，不含 acceptance.json、checks/ 或安装收据；修改技能内容后旧验收将失效。checks/ 内保留样例、实际输出或核对记录，不放模型猜测的运行结果。此哈希避免旧记录被误用，不能证明测试者说的是真的。

`boundary` 用例按需增加。所有记录均须包含实际观察和存在的证据文件；任一 fail 阻止入库。工作目录原文不会复制进正式技能，选用的来源链接与精简来源记录会保留。
