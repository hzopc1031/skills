"""Standard-library tests for the read-only structural approximation checker.

Run directly: python -B tests/test_check_doc.py -v
Input files, argv and output streams are mocked, not the checking algorithm.
No temporary directory, source snapshot change, Dify integration or ACL probe.
"""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock


SCRIPT_PATH = (Path(__file__).resolve().parents[1] / "knowledge-base-doc-authoring" / "scripts" / "check_doc.py")
SPEC = importlib.util.spec_from_file_location("structural_check_doc", SCRIPT_PATH)
CHECK_DOC = importlib.util.module_from_spec(SPEC)
_previous_bytecode_setting = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    SPEC.loader.exec_module(CHECK_DOC)
finally:
    sys.dont_write_bytecode = _previous_bytecode_setting


def analyze(text, **settings):
    return CHECK_DOC.analyze_text(text, **settings)


def codes(report, severity=None):
    return [finding["code"] for finding in report["findings"]
            if severity is None or finding["severity"] == severity]


def chunks_from(text, split_mode="blank-lines"):
    return CHECK_DOC.split_chunks(CHECK_DOC.split_documents(text.split("\n")), split_mode)


class StructureTests(unittest.TestCase):
    def test_default_model_and_settings(self):
        report = analyze("# 标题\n" + "正" * 80)
        self.assertEqual(report["schema_version"], 1)
        self.assertIn("approximation", report["model"])
        self.assertIn("not a Dify", report["model"])
        self.assertEqual(report["settings"], dict(split_mode="blank-lines", max_chars=2048, min_chars=60, strict=False))
        self.assertEqual(report["summary"]["heading_count"], 1)
        self.assertEqual(report["summary"]["chunk_count"], 1)
        self.assertEqual(report["summary"]["error_count"], 0)
        self.assertEqual(report["summary"]["warning_count"], 0)

    def test_heading_levels_one_to_six_and_no_seven(self):
        text = "\n".join("#" * level + f" 标题{level}\n正文" for level in range(1, 8))
        report = analyze(text)
        self.assertEqual(report["summary"]["heading_count"], 6)
        self.assertEqual(report["summary"]["chunk_count"], 6)
        self.assertIn("####### 标题7", chunks_from(text)[-1])
        subordinate = next(f for f in report["findings"] if f["code"] == "SUBORDINATE_HEADINGS")
        self.assertEqual(subordinate["severity"], "info")
        self.assertIn("4 个", subordinate["message"])

    def test_atx_requires_whitespace_or_end_after_prefix(self):
        text = "#good\n##没有空格\n#\n正文\n##\t子标题\n内容"
        report = analyze(text)
        self.assertEqual(report["summary"]["heading_count"], 2)
        self.assertIn("UNTITLED_CONTENT", codes(report, "warning"))
        self.assertIn("EMPTY_HEADING", codes(report, "warning"))
        self.assertEqual(report["chunks"][-1]["heading"], "子标题")

    def test_atx_zero_to_three_leading_spaces_supported(self):
        for spaces in range(4):
            with self.subTest(spaces=spaces):
                report = analyze(" " * spaces + "# 标题\n正文")
                self.assertEqual(report["summary"]["heading_count"], 1)
                self.assertEqual(report["chunks"][0]["heading"], "标题")

    def test_hashes_inside_title_are_preserved_and_closing_hashes_removed(self):
        for source, expected in [("# C# 与 #标签", "C# 与 #标签"),
                                 ("# C# 与 #标签 ###  ", "C# 与 #标签"),
                                 ("# C#", "C#"), ("# name#", "name#"),
                                 ("# name ### trailing", "name ### trailing")]:
            with self.subTest(source=source):
                report = analyze(source + "\n正文")
                self.assertEqual(report["chunks"][0]["heading"], expected)
                self.assertEqual(report["chunks"][0]["chars"], len(expected + "\n正文"))

    def test_empty_heading_variants_are_warnings(self):
        for source in ["#", "# ", "##\t", "# ###", "   #### ##  "]:
            with self.subTest(source=source):
                report = analyze(source + "\n正文")
                self.assertEqual(report["summary"]["heading_count"], 1)
                self.assertIn("EMPTY_HEADING", codes(report, "warning"))
                self.assertNotIn("EMPTY_DOCUMENT", codes(report))
                self.assertEqual(CHECK_DOC.report_exit_code(report), 0)

    def test_heading_only_and_parent_heading_without_body_warn(self):
        report = analyze("# 父\n\n## 子\n正文\n# 末尾")
        empty = [f for f in report["findings"] if f["code"] == "EMPTY_SECTION"]
        self.assertEqual([f["line"] for f in empty], [1, 5])
        self.assertTrue(all(f["severity"] == "warning" for f in empty))

    def test_preamble_is_retained_with_line_numbers_and_warning(self):
        text = "前文不能丢失\n仍是前文\n\n# 标题\n正文"
        report = analyze(text)
        self.assertEqual(chunks_from(text), ["前文不能丢失\n仍是前文", "标题\n正文"])
        self.assertEqual(report["chunks"][0], dict(index=1, heading="", line=1, end_line=2, chars=len("前文不能丢失\n仍是前文")))
        finding = next(f for f in report["findings"] if f["code"] == "UNTITLED_CONTENT")
        self.assertEqual((finding["line"], finding["end_line"]), (1, 2))

    def test_plain_unknown_text_is_not_discarded(self):
        text = "普通文本，不是 Markdown。\n第二行 : ???"
        self.assertEqual(chunks_from(text), [text])
        report = analyze(text)
        self.assertEqual(report["summary"]["heading_count"], 0)
        self.assertEqual(report["summary"]["error_count"], 0)
        self.assertIn("UNTITLED_CONTENT", codes(report, "warning"))
        self.assertEqual(CHECK_DOC.report_exit_code(report), 0)

    def test_blank_lines_split_and_do_not_repeat_heading(self):
        text = "# 标题\n第一段\n\n第二段\n \t \n第三段"
        self.assertEqual(chunks_from(text), ["标题\n第一段", "第二段", "第三段"])
        report = analyze(text)
        self.assertEqual(report["summary"]["chunk_count"], 3)
        self.assertEqual([c["heading"] for c in report["chunks"]], ["标题"] * 3)
        self.assertEqual([(c["line"], c["end_line"]) for c in report["chunks"]], [(1, 2), (4, 4), (6, 6)])
        finding = next(f for f in report["findings"] if f["code"] == "MULTIPLE_CHUNKS")
        self.assertEqual(finding["severity"], "warning")
        self.assertIn("不要求一律删除空行", finding["message"])

    def test_heading_mode_keeps_internal_blanks_but_not_section_separators(self):
        text = "# 标题\n首段\n \t \n次段\n\n# 下一节\n正文\n\n"
        report = analyze(text, split_mode="headings", min_chars=0)
        self.assertEqual(report["summary"]["chunk_count"], 2)
        self.assertEqual(chunks_from(text, "headings"), ["标题\n首段\n \t \n次段", "下一节\n正文"])
        self.assertNotIn("MULTIPLE_CHUNKS", codes(report))
        self.assertEqual(report["chunks"][0]["chars"], len("标题\n首段\n \t \n次段"))

    def test_heading_body_blank_is_modeled_without_claiming_empty_section(self):
        report = analyze("# 标题\n\n正文")
        self.assertEqual(report["summary"]["chunk_count"], 2)
        self.assertIn("MULTIPLE_CHUNKS", codes(report))
        self.assertNotIn("EMPTY_SECTION", codes(report))

    def test_consecutive_whitespace_blanks_are_info_only(self):
        text = "# 第一节\n" + "甲" * 70 + "\n  \n\t\n# 第二节\n" + "乙" * 70
        report = analyze(text, strict=True)
        finding = next(f for f in report["findings"] if f["code"] == "CONSECUTIVE_BLANKS")
        self.assertEqual((finding["severity"], finding["line"], finding["end_line"]), ("info", 3, 4))
        self.assertEqual(report["summary"]["warning_count"], 0)
        self.assertEqual(CHECK_DOC.report_exit_code(report), 0)

    def test_single_blank_is_not_consecutive(self):
        self.assertNotIn("CONSECUTIVE_BLANKS", codes(analyze("# A\nbody\n\n# B\nbody")))

    def test_crlf_cr_and_initial_bom_are_normalized(self):
        for text in ["\ufeff# 标题\r\n正文\r\n \t\r\n次段\r\n", "\ufeff# 标题\r正文\r \t\r次段\r"]:
            with self.subTest(text=repr(text)):
                report = analyze(text)
                self.assertEqual(report["summary"]["heading_count"], 1)
                self.assertEqual([c["chars"] for c in report["chunks"]], [len("标题\n正文"), len("次段")])
                self.assertEqual(report["chunks"][-1]["line"], 4)

    def test_empty_document_variants_are_errors_without_chunks(self):
        for text in ["", " \n \t\n", "\ufeff", "\r\n"]:
            with self.subTest(text=repr(text)):
                report = analyze(text)
                self.assertIn("EMPTY_DOCUMENT", codes(report, "error"))
                self.assertEqual(report["summary"]["chunk_count"], 0)
                self.assertEqual(CHECK_DOC.report_exit_code(report), 1)

    def test_maximum_is_inclusive_and_no_hard_split_occurs(self):
        for size, expected in [(2048, 0), (2049, 1)]:
            with self.subTest(size=size):
                report = analyze("# 节\n" + "长" * (size - 2))
                self.assertEqual(report["summary"]["chunk_count"], 1)
                self.assertEqual(report["summary"]["max_chunk_chars"], size)
                self.assertEqual(report["summary"]["error_count"], expected)
                self.assertEqual(CHECK_DOC.report_exit_code(report), expected)

    def test_counts_characters_not_utf8_bytes_or_tokens(self):
        text = "# 节\n中😀e\u0301"
        report = analyze(text, max_chars=len("节\n中😀e\u0301"), min_chars=0)
        self.assertEqual(report["chunks"][0]["chars"], 6)
        self.assertNotIn("OVERLONG_CHUNK", codes(report))

    def test_short_threshold_is_advisory_and_strictly_less_than(self):
        for size in (59, 60):
            with self.subTest(size=size):
                report = analyze("# 节\n" + "正" * (size - 2))
                self.assertEqual(codes(report, "warning").count("SHORT_CHUNK"), int(size < 60))
                self.assertEqual(CHECK_DOC.report_exit_code(report), 0)
                strict_report = analyze("# 节\n" + "正" * (size - 2), strict=True)
                self.assertEqual(CHECK_DOC.report_exit_code(strict_report), int(size < 60))

    def test_zero_min_disables_short_warning_and_equal_min_max_is_legal(self):
        self.assertNotIn("SHORT_CHUNK", codes(analyze("# A\nx", min_chars=0)))
        self.assertNotIn("SHORT_CHUNK", codes(analyze("# A\nx", min_chars=3, max_chars=3)))

    def test_invalid_pure_function_settings_raise_value_error(self):
        for settings in [dict(max_chars=0), dict(max_chars=-1), dict(max_chars=True),
                         dict(max_chars="10"), dict(min_chars=-1), dict(min_chars=2049),
                         dict(min_chars=True), dict(min_chars=1.5), dict(split_mode="bogus")]:
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                analyze("# A\nx", **settings)

    def test_summary_counts_match_findings(self):
        report = analyze("前文\n\n#\n\n\n### 子标题\n" + "长" * 100, max_chars=80)
        for severity in ("error", "warning", "info"):
            self.assertEqual(report["summary"][severity + "_count"], len(codes(report, severity)))


