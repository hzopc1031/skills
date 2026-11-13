#!/usr/bin/env python3
r"""按照片规范中的“标题 + 空行”模型模拟切块，检查知识库文档排版。

用法: python check_doc.py <markdown 文件> [分段最大长度, 默认 2048]

模拟规则（未与特定 Dify 版本进行集成验证）：
1. 按 ^#+\s 识别标题并拆成多个 Document，剥离标题前缀；
2. 每个 Document 按空行切块，块之间不合并；
3. 标记超过分段最大长度的块，但不执行真实的硬切。

退出码: 0 通过；1 需人工处理；2 参数、文件或编码错误。
### 只统计，是否允许取决于文档类型。保留表格产生的多块也会返回 1，需人工复核。
这不是 Dify 官方分块器；代码围栏内的空行仍按本模型切分。
照片原版见 ../references/check_doc.photo-original.py.txt。
"""

import re
import sys

TINY_CHARS = 60


def split_documents(lines):
    docs, header, body = [], None, []
    in_fence = False
    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            body.append(line)
            continue
        if not in_fence and re.match(r"^#+\s", line):
            if header is not None or any(part.strip() for part in body):
                docs.append((header or "", "\n".join(body)))
            header = re.sub(r"^#+\s+", "", line).strip()
            body = []
        else:
            body.append(line)
    if header is not None or any(part.strip() for part in body):
        docs.append((header or "", "\n".join(body)))
    return docs


def split_chunks(docs):
    chunks = []
    for header, body in docs:
        content = (header + "\n" + body) if body.strip() else header
        for part in content.split("\n\n"):
            part = part.strip()
            if part:
                chunks.append(part)
    return chunks


def main():
    if len(sys.argv) not in (2, 3):
        print("用法: python check_doc.py <markdown 文件> [分段最大长度]")
        return 2

    path = sys.argv[1]
    try:
        max_chars = int(sys.argv[2]) if len(sys.argv) > 2 else 2048
        if max_chars <= 0:
            raise ValueError
    except ValueError:
        print("错误: 分段最大长度必须是正整数。", file=sys.stderr)
        return 2
    try:
        with open(path, encoding="utf-8-sig") as source:
            text = source.read()
    except (OSError, UnicodeError) as error:
        print(f"错误: 无法读取 UTF-8 文档: {error}", file=sys.stderr)
        return 2
    lines = text.split("\n")

    docs = split_documents(lines)
    chunks = split_chunks(docs)

    # 每个标题下产生的块数：>1 说明该节内部还有空行没删
    multi = []
    for header, body in docs:
        content = (header + "\n" + body) if body.strip() else header
        parts = [p.strip() for p in content.split("\n\n") if p.strip()]
        if len(parts) > 1:
            multi.append((header, [len(p) for p in parts]))

    # 只排除章节末尾分隔空行；章节中仅有一个空行时也应报告。
    blanks_by_section = []
    cur = None
    in_fence = False
    h3 = []
    for idx, line in enumerate(lines, 1):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            if cur is not None:
                cur[2] = idx
            continue
        if in_fence:
            if cur is not None and line.strip():
                cur[2] = idx
            continue
        if re.match(r"^#+\s", line):
            cur = [re.sub(r"^#+\s+", "", line).strip(), [], idx]
            blanks_by_section.append(cur)
            if re.match(r"^###[ \t]", line):
                h3.append(line)
        elif cur is not None:
            if line.strip():
                cur[2] = idx
            else:
                cur[1].append(idx)
    inner_blank = [
        (header, positions)
        for header, blank_lines, last_content in blanks_by_section
        if (positions := [line_no for line_no in blank_lines if line_no < last_content])
    ]
    heading_count = len(blanks_by_section)
    untitled = sum(not header for header, _ in docs)
    empty_sections = [header for header, body in docs if not body.strip()]
    blanks = len(re.findall(r"\n{3,}", text))
    tiny = [(len(c), c[:40].replace("\n", " ")) for c in chunks if len(c) < TINY_CHARS]
    over = [(len(c), c[:40].replace("\n", " ")) for c in chunks if len(c) > max_chars]
    tables = [c for c in chunks if c.lstrip().startswith("|")]
    orphans = []
    for i, c in enumerate(chunks):
        if c.lstrip().startswith("|") and i > 0 and len(chunks[i - 1]) < 100:
            orphans.append((len(chunks[i - 1]), chunks[i - 1][:40].replace("\n", " ")))

    print(f"文件: {path}")
    print(f"Document 数（标题数）: {heading_count}")
    print(f"块数: {len(chunks)}")
    print(f"块数 - 标题数: {len(chunks) - heading_count}（应为 0）")
    if untitled:
        print(f"无标题或空标题的内容: {untitled} 处")
    print(f"一个标题下切出多块的标题数: {len(multi)}")
    for header, sizes in multi:
        print(f"  - {header[:40]}  块长 {sizes}")
    print(f"标题内部的空行（会导致该节多切一块）: {sum(len(b) for _, b in inner_blank)} 处")
    for header, b in inner_blank[:10]:
        print(f"  - {header[:36]}  行 {b[:8]}")
    print(f"最长块: {max((len(c) for c in chunks), default=0)} 字符")
    print(f"表格块: {len(tables)}")
    print(f"表格前的孤儿引导句（< 100 字符）: {len(orphans)}")
    for size, head in orphans:
        print(f"  - {size:>4} 字符  {head}")
    print(f"三级标题 ###: {len(h3)}（故障分析类应改为加粗引导句；手册/方案类的模块标题可保留）")
    print(f"连续空行（3 个及以上）: {blanks}")
    print(f"小于 {TINY_CHARS} 字符的块: {len(tiny)}")
    for size, head in tiny:
        print(f"  - {size:>4} 字符  {head}")
    print(f"超过 {max_chars} 字符的块: {len(over)}")
    for size, head in over:
        print(f"  - {size:>4} 字符  {head}")

    problems = []
    if not text.strip():
        problems.append("文档为空：请补充标题和正文")
    if untitled:
        problems.append("存在无标题正文或空标题：请补充有效的 Markdown 标题")
    if empty_sections:
        problems.append(f"存在 {len(empty_sections)} 个没有正文的标题：请补充正文或降级标题")
    if multi:
        problems.append(f"存在 {len(multi)} 个标题下切出多块：删掉该节内部的空行（表格会强制多块，改列表）")
    if inner_blank:
        problems.append(f"存在 {sum(len(b) for _, b in inner_blank)} 处标题内部空行：按上面行号删掉")
    # ### 是否违规取决于文档类型：故障分析类应改成加粗引导句，手册/方案类的模块标题是合法的

    if tiny:
        problems.append(f"存在 {len(tiny)} 个小于 {TINY_CHARS} 字符的碎块：删空行或把标签并入内容")
    if blanks:
        problems.append("存在连续空行：收敛为一个空行")
    if over:
        problems.append(f"存在 {len(over)} 个超过 {max_chars} 字符的块：拆段或提高分段上限")
    if orphans:
        problems.append(
            f"存在 {len(orphans)} 处表格前孤儿引导句：表格强制前有空行，引导句被切成独立碎块；"
            "把引导句写实（带结论或取舍），或整章改成列表"
        )

    if problems:
        print("\n需要处理：")
        for p in problems:
            print(f"- {p}")
        return 1

    print("\n排版检查通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
