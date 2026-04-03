import csv
import re
import uuid
from pathlib import Path
from datetime import datetime

import openpyxl
from openpyxl.styles import Font

from src.core.config import EXPORT_DIR


WINDOWS_RESERVED_FILENAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}


def export_rows(rows: list[dict], fmt: str) -> Path:
    if not rows:
        raise ValueError("Нет данных для экспорта")

    file_id = uuid.uuid4().hex[:10]
    if fmt == "xlsx":
        out_file = EXPORT_DIR / f"export_{file_id}.xlsx"
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Данные"
        headers = list(rows[0].keys())
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for row in rows:
            ws.append([row.get(h, "") for h in headers])
        wb.save(str(out_file))
        return out_file

    if fmt == "csv":
        out_file = EXPORT_DIR / f"export_{file_id}.csv"
        with open(out_file, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys(), delimiter=";")
            writer.writeheader()
            writer.writerows(rows)
        return out_file

    raise ValueError("Неподдерживаемый формат")


def _build_default_export_name() -> str:
    return f"data_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def _sanitize_filename(filename: str | None) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]+', "_", (filename or "").strip())
    cleaned = cleaned.rstrip(". ")
    if not cleaned:
        cleaned = _build_default_export_name()

    stem = Path(cleaned).stem.strip() or _build_default_export_name()
    stem = stem.rstrip(". ") or _build_default_export_name()
    if stem.upper() in WINDOWS_RESERVED_FILENAMES:
        stem = f"{stem}_file"
    return f"{stem}.xlsx"


def _build_unique_path(target: Path) -> Path:
    if not target.exists():
        return target

    index = 1
    while True:
        candidate = target.with_name(f"{target.stem}_{index}{target.suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def export_rows_to_xlsx_in_directory(rows: list[dict], target_dir: str | Path, filename: str | None = None) -> Path:
    if not rows:
        raise ValueError("Нет данных для экспорта")

    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)

    out_file = _build_unique_path(target / _sanitize_filename(filename))

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Данные"

    headers = list(rows[0].keys())
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for row in rows:
        ws.append([row.get(h, "") for h in headers])

    wb.save(str(out_file))
    return out_file