class CodeProtectionTests(unittest.TestCase):
    def test_backtick_fence_preserves_blank_lines_hashes_and_table_symbols(self):
        text = "# 标题\n```python\n# 代码标题\n\n\n| a | b |\n| --- | --- |\n- 代码列表\n```\n正文"
        report = analyze(text)
        self.assertEqual(report["summary"]["heading_count"], 1)
        self.assertEqual(report["summary"]["chunk_count"], 1)
        self.assertEqual(chunks_from(text), [text.replace("# 标题", "标题", 1)])
        for code in ("UNCLOSED_FENCE", "CONSECUTIVE_BLANKS", "TABLE_INTRO", "SUBORDINATE_HEADINGS"):
            self.assertNotIn(code, codes(report))
        stats = next(f for f in report["findings"] if f["code"] == "STRUCTURE_STATS")
        self.assertIn("表格候选 0 个", stats["message"])
        self.assertIn("列表标记行 0 行", stats["message"])

    def test_tilde_fences_and_zero_to_three_space_indentation(self):
        for spaces in range(4):
            for marker in ("```", "~~~~"):
                with self.subTest(spaces=spaces, marker=marker):
                    text = "# H\n" + " " * spaces + marker + " lang\n\n### code\n\n" + " " * spaces + marker + "\t\n## B\nbody"
                    report = analyze(text)
                    self.assertEqual(report["summary"]["heading_count"], 2)
                    self.assertEqual(report["summary"]["chunk_count"], 2)
                    self.assertNotIn("UNCLOSED_FENCE", codes(report))

    def test_closing_fence_may_be_longer_but_not_shorter(self):
        for marker in ("`", "~"):
            with self.subTest(marker=marker):
                text = "# H\n" + marker * 4 + "\nx\n" + marker * 3 + "\n# still code\n\n" + marker * 5 + "\n## real\nbody"
                report = analyze(text)
                self.assertEqual(report["summary"]["heading_count"], 2)
                self.assertNotIn("UNCLOSED_FENCE", codes(report))
                self.assertIn("# still code", chunks_from(text)[0])

    def test_closing_fence_requires_same_character(self):
        for opening, wrong in [("```", "~~~"), ("~~~~", "````")]:
            with self.subTest(opening=opening):
                text = "# H\n" + opening + "\n" + wrong + "\n# still code\n\n" + opening + "\n## real\nbody"
                report = analyze(text)
                self.assertEqual(report["summary"]["heading_count"], 2)
                self.assertNotIn("UNCLOSED_FENCE", codes(report))

    def test_closing_line_only_allows_whitespace_suffix_and_three_space_indent(self):
        for invalid in ["``` trailing", "```#", "    ```", "\t```", "```\u00a0"]:
            with self.subTest(invalid=repr(invalid)):
                report = analyze("# H\n```\nx\n" + invalid + "\n# still code\n```\n## real\nbody")
                self.assertEqual(report["summary"]["heading_count"], 2)
                self.assertNotIn("UNCLOSED_FENCE", codes(report))

    def test_unclosed_fence_is_error_at_opener_through_eof(self):
        for opening in ("```python", "~~~", "   ````"):
            with self.subTest(opening=opening):
                report = analyze("# H\n" + opening + "\n# code\n\ntrailing")
                finding = next(f for f in report["findings"] if f["code"] == "UNCLOSED_FENCE")
                self.assertEqual((finding["severity"], finding["line"], finding["end_line"]), ("error", 2, 5))
                self.assertEqual(report["summary"]["heading_count"], 1)
                self.assertEqual(report["summary"]["chunk_count"], 1)
                self.assertEqual(CHECK_DOC.report_exit_code(report), 1)

    def test_backtick_info_string_cannot_contain_backticks(self):
        report = analyze("not a fence: text\n```bad`info\n# real\nbody")
        self.assertEqual(report["summary"]["heading_count"], 1)
        self.assertNotIn("UNCLOSED_FENCE", codes(report))

    def test_tilde_info_string_may_contain_backticks(self):
        report = analyze("# H\n~~~a`b\n# code\n~~~\nbody")
        self.assertEqual(report["summary"]["heading_count"], 1)
        self.assertNotIn("UNCLOSED_FENCE", codes(report))

    def test_indented_code_hashes_fences_and_blank_run_stay_in_one_chunk(self):
        for indent in ("    ", "\t", "  \t"):
            with self.subTest(indent=repr(indent)):
                text = "# H\n" + indent + "# code\n \t\n\n" + indent + "```\n" + indent + "~~~\n## real\nbody"
                report = analyze(text)
                self.assertEqual(report["summary"]["heading_count"], 2)
                self.assertEqual(report["summary"]["chunk_count"], 2)
                self.assertNotIn("CONSECUTIVE_BLANKS", codes(report))
                self.assertNotIn("UNCLOSED_FENCE", codes(report))
                self.assertIn("\n \t\n\n", chunks_from(text)[0])

    def test_blank_after_indented_code_does_not_force_merge_with_prose(self):
        text = "# H\n    code\n\nordinary prose"
        self.assertEqual(chunks_from(text), ["H\n    code", "ordinary prose"])

    def test_unindented_heading_after_indented_code_is_a_heading(self):
        report = analyze("    # code\n# real\nbody")
        self.assertEqual(report["summary"]["heading_count"], 1)
        self.assertIn("UNTITLED_CONTENT", codes(report))


