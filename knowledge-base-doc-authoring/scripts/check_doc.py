#!/usr/bin/env python3
"""Read-only Markdown structure approximation, not Dify's actual splitter.

Python 3.10+, standard library only. Counts Unicode characters, not tokens;
normalizes CRLF/CR to LF and removes an initial UTF-8 BOM. Recognized ATX
heading markers are omitted from character counts, but heading text is retained.
No file is changed and overlong chunks are reported without hard splitting.
Tables/lists and Markdown constructs are recognized only heuristically.

CLI: python check_doc.py path [2048] [--min-chars 60] [--strict]
     python check_doc.py path --max-chars 2048 --format json
API: analyze_text(text, *, file='', split_mode='blank-lines', max_chars=2048,
                  min_chars=60, strict=False) -> schema-version-1 report
     main(argv=None) -> 0 (no errors), 1 (errors/strict warnings), 2 (input error)
"""

import argparse
import json
import re
import sys

TINY_CHARS = 60
MODEL = "markdown-structure-approximation (not a Dify splitter)"
_HEADING = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*))?$")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_INDENTED = re.compile(r"^(?: {4}| {0,3}\t)")
_LIST = re.compile(r"^ {0,3}(?:[-+*][ \t]+|[0-9]{1,9}[.)][ \t]+)")


def _finding(severity, code, line, end_line, message):
    return dict(severity=severity, code=code, line=line, end_line=end_line, message=message)


def _scan(text):
    """Classify physical lines; fences take precedence over all other syntax."""
    normalized = text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if lines and lines[-1] == "":
        lines.pop()  # A final line terminator is not an extra physical blank line.
    records, findings = [], []
    fence = None
    for number, line in enumerate(lines, 1):
        record = dict(line=number, text=line, kind="body")
        if fence is not None:
            record["kind"] = "fence"
            if re.fullmatch(r" {0,3}" + re.escape(fence[0]) + r"{" + str(fence[1]) + r",}[ \t]*", line):
                fence = None
        elif not line.strip():
            record["kind"] = "blank"
        elif _INDENTED.match(line):
            record["kind"] = "indented"
        else:
            opening = _FENCE.match(line)
            # Backticks in a backtick fence's info string invalidate its opener.
            if opening and not (opening[1][0] == "`" and "`" in opening[2]):
                fence = (opening[1][0], len(opening[1]), number)
                record["kind"] = "fence"
            else:
                heading = _HEADING.fullmatch(line)
                if heading:
                    title = heading[2] or ""
                    # Closing hashes must be separated from the title by whitespace.
                    title = re.sub(r"(?:^|[ \t]+)#+[ \t]*$", "", title).strip(" \t")
                    record.update(kind="heading", text=title, level=len(heading[1]))
        records.append(record)
    if fence is not None:
        findings.append(_finding("error", "UNCLOSED_FENCE", fence[2], len(lines),
                                 "代码围栏未闭合；其后的内容按代码保留，请检查同字符且长度足够的关闭行。"))

    # Empty lines between indented-code lines belong to that code run. Do not
    # join unrelated prose/list/table blocks across other blank lines.
    index = 0
    while index < len(records):
        if records[index]["kind"] != "blank":
            index += 1
            continue
        start = index
        while index < len(records) and records[index]["kind"] == "blank":
            index += 1
        if (start > 0 and index < len(records)
                and records[start - 1]["kind"] == records[index]["kind"] == "indented"):
            for record in records[start:index]:
                record["kind"] = "indented"
    return records, findings


def _sections(records):
    sections = []
    current = dict(heading=None, records=[])
    for record in records:
        if record["kind"] == "heading":
            if current["heading"] is not None or any(r["text"].strip() for r in current["records"]):
                sections.append(current)
            current = dict(heading=record, records=[record])
        else:
            current["records"].append(record)
    if current["heading"] is not None or any(r["text"].strip() for r in current["records"]):
        sections.append(current)
    return sections


def _trim(records):
    start, end = 0, len(records)
    while start < end and records[start]["kind"] == "blank":
        start += 1
    while end > start and records[end - 1]["kind"] == "blank":
        end -= 1
    return records[start:end]


