import copy
import json
import tempfile
import unittest
from pathlib import Path

import pymupdf

from scripts.update_data import changes_between, color_category, parse_block, parse_quota, publish


def snapshot(at="2026-10-21T12:00:00Z"):
    return {
        "checkedAt": at,
        "quota": {"modifiedAt": "2026-10-21 20:00",
                  "courts": {"kai-yeung": {"name": "Kai Yeung", "remaining": 330, "total": 1090}}},
        "blocks": {"kai-yeung-b": {
            "court": "kai-yeung", "block": "B", "modifiedAt": "2026-10-21 20:00",
            "remaining": 1, "bands": {"small": {"min": 26.1, "max": 27.7}},
            "flats": [{"n": 4019, "f": 40, "u": 19, "s": "available", "a": "small"}],
        }},
    }


class PdfParserTests(unittest.TestCase):
    def test_ying_fai_b_brochure_range_matches_floor_plan_links(self):
        source = next(Path("docs/factsheet").glob("*Ying Fai*.pdf"))
        with pymupdf.open(source) as document:
            self.assertIn("Block A 3/F - 39/F Floor Plan", document[4].get_text())
            self.assertIn("Block B 4/F - 38/F Floor Plan", document[5].get_text())

    def test_quota_is_court_wide_and_does_not_count_flats(self):
        document = pymupdf.open()
        page = document.new_page()
        page.insert_text((20, 30), "KAI YEUNG COURT (1090) 330")
        page.insert_text((20, 50), "YING FAI COURT (1408) 560")
        page.insert_text((20, 70), "Last Modified Date : 2026-10-21 21:22")
        page.insert_text((20, 90), "Priority Scheme for Families with Elderly Members and/or Families with Newborns")
        result = parse_quota(document.tobytes())
        self.assertEqual(result["courts"]["kai-yeung"]["remaining"], 330)
        self.assertEqual(result["courts"]["ying-fai"]["remaining"], 560)
        self.assertEqual(result["modifiedAt"], "2026-10-21 21:22")

    def test_legend_colors_are_size_categories(self):
        self.assertEqual(color_category((0.54118, 0.7137, 0.4314), "kai-yeung"), "small")
        self.assertEqual(color_category((0.518, 0.259, 0), "ying-fai"), "xlarge")
        with self.assertRaises(ValueError):
            color_category((0.4, 0.4, 0.4), "kai-yeung")

    def test_vector_squares_distinguish_available_sold_and_selected(self):
        document = pymupdf.open()
        page = document.new_page(width=1190, height=842)
        page.insert_text((147, 216), "40/F", fontsize=10)
        for unit, color in ((1, (0.541, 0.714, 0.431)), (2, (1, 1, 1)), (3, (1, 1, 1))):
            x = 178 + (unit - 1) * 30
            square = pymupdf.Rect(x, 198, x + 24, 216)
            page.draw_rect(square, fill=color, color=(0.8, 0.8, 0.8))
            page.insert_text((x, 223), f"400{unit}", fontsize=6)
            if unit == 2:
                page.draw_line(square.bl, square.tr)
                page.draw_line(square.br, square.tl)
        page.insert_text((20, 470), "No. of remaining flat(s) (BLOCK B)")
        page.insert_text((20, 485), "1")
        page.insert_text((20, 500), "Last Modified Date : 2026-10-21 21:22")
        page.insert_text((20, 590), "Family with Elderly and/ Family with Newborns")
        for row, size in enumerate(("26.1 - 27.7", "34.8 - 36.5", "43.1 - 44.4")):
            page.insert_text((20, 520 + 15 * row), f"[ {size} Saleable Area (sq. metre) ]")
        block = parse_block(document.tobytes(), "kai-yeung-b")
        self.assertEqual([flat["s"] for flat in block["flats"]], ["available", "sold", "selected"])
        self.assertEqual(block["remaining"], 1)


class HistoryTests(unittest.TestCase):
    def test_publish_commits_only_official_changes_and_keeps_reverse_diff(self):
        first = snapshot()
        second = copy.deepcopy(first)
        second["checkedAt"] = "2026-10-21T13:15:00Z"
        second["quota"]["courts"]["kai-yeung"]["remaining"] = 329
        second["quota"]["modifiedAt"] = "2026-10-21 21:15"
        block = second["blocks"]["kai-yeung-b"]
        block["modifiedAt"] = "2026-10-21 21:15"
        block["remaining"] = 0
        block["flats"][0]["s"] = "sold"
        block["flats"][0]["a"] = None
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            self.assertTrue(publish(first, output))
            self.assertTrue(publish(second, output))
            history = json.loads((output / "history.json").read_text(encoding="utf-8"))
            self.assertEqual(len(history["events"]), 1)
            self.assertNotIn("samples", history)
            self.assertEqual(history["events"][0]["blocks"]["kai-yeung-b"]["flats"][0]["before"]["s"], "available")
            self.assertEqual(history["events"][0]["blocks"]["kai-yeung-b"]["flats"][0]["after"]["s"], "sold")
            self.assertEqual(history["events"][0]["beforeQuota"]["courts"]["kai-yeung"]["remaining"], 330)
            self.assertFalse(publish({**second, "checkedAt": "2026-10-21T13:30:00Z"}, output))
            self.assertEqual(len(json.loads((output / "history.json").read_text())["events"]), 1)
            self.assertEqual(json.loads((output / "latest.json").read_text())["checkedAt"],
                             "2026-10-21T13:30:00Z")
            self.assertEqual(json.loads((output / "heartbeat.json").read_text())["checkedAt"],
                             "2026-10-21T13:30:00Z")

    def test_legacy_samples_are_removed_without_creating_new_events(self):
        first = snapshot()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            publish(first, output)
            old_history = {"startedAt": first["checkedAt"], "events": [],
                           "samples": [{"at": first["checkedAt"], "quota": {"kai-yeung": 330}}]}
            (output / "history.json").write_text(json.dumps(old_history), encoding="utf-8")
            self.assertFalse(publish({**first, "checkedAt": "2026-10-21T12:15:00Z"}, output))
            self.assertNotIn("samples", json.loads((output / "history.json").read_text()))

    def test_legend_change_is_preserved_in_history(self):
        first = snapshot()
        second = copy.deepcopy(first)
        second["checkedAt"] = "2026-10-21T13:00:00Z"
        second["blocks"]["kai-yeung-b"]["bands"]["small"]["max"] = 28.0
        event = changes_between(first, second)
        self.assertEqual(event["blocks"]["kai-yeung-b"]["beforeBands"]["small"]["max"], 27.7)
        self.assertEqual(event["blocks"]["kai-yeung-b"]["afterBands"]["small"]["max"], 28.0)

    def test_layout_change_stops_publication(self):
        first = snapshot()
        second = copy.deepcopy(first)
        second["blocks"]["kai-yeung-b"]["flats"] = []
        with self.assertRaisesRegex(ValueError, "Flat layout changed"):
            changes_between(first, second)


if __name__ == "__main__":
    unittest.main()
