"""Parse Housing Authority PDFs into versioned, static dashboard data."""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pymupdf

BASE_URL = "https://www.housingauthority.gov.hk/mini-site/hos2025/common/pdf/status/"
COURTS = {"kai-yeung": "KAI YEUNG COURT", "ying-fai": "YING FAI COURT"}
FILES = {
    "quota": "status-court-quota.pdf",
    "kai-yeung-a": "status-kai-yeung-a.pdf",
    "kai-yeung-b": "status-kai-yeung-b.pdf",
    "ying-fai-a": "status-ying-fai-a.pdf",
    "ying-fai-b": "status-ying-fai-b.pdf",
}
# The official legend uses the same color for each size rank across both courts.
PALETTE = {
    "kai-yeung": {
        "small": (0.541, 0.714, 0.431),
        "medium": (0.306, 0.471, 0.208),
        "large": (0.078, 0.247, 0.0),
    },
    "ying-fai": {
        "small": (1.0, 0.894, 0.792),
        "medium": (1.0, 0.733, 0.467),
        "large": (0.824, 0.412, 0.0),
        "xlarge": (0.518, 0.259, 0.0),
    },
}
SIZE_KEYS = ("small", "medium", "large", "xlarge")
STAMP = re.compile(r"Last Modified Date\s*:\s*(\d{4}-\d\d-\d\d \d\d:\d\d)")
AREA = re.compile(r"\[\s*([\d.]+)\s*-\s*([\d.]+)\s*Saleable Area")


def required(pattern: re.Pattern[str] | str, text: str, label: str) -> re.Match[str]:
    match = re.search(pattern, text) if isinstance(pattern, str) else pattern.search(text)
    if match is None:
        raise ValueError(f"Missing {label} in official PDF")
    return match