def _make_chunks(sections, split_mode):
    chunks = []
    for section_index, section in enumerate(sections):
        groups, group = [], []
        for record in section["records"]:
            if split_mode == "blank-lines" and record["kind"] == "blank":
                if group:
                    groups.append(group)
                    group = []
            else:
                group.append(record)
        if group:
            groups.append(group)
        for group in groups:
            group = _trim(group)
            if not group:
                continue
            heading = section["heading"]
            chunks.append(dict(index=len(chunks) + 1, heading=heading["text"] if heading else "",
                               line=group[0]["line"], end_line=group[-1]["line"],
                               chars=len("\n".join(r["text"] for r in group)),
                               _section=section_index, _records=group))
    return chunks


def _table_cells(line):
    value = line.strip()
    if "|" not in value:
        return []
    if value.startswith("|"):
        value = value[1:]
    if value.endswith("|"):
        value = value[:-1]
    return [cell.strip() for cell in value.split("|")]


def _tables(records):
    """Find simple pipe-table candidates, including tables without outer pipes."""
    tables, index = [], 0
    while index + 1 < len(records):
        header, delimiter = records[index:index + 2]
        cells = _table_cells(delimiter["text"])
        if (header["kind"] == delimiter["kind"] == "body" and cells
                and len(_table_cells(header["text"])) == len(cells)
                and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)):
            end = index + 2
            while (end < len(records) and records[end]["kind"] == "body"
                   and "|" in records[end]["text"]):
                end += 1
            tables.append((header["line"], records[end - 1]["line"]))
            index = end
        else:
            index += 1
    return tables


def _report(file, split_mode, max_chars, min_chars, strict):
    return dict(schema_version=1, file=str(file), model=MODEL,
                settings=dict(split_mode=split_mode, max_chars=max_chars,
                              min_chars=min_chars, strict=bool(strict)),
                summary=dict(heading_count=0, chunk_count=0, max_chunk_chars=0,
                             error_count=0, warning_count=0, info_count=0),
                findings=[], chunks=[])


def _finish(report):
    for severity in ("error", "warning", "info"):
        report["summary"][severity + "_count"] = sum(
            finding["severity"] == severity for finding in report["findings"])
    return report