class TableAndListTests(unittest.TestCase):
    def test_complete_table_and_multiline_list_are_not_split_within_lines(self):
        text = "# H\nintro\n| A | B |\n| --- | :---: |\n| one | two |\n- first\n  continued\n- second\n1. numbered\n   continued"
        report = analyze(text)
        self.assertEqual(report["summary"]["chunk_count"], 1)
        self.assertEqual(chunks_from(text), [text.replace("# H", "H", 1)])
        stats = next(f for f in report["findings"] if f["code"] == "STRUCTURE_STATS")
        self.assertIn("表格候选 1 个", stats["message"])
        self.assertIn("列表标记行 3 行", stats["message"])
        self.assertNotIn("TABLE_INTRO", codes(report))

    def test_short_intro_before_table_is_advisory(self):
        text = "# H\n见下表：\n\nA | B\n--- | ---\none | two"
        report = analyze(text)
        self.assertIn("TABLE_INTRO", codes(report, "warning"))
        self.assertEqual(report["summary"]["chunk_count"], 2)
        self.assertEqual(CHECK_DOC.report_exit_code(report), 0)
        self.assertEqual(chunks_from(text)[1], "A | B\n--- | ---\none | two")

    def test_table_intro_threshold_is_strictly_less_than_one_hundred(self):
        for size in (99, 100):
            with self.subTest(size=size):
                report = analyze("# H\n" + "引" * (size - 2) + "\n\n| A |\n| --- |\n| B |")
                self.assertEqual(codes(report).count("TABLE_INTRO"), int(size < 100))

    def test_no_intro_warning_for_heading_only_or_separate_section(self):
        for text in ["# H\n\n| A |\n| --- |\n| B |",
                     "# H\nintro\n\n# T\n| A |\n| --- |\n| B |"]:
            with self.subTest(text=text):
                self.assertNotIn("TABLE_INTRO", codes(analyze(text)))

    def test_no_table_detection_from_isolated_pipes_or_nonseparator_row(self):
        for body in ["| ordinary |\n| not separator |", "a | b\n--- | bad", "a | b\n---"]:
            with self.subTest(body=body):
                report = analyze("# H\nintro\n\n" + body)
                self.assertNotIn("TABLE_INTRO", codes(report))
                stats = next(f for f in report["findings"] if f["code"] == "STRUCTURE_STATS")
                self.assertIn("表格候选 0 个", stats["message"])

    def test_list_paragraphs_are_not_force_merged_across_blank_lines(self):
        text = "# H\n- one\n  continued\n\n- two\n- three"
        self.assertEqual(chunks_from(text), ["H\n- one\n  continued", "- two\n- three"])
        self.assertEqual(analyze(text)["summary"]["chunk_count"], 2)