def read_pdfs(pdf_dir: Path | None) -> dict[str, bytes]:
    result = {}
    for key, filename in FILES.items():
        if pdf_dir is None:
            request = urllib.request.Request(BASE_URL + filename, headers={"User-Agent": "hos2025-dashboard/1.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read(3_000_001)
        else:
            data = (pdf_dir / filename).read_bytes()
        if not data.startswith(b"%PDF") or len(data) > 3_000_000:
            raise ValueError(f"Invalid PDF: {filename}")
        result[key] = data
    return result


def parse_quota(data: bytes) -> dict:
    with pymupdf.open(stream=data, filetype="pdf") as document:
        text = "\n".join(page.get_text() for page in document)
    if "Priority Scheme for Families with" not in text or "Newborns" not in text:
        raise ValueError("Quota PDF does not confirm the elderly/newborn priority stage")
    courts = {}
    for slug, title in COURTS.items():
        match = required(rf"{title}\s*\((\d+)\)\s*(\d+)", text, title)
        courts[slug] = {"name": "啟陽苑" if slug == "kai-yeung" else "影輝苑",
                        "total": int(match[1]), "remaining": int(match[2])}
    return {"modifiedAt": required(STAMP, text, "quota timestamp")[1], "courts": courts}


def color_category(color: tuple[float, ...], court: str) -> str:
    for category, expected in PALETTE[court].items():
        if all(abs(actual - reference) < 0.006 for actual, reference in zip(color, expected)):
            return category
    raise ValueError(f"Unknown {court} availability color: {color}")


def extract_flats(page: pymupdf.Page, court: str, max_unit: int) -> list[dict]:
    words = page.get_text("words")
    floors = [word for word in words if re.fullmatch(r"\d{1,2}/F", word[4]) and 180 < word[1] < 790]
    drawings = page.get_drawings()
    squares = [
        drawing for drawing in drawings
        if drawing["fill"] is not None
        and abs(drawing["rect"].width - 24) < 0.3
        and abs(drawing["rect"].height - 18) < 0.3
    ]
    diagonals: dict[tuple[float, float], set[int]] = {}
    for drawing in drawings:
        if drawing["fill"] is not None:
            continue
        for item in drawing["items"]:
            if item[0] != "l":
                continue
            dx = item[2].x - item[1].x
            dy = item[2].y - item[1].y
            if abs(dx) >= 20 and abs(dy) >= 16:
                key = (round(drawing["rect"].x0, 1), round(drawing["rect"].y0, 1))
                diagonals.setdefault(key, set()).add(1 if dx * dy > 0 else -1)
    crosses = {key for key, signs in diagonals.items() if len(signs) == 2}
    flats = []
    for word in words:
        number_text = word[4]
        if not re.fullmatch(r"\d{3,4}", number_text) or not floors:
            continue
        floor_word = min(floors, key=lambda marker: abs(marker[1] - word[1]))
        floor = int(floor_word[4].split("/")[0])
        number = int(number_text)
        unit = number % 100
        if not (1 <= unit <= max_unit and number // 100 == floor
                and word[0] > floor_word[2] and abs(word[1] - floor_word[1] - 11.62) < 1.5):
            continue
        square = next(
            (drawing for drawing in squares
             if abs(drawing["rect"].x0 - word[0]) < 0.5
             and 0 < word[1] - drawing["rect"].y1 < 2),
            None,
        )
        if square is None:
            raise ValueError(f"Missing status square for flat {number}")
        color = square["fill"]
        if all(abs(channel - 1) < 0.006 for channel in color):
            key = (round(square["rect"].x0, 1), round(square["rect"].y0, 1))
            status = "sold" if key in crosses else "selected"
            category = None
        else:
            status = "available"
            category = color_category(color, court)
        flats.append({"n": number, "f": floor, "u": unit, "s": status, "a": category})
    return flats


def parse_block(data: bytes, key: str) -> dict:
    court, block = key.rsplit("-", 1)
    max_unit = 17 if key == "kai-yeung-a" else 29 if key == "kai-yeung-b" else 22
    with pymupdf.open(stream=data, filetype="pdf") as document:
        footer = document[-1].get_text()
        if "Family with Elderly and/" not in footer or "Family with Newborns" not in footer:
            raise ValueError(f"{key}: PDF does not confirm the elderly/newborn priority stage")
        remaining = int(required(r"No\. of remaining flat\(s\) \(BLOCK [AB]\)\s*(\d+)", footer, "block count")[1])
        timestamp = required(STAMP, footer, "block timestamp")[1]
        ranges = AREA.findall(footer)
        if len(ranges) != len(PALETTE[court]):
            raise ValueError(f"Unexpected area legend for {key}: {ranges}")
        bands = {
            category: {"min": float(low), "max": float(high)}
            for category, (low, high) in zip(SIZE_KEYS, ranges)
        }
        flats = [flat for page in document for flat in extract_flats(page, court, max_unit)]
    numbers = [flat["n"] for flat in flats]
    if len(numbers) != len(set(numbers)):
        raise ValueError(f"Duplicate flats in {key}")
    actual = sum(flat["s"] == "available" for flat in flats)
    if actual != remaining:
        raise ValueError(f"{key}: parsed {actual} available flats; PDF says {remaining}")
    return {
        "court": court, "block": block.upper(), "modifiedAt": timestamp,
        "remaining": remaining, "bands": bands, "flats": sorted(flats, key=lambda flat: (-flat["f"], flat["u"])),
    }


def make_snapshot(pdfs: dict[str, bytes], checked_at: str) -> dict:
    quota = parse_quota(pdfs["quota"])
    blocks = {key: parse_block(pdfs[key], key) for key in FILES if key != "quota"}
    return {"checkedAt": checked_at, "quota": quota, "blocks": blocks}


def changes_between(before: dict, after: dict) -> dict | None:
    changes = {}
    for key, block in after["blocks"].items():
        previous = before["blocks"][key]
        old_flats = {flat["n"]: flat for flat in previous["flats"]}
        new_flats = {flat["n"]: flat for flat in block["flats"]}
        if old_flats.keys() != new_flats.keys():
            raise ValueError(f"Flat layout changed for {key}; manual parser review required")
        changed = [
            {"n": number, "before": old_flats[number], "after": flat}
            for number, flat in new_flats.items() if old_flats[number] != flat
        ]
        if (changed or block["modifiedAt"] != previous["modifiedAt"]
                or block["remaining"] != previous["remaining"] or block["bands"] != previous["bands"]):
            changes[key] = {
                "beforeModified": previous["modifiedAt"], "afterModified": block["modifiedAt"],
                "beforeRemaining": previous["remaining"], "afterRemaining": block["remaining"],
                "beforeBands": previous["bands"], "afterBands": block["bands"],
                "flats": changed,
            }
    if not changes and before["quota"] == after["quota"]:
        return None
    return {
        "at": after["checkedAt"], "beforeQuota": before["quota"], "afterQuota": after["quota"],
        "blocks": changes,
    }


def publish(snapshot: dict, output_dir: Path) -> bool:
    latest_path = output_dir / "latest.json"
    history_path = output_dir / "history.json"
    before = json.loads(latest_path.read_text(encoding="utf-8")) if latest_path.exists() else None
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {
        "startedAt": snapshot["checkedAt"], "events": []
    }
    history.pop("samples", None)
    changed = before is None
    if before:
        event = changes_between(before, snapshot)
        if event:
            history["events"].append(event)
            changed = True
    now = datetime.fromisoformat(snapshot["checkedAt"].replace("Z", "+00:00"))
    cutoff = now - timedelta(days=30)
    history["events"] = [
        event for event in history["events"]
        if datetime.fromisoformat(event["at"].replace("Z", "+00:00")) >= cutoff
    ]
    output_dir.mkdir(parents=True, exist_ok=True)
    for path, content in ((latest_path, snapshot), (history_path, history)):
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(path)
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf-dir", type=Path, help="Read saved official PDFs instead of downloading")
    parser.add_argument("--output", type=Path, default=Path("web/data"))
    args = parser.parse_args()
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    snapshot = make_snapshot(read_pdfs(args.pdf_dir), checked_at)
    changed = publish(snapshot, args.output)
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as github_output:
            github_output.write(f"changed={'true' if changed else 'false'}\n")
    print("Updated:", snapshot["quota"]["modifiedAt"], "changed:", changed,
          {key: block["remaining"] for key, block in snapshot["blocks"].items()})


if __name__ == "__main__":
    main()
