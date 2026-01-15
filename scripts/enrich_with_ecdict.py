#!/usr/bin/env python3
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_CSV = ROOT / "toeic_vocab_processed.csv"
ECDICT_CSV = ROOT / "data" / "ecdict.csv"
OUTPUT_CSV = ROOT / "toeic_vocab_ecdict.csv"
OUTPUT_JSON = ROOT / "public" / "dict" / "ecdict.json"

HEADER_EXTENSION = ["ecdict_zh", "ecdict_pos"]


def normalize_term(term: str) -> str:
    return re.sub(r"\s+", " ", term.strip().lower())


def normalize_translation(text: str) -> str:
    cleaned = re.sub(r"\s*\n\s*", "; ", text.strip())
    cleaned = re.sub(r";\s*;", "; ", cleaned)
    return cleaned


def parse_toeic_rows():
    with SOURCE_CSV.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        header = []
        for raw_row in reader:
            if raw_row and any(cell.strip() for cell in raw_row):
                header = raw_row
                break

        header_length = len(header)
        if header_length == 0:
            raise RuntimeError("Empty TOEIC CSV header")

        rows = []
        for raw_row in reader:
            if not raw_row or not any(cell.strip() for cell in raw_row):
                continue

            row = list(raw_row)
            if len(row) < header_length:
                row.extend([""] * (header_length - len(row)))
            elif len(row) > header_length:
                tail_length = header_length - 2
                chinese = ",".join(row[1 : len(row) - tail_length])
                row = [row[0], chinese] + row[-tail_length:]

            rows.append(row)

    return header, rows


def build_ecdict_map(lookup_words):
    ecdict_map = {}

    with ECDICT_CSV.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for entry in reader:
            word = normalize_term(entry.get("word", ""))
            if not word or word not in lookup_words:
                continue

            translation = normalize_translation(entry.get("translation", ""))
            pos = entry.get("pos", "").strip()
            if not translation:
                continue

            existing = ecdict_map.get(word, {"zh": [], "pos": []})
            if translation and translation not in existing["zh"]:
                existing["zh"].append(translation)
            if pos and pos not in existing["pos"]:
                existing["pos"].append(pos)
            ecdict_map[word] = existing

    return {
        word: {
            "zh": "; ".join(data["zh"]),
            "pos": " / ".join(data["pos"]),
        }
        for word, data in ecdict_map.items()
    }


def main():
    if not SOURCE_CSV.exists():
        raise SystemExit(f"Missing source CSV: {SOURCE_CSV}")
    if not ECDICT_CSV.exists():
        raise SystemExit(f"Missing ECDICT CSV: {ECDICT_CSV}")

    header, rows = parse_toeic_rows()
    if "English" not in header:
        raise SystemExit("English column not found in TOEIC CSV")

    english_index = header.index("English")
    lookup_words = {normalize_term(row[english_index]) for row in rows}

    ecdict_map = build_ecdict_map(lookup_words)

    output_header = header + HEADER_EXTENSION
    output_rows = []

    for row in rows:
        english = normalize_term(row[english_index])
        entry = ecdict_map.get(english, {})
        ecdict_zh = entry.get("zh", "")
        ecdict_pos = entry.get("pos", "")
        output_rows.append(row + [ecdict_zh, ecdict_pos])

    OUTPUT_CSV.write_text("", encoding="utf-8")
    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(output_header)
        writer.writerows(output_rows)

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(
        json.dumps(ecdict_map, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Wrote {OUTPUT_CSV}")
    print(f"Wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