def analyze_text(text, *, file="", split_mode="blank-lines", max_chars=2048,
                 min_chars=TINY_CHARS, strict=False):
    """Return metadata/findings only, never original body text or chunk excerpts.

    Invalid settings raise ValueError; main() converts them to exit code 2.
    Heading boundaries always start sections. 'headings' preserves blank lines
    inside sections; 'blank-lines' also splits at unprotected whitespace lines.
    No full CommonMark, semantic, factual-completeness or Dify claim is made.
    """
    if split_mode not in ("blank-lines", "headings"):
        raise ValueError("split_mode 必须是 blank-lines 或 headings")
    if isinstance(max_chars, bool) or not isinstance(max_chars, int) or max_chars <= 0:
        raise ValueError("max_chars 必须是正整数字符数（不是 token）")
    if isinstance(min_chars, bool) or not isinstance(min_chars, int) or not 0 <= min_chars <= max_chars:
        raise ValueError("min_chars 必须是非负整数且不大于 max_chars")
    report = _report(file, split_mode, max_chars, min_chars, strict)
    records, findings = _scan(text)
    sections = _sections(records)
    chunks = _make_chunks(sections, split_mode)
    report["findings"] = findings
    if not text.removeprefix("\ufeff").strip():
        findings.append(_finding("error", "EMPTY_DOCUMENT", 1, max(1, len(records)), "文档为空或只有空白。"))

    for section_index, section in enumerate(sections):
        heading = section["heading"]
        body = [r for r in section["records"] if r["kind"] != "heading" and r["text"].strip()]
        if heading is None and body:
            findings.append(_finding("warning", "UNTITLED_CONTENT", body[0]["line"], body[-1]["line"],
                                     "存在首个标题之前的正文或纯文本；内容已保留，是否需要标题请人工判断。"))
        if heading is not None:
            if not heading["text"]:
                findings.append(_finding("warning", "EMPTY_HEADING", heading["line"], heading["line"], "ATX 标题为空。"))
            if not body:
                findings.append(_finding("warning", "EMPTY_SECTION", heading["line"], heading["line"],
                                         "此标题下没有正文（子标题另计为新节）；请按实际结构复核。"))
            section_chunks = [chunk for chunk in chunks if chunk["_section"] == section_index]
            if len(section_chunks) > 1:
                findings.append(_finding("warning", "MULTIPLE_CHUNKS", section_chunks[0]["line"], section_chunks[-1]["end_line"],
                                         f"同一标题下有 {len(section_chunks)} 个近似块；可能是正常多段，不要求一律删除空行或合并主题。"))
    for chunk in chunks:
        if chunk["chars"] > max_chars:
            findings.append(_finding("error", "OVERLONG_CHUNK", chunk["line"], chunk["end_line"],
                                     f"近似块为 {chunk['chars']} 字符，超过上限 {max_chars}；未执行硬切，请结合目标配置复核。"))
        if chunk["chars"] < min_chars:
            findings.append(_finding("warning", "SHORT_CHUNK", chunk["line"], chunk["end_line"],
                                     f"近似块为 {chunk['chars']} 字符，少于提示阈值 {min_chars}；短内容不一定有问题。"))

    index = 0
    while index < len(records):
        if records[index]["kind"] != "blank":
            index += 1
            continue
        start = index
        while index < len(records) and records[index]["kind"] == "blank":
            index += 1
        if index - start >= 2:
            findings.append(_finding("info", "CONSECUTIVE_BLANKS", records[start]["line"], records[index - 1]["line"],
                                     f"连续 {index - start} 个空白行；仅作格式信息，不据此判断内容质量。"))

    subordinate = [r for r in records if r["kind"] == "heading" and r["level"] >= 3]
    if subordinate:
        findings.append(_finding("info", "SUBORDINATE_HEADINGS", subordinate[0]["line"], subordinate[-1]["line"],
                                 f"三级至六级 ATX 标题共 {len(subordinate)} 个；是否独立成节须人工判断。"))
    tables = _tables(records)
    for start, _end in tables:
        for position, chunk in enumerate(chunks):
            body = [r for r in chunk["_records"] if r["kind"] != "heading"]
            if not body or body[0]["line"] != start or position == 0:
                continue
            previous = chunks[position - 1]
            previous_body = [r for r in previous["_records"] if r["kind"] != "heading"]
            if (previous["_section"] == chunk["_section"] and previous["chars"] < 100
                    and previous_body and all(r["kind"] == "body" and not _LIST.match(r["text"])
                                             and "|" not in r["text"] for r in previous_body)):
                findings.append(_finding("warning", "TABLE_INTRO", previous["line"], previous["end_line"],
                                         "表格候选前有独立短段（少于 100 字符），可能是引导句；请在目标预览中复核上下文，不自动改表格。"))
    if records and text.removeprefix("\ufeff").strip():
        list_lines = sum(r["kind"] == "body" and bool(_LIST.match(r["text"])) for r in records)
        findings.append(_finding("info", "STRUCTURE_STATS", 1, len(records),
                                 f"启发式统计：表格候选 {len(tables)} 个，列表标记行 {list_lines} 行；不是完整 Markdown 解析，也不判断语义或事实遗漏。"))
    report["chunks"] = [{key: value for key, value in chunk.items() if not key.startswith("_")} for chunk in chunks]
    report["summary"].update(heading_count=sum(r["kind"] == "heading" for r in records),
                             chunk_count=len(chunks), max_chunk_chars=max((c["chars"] for c in chunks), default=0))
    return _finish(report)


def split_documents(lines):
    """Compatibility helper: return (heading, body) tuples without losing preamble."""
    records, _ = _scan("\n".join(lines))
    return [(s["heading"]["text"] if s["heading"] else "",
             "\n".join(r["text"] for r in s["records"] if r["kind"] != "heading")) for s in _sections(records)]


def split_chunks(docs, split_mode="blank-lines"):
    """Compatibility helper returning chunk text; JSON reports never expose it."""
    if split_mode not in ("blank-lines", "headings"):
        raise ValueError("unknown split mode")
    result = []
    for heading, body in docs:
        source = ("# " + heading + "\n" if heading else "") + body
        records, _ = _scan(source)
        for chunk in _make_chunks(_sections(records), split_mode):
            value = "\n".join(r["text"] for r in chunk["_records"])
            if value:
                result.append(value)
    return result


def report_exit_code(report):
    """Return document-check status; main reserves 2 for argument/input problems."""
    summary = report["summary"]
    return int(bool(summary["error_count"] or (report["settings"]["strict"] and summary["warning_count"])))


class _ArgumentError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise _ArgumentError(message)


