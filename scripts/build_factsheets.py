"""Render the supplied brochure excerpts for fast, in-page floor-plan previews."""

from pathlib import Path
from shutil import copyfile

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "web" / "assets"
BROCHURES = ROOT / "web" / "brochures"
PAGES = {"kai-yeung": (4, 5, 6, 7, 8), "ying-fai": (4, 5, 6)}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    BROCHURES.mkdir(parents=True, exist_ok=True)
    for slug, pages in PAGES.items():
        source = next(ROOT.glob(f"docs/factsheet/*{'Kai Yeung' if slug == 'kai-yeung' else 'Ying Fai'}*.pdf"))
        with pymupdf.open(source) as document:
            for number in pages:
                page = document[number - 1]
                scale = min(1.6, 1800 / page.rect.width)
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                pixmap.pil_image().save(OUTPUT / f"{slug}-{number}.webp", "WEBP", quality=81)
        copyfile(source, BROCHURES / f"{slug}.pdf")
        print(f"Rendered {slug}: {', '.join(map(str, pages))}")


if __name__ == "__main__":
    main()
