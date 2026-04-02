from datetime import datetime
from pathlib import Path

import openpyxl

from src.models.template_registry import Template


def _cast(value, expected_type: str):
    if value is None or str(value).strip() == "":
        raise ValueError("empty")

    t = expected_type.lower()
    if t == "str":
        return str(value)
    if t == "int":
        return int(float(str(value).replace(",", ".")))
    if t == "float":
        return float(str(value).replace(",", "."))
    if t == "date":
        if isinstance(value, datetime):
            return value.date().isoformat()
        raw = str(value).strip()
        for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(raw, fmt).date().isoformat()
            except ValueError:
                continue
        raise ValueError("date expected")
    if t == "bool":
        if isinstance(value, bool):
            return value
        low = str(value).strip().lower()
        if low == "да":
            return True
        if low == "нет":
            return False
        raise ValueError("bool expected")
    raise ValueError("unknown type")


def load_xlsx(file_path: str | Path, template: Template) -> tuple[list[dict], list[dict], int]:
    wb = openpyxl.load_workbook(str(file_path), data_only=True)
    ws = wb.worksheets[template.sheet_index]

    rows = list(ws.iter_rows(values_only=True))
    if len(rows) <= template.header_row:
        return [], [], 0

    header = [str(c).strip() if c is not None else "" for c in rows[template.header_row]]
    col_index = {name: idx for idx, name in enumerate(header)}

    valid_rows: list[dict] = []
    errors: list[dict] = []
    data_rows = rows[template.header_row + 1 :]

    for row_num, row in enumerate(data_rows, start=template.header_row + 2):
        row_data: dict = {}
        row_valid = True

        for spec in template.columns:
            if spec.name not in col_index:
                if spec.required:
                    errors.append({
                        "Строка": row_num,
                        "Колонка": spec.name,
                        "Ожидаемый тип": spec.expected_type,
                        "Фактическое значение": "<колонка отсутствует>",
                    })
                    row_valid = False
                continue

            raw = row[col_index[spec.name]]

            if spec.required and (raw is None or str(raw).strip() == ""):
                errors.append({
                    "Строка": row_num,
                    "Колонка": spec.name,
                    "Ожидаемый тип": spec.expected_type,
                    "Фактическое значение": "<пусто>",
                })
                row_valid = False
                continue

            if raw is None:
                row_data[spec.name] = None
                continue

            try:
                row_data[spec.name] = _cast(raw, spec.expected_type)
            except Exception:
                errors.append({
                    "Строка": row_num,
                    "Колонка": spec.name,
                    "Ожидаемый тип": spec.expected_type,
                    "Фактическое значение": str(raw),
                })
                row_valid = False

        if row_valid:
            valid_rows.append(row_data)

    return valid_rows, errors, len(data_rows)
