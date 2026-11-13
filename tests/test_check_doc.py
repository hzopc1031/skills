"""Standard-library regression tests for the corrected photo-restored checker.

From repository root: python -B -m unittest discover -s tests -v
Photo-original behavior and corrections are documented in
knowledge-base-doc-authoring/references/restoration-notes.md.
These tests do not establish compatibility with a particular Dify version.
"""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "knowledge-base-doc-authoring"
    / "scripts"
    / "check_doc.py"
)
SPEC = importlib.util.spec_from_file_location("photographed_check_doc", SCRIPT_PATH)
CHECK_DOC = importlib.util.module_from_spec(SPEC)
# Loading the source must not create __pycache__ outside our temporary fixtures.
_previous_bytecode_setting = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    SPEC.loader.exec_module(CHECK_DOC)
finally:
    sys.dont_write_bytecode = _previous_bytecode_setting


def chunks_from(text):
    return CHECK_DOC.split_chunks(CHECK_DOC.split_documents(text.split("\n")))


class SplitDocumentsTests(unittest.TestCase):
    def test_heading_levels_become_separate_documents(self):
        docs = CHECK_DOC.split_documents(
            ["# 第一章", "第一段", "## 第二章", "第二段", "### 第三章", "第三段"]
        )
        self.assertEqual(
            docs,
            [("第一章", "第一段"), ("第二章", "第二段"), ("第三章", "第三段")],
        )

    def test_fenced_headings_stay_inside_body(self):
        lines = ["# 章节", "  ```python", "### 代码而非标题", "```", "正文"]
        self.assertEqual(
            CHECK_DOC.split_documents(lines),
            [("章节", "  ```python\n### 代码而非标题\n```\n正文")],
        )

    def test_heading_requires_column_zero_and_whitespace(self):
        lines = ["# 标题", "  ## 缩进", "##没有空格", "####\t子标题", "内容"]
        self.assertEqual(
            CHECK_DOC.split_documents(lines),
            [("标题", "  ## 缩进\n##没有空格"), ("子标题", "内容")],
        )

    def test_empty_input_produces_no_documents(self):
        self.assertEqual(CHECK_DOC.split_documents([]), [])

    def test_regression_preamble_should_not_be_lost(self):
        docs = CHECK_DOC.split_documents(["首标题之前的内容", "# 标题", "正文"])
        self.assertIn("首标题之前的内容", "\n".join(body for _, body in docs))

    def test_regression_hashes_inside_title_should_be_preserved(self):
        docs = CHECK_DOC.split_documents(["# C# 与 #标签", "正文"])
        self.assertEqual(docs[0][0], "C# 与 #标签")


class SplitChunksTests(unittest.TestCase):
    def test_title_and_nonblank_body_are_one_chunk(self):
        self.assertEqual(CHECK_DOC.split_chunks([("标题", "正文\n续行")]), ["标题\n正文\n续行"])

    def test_blank_line_splits_without_repeating_title(self):
        self.assertEqual(
            CHECK_DOC.split_chunks([("标题", "首段\n\n次段")]),
            ["标题\n首段", "次段"],
        )

    def test_blank_parts_are_removed_and_surviving_parts_stripped(self):
        self.assertEqual(
            CHECK_DOC.split_chunks([("标题", " 首段 \n\n\n\n 次段 \n")]),
            ["标题\n 首段", "次段"],
        )
        self.assertEqual(CHECK_DOC.split_chunks([]), [])
        self.assertEqual(CHECK_DOC.split_chunks([("", "")]), [])

    def test_blank_body_keeps_title_only(self):
        self.assertEqual(CHECK_DOC.split_chunks([("标题", " \n \n")]), ["标题"])

    def test_current_behavior_splits_blank_lines_inside_fence(self):
        text = "# 标题\n```python\nfirst = 1\n\nsecond = 2\n```"
        self.assertEqual(chunks_from(text), ["标题\n```python\nfirst = 1", "second = 2\n```"])


