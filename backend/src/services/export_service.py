import csv
import uuid
from pathlib import Path
from datetime import datetime

import openpyxl
from openpyxl.styles import Font

from src.core.config import EXPORT_DIR


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


def export_rows_to_xlsx_in_directory(rows: list[dict], target_dir: str | Path) -> Path:
    if not rows:
        raise ValueError("Нет данных для экспорта")

    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = target / f"analysis_export_{timestamp}.xlsx"

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