class MainTests(unittest.TestCase):
    def run_check(self, text="# 标题\n" + "正" * 80, args=None, input_error=None, use_sys_argv=False):
        arguments = ["知识库文档.md"] if args is None else list(args)
        output, errors = io.StringIO(), io.StringIO()
        opener = mock.mock_open(read_data=text)
        if input_error is not None:
            opener.side_effect = input_error
        with (mock.patch.object(CHECK_DOC, "open", opener, create=True),
              mock.patch.object(sys, "argv", [str(SCRIPT_PATH)] + arguments),
              redirect_stdout(output), redirect_stderr(errors)):
            status = CHECK_DOC.main() if use_sys_argv else CHECK_DOC.main(arguments)
        return SimpleNamespace(returncode=status, stdout=output.getvalue(), stderr=errors.getvalue(), opener=opener)

    def json_check(self, text="# H\nbody", args=None, **kwargs):
        result = self.run_check(text, args=["input.md", "--format", "json"] + (args or []), **kwargs)
        result.report = json.loads(result.stdout)
        self.assertEqual(result.stderr, "")
        return result

    def test_legacy_cli_and_default_main_argv(self):
        for args in [["old.md"], ["old.md", "2048"]]:
            with self.subTest(args=args):
                result = self.run_check(args=args, use_sys_argv=True)
                self.assertEqual(result.returncode, 0)
                self.assertIn("max_chars=2048", result.stdout)
                self.assertIn("error: 0；warning: 0", result.stdout)
                self.assertIn("近似模型", result.stdout)
                self.assertIn("不是 token", result.stdout)
                self.assertEqual(result.stderr, "")

    def test_named_and_positional_maximum_have_same_inclusive_behavior(self):
        for limit, expected in [(79, 1), (80, 0)]:
            for tail in [[str(limit)], ["--max-chars", str(limit)]]:
                with self.subTest(tail=tail):
                    result = self.json_check("# 节\n" + "正" * 78, args=tail)
                    self.assertEqual(result.returncode, expected)
                    self.assertEqual(result.report["settings"]["max_chars"], limit)
                    self.assertEqual(result.report["summary"]["chunk_count"], 1)

    def test_explicit_max_alias_conflict_is_usage_error_even_if_equal(self):
        for tail in [["2048", "--max-chars", "2048"], ["100", "--max-chars", "200"]]:
            with self.subTest(tail=tail):
                result = self.json_check(args=tail)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(codes(result.report), ["INVALID_ARGUMENTS"])
                result.opener.assert_not_called()

    def test_invalid_maxima_and_minima_are_usage_errors(self):
        for tail in [["zero"], ["0"], ["-1"], ["--max-chars", "0"],
                     ["--max-chars", "not-integer"], ["--min-chars", "-1"],
                     ["--min-chars", "2049"], ["--min-chars", "1.5"],
                     ["--max-chars", "59"]]:
            with self.subTest(tail=tail):
                result = self.json_check(args=tail)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(codes(result.report), ["INVALID_ARGUMENTS"])
                result.opener.assert_not_called()

    def test_minimum_zero_and_equal_maximum_are_accepted(self):
        for tail in [["--max-chars", "3", "--min-chars", "0"], ["3", "--min-chars", "3"]]:
            with self.subTest(tail=tail):
                result = self.json_check("# A\nx", args=tail)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.report["summary"]["warning_count"], 0)

    def test_warning_default_zero_is_not_presented_as_risk_free(self):
        result = self.run_check("# H\nx")
        self.assertEqual(result.returncode, 0)
        self.assertIn("SHORT_CHUNK", result.stdout)
        self.assertIn("有 warning", result.stdout)
        self.assertIn("不代表无风险", result.stdout)
        self.assertNotIn("排版检查通过", result.stdout)
        self.assertIn("行 1–2", result.stdout)

    def test_strict_warning_returns_one(self):
        result = self.json_check("# H\nx", args=["--strict"])
        self.assertEqual(result.returncode, 1)
        self.assertTrue(result.report["settings"]["strict"])
        self.assertGreater(result.report["summary"]["warning_count"], 0)
        self.assertEqual(result.report["summary"]["error_count"], 0)

    def test_info_only_does_not_fail_strict_mode(self):
        result = self.json_check("### H\n" + "正" * 80, args=["--strict"])
        self.assertEqual(result.returncode, 0)
        self.assertGreater(result.report["summary"]["info_count"], 0)
        self.assertEqual(result.report["summary"]["warning_count"], 0)

    def test_multiple_chunks_are_warnings_not_default_failure(self):
        result = self.json_check("# H\n" + "甲" * 80 + "\n\n" + "乙" * 80)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(codes(result.report, "warning"), ["MULTIPLE_CHUNKS"])

    def test_split_mode_cli_changes_chunk_count(self):
        text = "# H\nfirst\n\nsecond"
        blank = self.json_check(text)
        headings = self.json_check(text, args=["--split-mode", "headings"])
        self.assertEqual(blank.report["summary"]["chunk_count"], 2)
        self.assertEqual(headings.report["summary"]["chunk_count"], 1)
        self.assertEqual(headings.report["settings"]["split_mode"], "headings")

    def test_document_errors_return_one_not_input_error(self):
        for text, code in [("", "EMPTY_DOCUMENT"), ("# H\n" + "长" * 2050, "OVERLONG_CHUNK"),
                           ("# H\n```\nx", "UNCLOSED_FENCE")]:
            with self.subTest(code=code):
                result = self.json_check(text)
                self.assertEqual(result.returncode, 1)
                self.assertIn(code, codes(result.report, "error"))

    def test_schema_is_complete_and_contains_no_original_body(self):
        secret = "PRIVATE_BUSINESS_BODY_不应复制到日志"
        result = self.json_check("# 可见标题\n" + secret + "\n\n" + secret)
        report = result.report
        self.assertEqual(set(report), {"schema_version", "file", "model", "settings", "summary", "findings", "chunks"})
        self.assertEqual(report["file"], "input.md")
        self.assertEqual(set(report["summary"]), {"heading_count", "chunk_count", "max_chunk_chars", "error_count", "warning_count", "info_count"})
        self.assertNotIn(secret, result.stdout)
        for finding in report["findings"]:
            self.assertEqual(set(finding), {"severity", "code", "line", "end_line", "message"})
            self.assertIn(finding["severity"], ["error", "warning", "info"])
        for chunk in report["chunks"]:
            self.assertEqual(set(chunk), {"index", "heading", "line", "end_line", "chars"})
            self.assertEqual(chunk["heading"], "可见标题")

    def test_json_parameter_errors_are_single_json_to_stdout(self):
        for args in [["--format", "json"], ["input.md", "--bad", "--format=json"],
                     ["--format=json", "input.md", "--split-mode", "bad"],
                     ["input.md", "--max-chars", "bad", "--format", "json"],
                     ["input.md", "--format", "json", "--min-chars"]]:
            with self.subTest(args=args):
                result = self.run_check(args=args)
                report = json.loads(result.stdout)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stderr, "")
                self.assertEqual(report["schema_version"], 1)
                self.assertEqual(report["summary"]["error_count"], 1)
                self.assertEqual(codes(report), ["INVALID_ARGUMENTS"])

    def test_missing_argument_and_unknown_options_have_usage_without_traceback(self):
        for args in [[], ["input.md", "--split-mode", "bad"], ["input.md", "--max", "100"]]:
            with self.subTest(args=args):
                result = self.run_check(args=args)
                self.assertEqual(result.returncode, 2)
                self.assertIn("usage:", result.stderr)
                self.assertIn("参数错误", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                result.opener.assert_not_called()

    def test_file_and_encoding_errors_are_json_and_return_two(self):
        for error, code in [(FileNotFoundError("missing"), "FILE_ERROR"),
                            (PermissionError("denied"), "FILE_ERROR"),
                            (IsADirectoryError("directory"), "FILE_ERROR"),
                            (ValueError("embedded null byte"), "FILE_ERROR"),
                            (UnicodeDecodeError("utf8", b"\xff", 0, 1, "bad byte"), "ENCODING_ERROR")]:
            with self.subTest(code=code, error=type(error).__name__):
                result = self.json_check(input_error=error)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(codes(result.report), [code])
                self.assertEqual(result.report["chunks"], [])
                self.assertEqual(result.report["summary"]["error_count"], 1)

    def test_file_error_text_is_clear(self):
        result = self.run_check(input_error=FileNotFoundError("missing"))
        self.assertEqual(result.returncode, 2)
        self.assertIn("FILE_ERROR", result.stdout)
        self.assertIn("无法读取 UTF-8", result.stdout)
        self.assertNotIn("Traceback", result.stdout + result.stderr)

    def test_read_error_after_open_is_handled(self):
        output = io.StringIO()
        opener = mock.mock_open()
        opener.return_value.read.side_effect = UnicodeError("bad encoding")
        with (mock.patch.object(CHECK_DOC, "open", opener, create=True), redirect_stdout(output)):
            status = CHECK_DOC.main(["x.md", "--format=json"])
        self.assertEqual(status, 2)
        self.assertIn("ENCODING_ERROR", codes(json.loads(output.getvalue())))

    def test_help_is_normal_help_even_with_json_mode(self):
        result = self.run_check(args=["--format", "json", "-h"])
        self.assertEqual(result.returncode, 0)
        self.assertIn("usage:", result.stdout)
        self.assertIn("--max-chars", result.stdout)
        self.assertIn("--strict", result.stdout)
        self.assertEqual(result.stderr, "")
        result.opener.assert_not_called()

    def test_plain_text_extension_and_space_in_filename_are_accepted(self):
        result = self.run_check("未知格式的纯文本", args=["folder with spaces/document.custom", "--format=json"])
        self.assertEqual(result.returncode, 0)
        result.opener.assert_called_once_with("folder with spaces/document.custom", encoding="utf-8-sig")
        self.assertIn("UNTITLED_CONTENT", codes(json.loads(result.stdout)))

    def test_tables_lists_and_crlf_are_read_only_no_write_call(self):
        text = "\ufeff# H\r\n- first\r\n  continued\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n"
        result = self.run_check(text, args=["readonly.md", "--format=json"])
        self.assertEqual(result.returncode, 0)
        result.opener.assert_called_once_with("readonly.md", encoding="utf-8-sig")
        result.opener.return_value.write.assert_not_called()
        result.opener.return_value.writelines.assert_not_called()
        result.opener.return_value.truncate.assert_not_called()
        result.opener.return_value.read.assert_called_once_with()
        self.assertEqual(json.loads(result.stdout)["summary"]["chunk_count"], 2)

    def test_end_of_options_does_not_treat_filename_as_json_flag(self):
        result = self.run_check(args=["--", "--format=json"])
        self.assertEqual(result.returncode, 0)
        self.assertTrue(result.stdout.startswith("文件:"))
        result.opener.assert_called_once_with("--format=json", encoding="utf-8-sig")


if __name__ == "__main__":
    unittest.main()