class MainTests(unittest.TestCase):
    def run_check(self, text=None, max_chars=None):
        """Exercise real main logic; mock only input I/O, argv and output streams.

        This is an in-process unit test, not a subprocess/entrypoint integration
        test. It requires no writable temporary directory, so it also runs in a
        read-only Windows worker. Algorithm exceptions deliberately propagate.
        """
        arguments = [str(SCRIPT_PATH)]
        if text is not None:
            arguments.append("知识库文档.md")
        if max_chars is not None:
            arguments.append(str(max_chars))
        output, errors = io.StringIO(), io.StringIO()
        with (
            mock.patch.object(sys, "argv", arguments),
            mock.patch.object(CHECK_DOC, "open", mock.mock_open(read_data=text or ""), create=True),
            redirect_stdout(output),
            redirect_stderr(errors),
        ):
            status = CHECK_DOC.main()
        return SimpleNamespace(returncode=status, stdout=output.getvalue(), stderr=errors.getvalue())

    def test_valid_title_with_sixty_plus_body_characters_passes(self):
        result = self.run_check("# 有效标题\n" + "正" * 80 + "\n")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Document 数（标题数）: 1", result.stdout)
        self.assertIn("块数: 1", result.stdout)
        self.assertIn("小于 60 字符的块: 0", result.stdout)
        self.assertIn("排版检查通过。", result.stdout)

    def test_same_title_blank_line_produces_multiple_chunks(self):
        result = self.run_check("# 标题\n" + "甲" * 70 + "\n\n" + "乙" * 70)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("块数: 2", result.stdout)
        self.assertIn("一个标题下切出多块的标题数: 1", result.stdout)
        self.assertIn("存在 1 个标题下切出多块", result.stdout)

    def test_default_maximum_is_2048_and_overlong_chunk_is_not_split(self):
        for size, expected_status in [(2048, 0), (2049, 1)]:
            with self.subTest(chunk_size=size):
                text = "# 节\n" + "长" * (size - 2)
                self.assertEqual(len(chunks_from(text)[0]), size)
                result = self.run_check(text)
                self.assertEqual(result.returncode, expected_status, result.stdout + result.stderr)
                self.assertIn("块数: 1", result.stdout)
                self.assertIn(f"最长块: {size} 字符", result.stdout)
                self.assertIn(f"超过 2048 字符的块: {int(size > 2048)}", result.stdout)

    def test_custom_maximum_uses_strictly_greater_than(self):
        text = "# 节\n" + "正" * 78
        self.assertEqual(len(chunks_from(text)[0]), 80)
        for limit, expected_status in [(79, 1), (80, 0), (81, 0)]:
            with self.subTest(limit=limit):
                result = self.run_check(text, max_chars=limit)
                self.assertEqual(result.returncode, expected_status, result.stdout + result.stderr)
                self.assertIn(f"超过 {limit} 字符的块: {int(80 > limit)}", result.stdout)

    def test_orphan_table_introduction_is_reported(self):
        introduction = "# 标题\n" + "引" * 70
        table = "| " + "字段" * 35 + " |\n| --- |\n| 值 |"
        result = self.run_check(introduction + "\n\n" + table)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("表格块: 1", result.stdout)
        self.assertIn("表格前的孤儿引导句（< 100 字符）: 1", result.stdout)
        self.assertIn("存在 1 处表格前孤儿引导句", result.stdout)
        self.assertIn("小于 60 字符的块: 0", result.stdout)

    def test_orphan_threshold_is_strictly_less_than_100(self):
        table = "| " + "字段" * 35 + " |\n| --- |\n| 值 |"
        for size in [99, 100]:
            with self.subTest(introduction_size=size):
                introduction = "# 节\n" + "引" * (size - 2)
                result = self.run_check(introduction + "\n\n" + table)
                self.assertIn(
                    f"表格前的孤儿引导句（< 100 字符）: {int(size < 100)}",
                    result.stdout,
                )
                # Multiple chunks still independently make this document fail.
                self.assertEqual(result.returncode, 1)

    def test_level_three_heading_is_counted_but_does_not_block(self):
        result = self.run_check("### 模块标题\n" + "正" * 80)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("三级标题 ###: 1", result.stdout)
        self.assertIn("排版检查通过。", result.stdout)
        self.assertNotIn("需要处理", result.stdout)

    def test_tiny_threshold_is_strictly_less_than_60(self):
        self.assertEqual(CHECK_DOC.TINY_CHARS, 60)
        for size, expected_status in [(59, 1), (60, 0)]:
            with self.subTest(chunk_size=size):
                result = self.run_check("# 节\n" + "正" * (size - 2))
                self.assertEqual(result.returncode, expected_status, result.stdout + result.stderr)
                self.assertIn(f"小于 60 字符的块: {int(size < 60)}", result.stdout)

    def test_three_newlines_between_sections_are_reported(self):
        result = self.run_check("# 甲\n" + "甲" * 70 + "\n\n\n# 乙\n" + "乙" * 70)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("连续空行（3 个及以上）: 1", result.stdout)
        self.assertIn("存在连续空行：收敛为一个空行", result.stdout)
        self.assertIn("一个标题下切出多块的标题数: 0", result.stdout)

    def test_internal_blank_line_numbers_exclude_final_separator(self):
        text = "# 章节\n" + "甲" * 70 + "\n\n" + "乙" * 70 + "\n\n# 次节\n" + "丙" * 70
        result = self.run_check(text)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("标题内部的空行（会导致该节多切一块）: 1 处", result.stdout)
        self.assertIn("行 [3]", result.stdout)

    def test_no_argument_prints_usage_and_returns_two(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("用法: python check_doc.py", result.stdout)

    def test_regression_unheaded_document_should_not_traceback(self):
        result = self.run_check("无标题的正文" * 80)
        self.assertNotIn("Traceback", result.stderr)

    def test_regression_empty_heading_should_fail_without_traceback(self):
        result = self.run_check("# \n")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Traceback", result.stderr)

    def test_regression_noninteger_maximum_should_be_a_usage_error(self):
        result = self.run_check("# 标题\n" + "正" * 80, max_chars="not-an-integer")
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("Traceback", result.stderr)

    def test_regression_nonpositive_maximum_should_be_a_usage_error(self):
        for maximum in [0, -1]:
            result = self.run_check("# 标题\n" + "正" * 80, max_chars=maximum)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn("Traceback", result.stderr)

    def test_regression_empty_document_should_fail_without_traceback(self):
        result = self.run_check("")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Traceback", result.stderr)

    def test_regression_single_internal_blank_should_be_counted(self):
        result = self.run_check("# 章节\n" + "甲" * 70 + "\n\n" + "乙" * 70)
        self.assertIn("标题内部的空行（会导致该节多切一块）: 1 处", result.stdout)


if __name__ == "__main__":
    unittest.main()
