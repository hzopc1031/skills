"""Repository contracts: immutable baselines and usable local Skill references."""

import hashlib
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "knowledge-base-doc-authoring"


class SkillContractTests(unittest.TestCase):
    def test_photo_original_script_is_unchanged(self):
        original = SKILL / "references/check_doc.photo-original.py.txt"
        self.assertEqual(
            hashlib.sha256(original.read_bytes()).hexdigest(),
            "24417d10d2157bf898dd9c478087a1993e66d8d8e0b46013ea2508ec966ee0dc",
        )

    def test_v1_document_snapshots_are_unchanged(self):
        expected = {
            "skill.photo-restored-v1.md.txt": "33ad4ab19b959432969feec25f47250ef22d630f96e2a4bf596d65a71cbd093a",
            "fault-analysis.photo-restored-v1.md.txt": "ac9bd373901d42fc7298e2e434500317a552a1e5e4f45cb4b62fc9960610bde5",
        }
        for filename, digest in expected.items():
            with self.subTest(filename=filename):
                self.assertEqual(
                    hashlib.sha256((SKILL / "references" / filename).read_bytes()).hexdigest(),
                    digest,
                )

    def test_skill_name_description_and_references_are_present(self):
        entry = SKILL / "SKILL.md"
        text = entry.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: knowledge-base-doc-authoring\ndescription: "))
        self.assertIn("\n---\n", text[4:])
        for relative in (
            "references/fault-analysis.md",
            "references/report-template.md",
            "references/restoration-notes.md",
            "scripts/check_doc.py",
        ):
            with self.subTest(relative=relative):
                self.assertTrue((SKILL / relative).is_file())

    def test_markdown_local_file_links_resolve_inside_repository(self):
        checked = 0
        for path in ROOT.rglob("*.md"):
            if ".git" in path.relative_to(ROOT).parts:
                continue
            for destination in re.findall(r"\]\(<([^>]+)>\)", path.read_text(encoding="utf-8")):
                if "://" in destination or destination.startswith("#"):
                    continue
                with self.subTest(source=str(path.relative_to(ROOT)), destination=destination):
                    target = (path.parent / destination.split("#", 1)[0]).resolve()
                    self.assertTrue(target.is_relative_to(ROOT))
                    self.assertTrue(target.is_file())
                checked += 1
        self.assertGreaterEqual(checked, 8)


if __name__ == "__main__":
    unittest.main()