def _parser():
    parser = _Parser(description="只读 Markdown 结构近似检查；不是 Dify 真实切块器。长度单位为字符，不是 token。", allow_abbrev=False)
    parser.add_argument("path", help="UTF-8/UTF-8 BOM 文档路径（扩展名不限）")
    parser.add_argument("legacy_max_chars", nargs="?", type=int, metavar="max_chars", help="旧式位置上限，默认 2048 字符")
    parser.add_argument("--max-chars", type=int, help="字符上限；不能与位置上限同时显式给出")
    parser.add_argument("--min-chars", type=int, default=TINY_CHARS, help="短块提示阈值，默认 60；0 禁用，不能大于上限")
    parser.add_argument("--split-mode", choices=("blank-lines", "headings"), default="blank-lines", help="近似分块模式，默认 blank-lines")
    parser.add_argument("--strict", action="store_true", help="warning 也使退出码为 1；默认只有 error 阻断")
    parser.add_argument("--format", choices=("text", "json"), default="text", help="输出格式，默认 text")
    return parser


def _json_requested(argv):
    """Recognize output mode even when argparse cannot parse other arguments."""
    value = "text"
    for index, arg in enumerate(argv):
        if arg == "--":
            break
        if arg.startswith("--format="):
            value = arg.partition("=")[2]
        elif arg == "--format" and index + 1 < len(argv):
            value = argv[index + 1]
    return value == "json"


def _emit(report, format):
    if format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    print(f"文件: {report['file']}")
    print("模型: Markdown 结构近似模型 (approximation)，不是 Dify 真实切块器；不判断语义或事实遗漏。")
    settings = report["settings"]
    print(f"参数: split_mode={settings['split_mode']}, max_chars={settings['max_chars']}, min_chars={settings['min_chars']}, strict={settings['strict']}")
    print("长度为字符（不是 token）；保留代码块，不自动改文档，不执行硬切；表格/列表仅启发识别。")
    summary = report["summary"]
    print(f"标题数: {summary['heading_count']}；近似块数: {summary['chunk_count']}；最长块: {summary['max_chunk_chars']} 字符")
    print(f"error: {summary['error_count']}；warning: {summary['warning_count']}；info: {summary['info_count']}")
    for finding in report["findings"]:
        line, end = finding["line"], finding["end_line"]
        location = "输入" if line is None else f"行 {line}" + (f"–{end}" if end != line else "")
        print(f"[{finding['severity']}] {finding['code']} ({location}): {finding['message']}")
    if summary["error_count"]:
        print("存在 error，检查未通过。")
    elif summary["warning_count"]:
        print("无 error，但有 warning，需人工复核。" + ("strict 模式返回 1。" if settings["strict"] else "默认不阻断（返回 0），不代表无风险。"))
    else:
        print("本近似检查未发现 error/warning；仍需目标知识库预览复核。")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = _parser()
    options = None
    maximum = 2048
    try:
        options = parser.parse_args(argv)
        if options.legacy_max_chars is not None and options.max_chars is not None:
            parser.error("位置上限与 --max-chars 不能同时显式给出")
        maximum = options.max_chars if options.max_chars is not None else options.legacy_max_chars
        maximum = 2048 if maximum is None else maximum
        if maximum <= 0:
            parser.error("max_chars 必须是正整数字符数（不是 token）")
        if not 0 <= options.min_chars <= maximum:
            parser.error("min_chars 必须非负且不大于 max_chars")
    except _ArgumentError as error:
        report = _report(options.path if options else "", options.split_mode if options else "blank-lines",
                         maximum, options.min_chars if options else TINY_CHARS, options.strict if options else False)
        report["findings"].append(_finding("error", "INVALID_ARGUMENTS", None, None, str(error)))
        _finish(report)
        if _json_requested(argv):
            _emit(report, "json")
        else:
            parser.print_usage(sys.stderr)
            print(f"参数错误: {error}", file=sys.stderr)
        return 2
    except SystemExit as exit:
        # argparse's normal --help output is intentionally not JSON.
        return int(exit.code)
    try:
        with open(options.path, encoding="utf-8-sig") as source:
            text = source.read()
    except (OSError, UnicodeError, ValueError) as error:
        report = _report(options.path, options.split_mode, maximum, options.min_chars, options.strict)
        code = "ENCODING_ERROR" if isinstance(error, UnicodeError) else "FILE_ERROR"
        report["findings"].append(_finding("error", code, None, None, f"无法读取 UTF-8 文档: {error}"))
        _emit(_finish(report), options.format)
        return 2
    report = analyze_text(text, file=options.path, split_mode=options.split_mode,
                          max_chars=maximum, min_chars=options.min_chars, strict=options.strict)
    _emit(report, options.format)
    return report_exit_code(report)


if __name__ == "__main__":
    sys.exit(main())
