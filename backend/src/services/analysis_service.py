def _explode_by_column(rows: list[dict], target_column: str, category_value_getter) -> list[dict]:
    """
    Разворачивает строки по указанному столбцу.
    Для каждого фрагмента, разделенного запятой, создается отдельная строка.
    Если поле пустое/null, строка остается как есть (одна строка).
    """
    out: list[dict] = []

    def _with_category(row: dict, cell_value: str | None) -> dict:
        """Вставляет столбец Категория перед целевым столбцом."""
        out_row: dict = {}
        inserted = False
        category_value = category_value_getter(row)

        for key, value in row.items():
            if key == target_column:
                out_row["Категория"] = category_value
                out_row[target_column] = cell_value
                inserted = True
            else:
                out_row[key] = value

        if not inserted:
            out_row["Категория"] = category_value
            out_row[target_column] = cell_value

        return out_row

    for row in rows:
        raw_value = row.get(target_column)

        if raw_value is None or str(raw_value).strip() == "":
            out.append(_with_category(row, raw_value))
            continue

        fragments = [frag.strip() for frag in str(raw_value).split(",") if frag.strip()]
        if not fragments:
            out.append(_with_category(row, raw_value))
            continue

        for frag in fragments:
            out.append(_with_category(row, frag))

    return out


def run_analysis(rows: list[dict], mode: str = "prepare") -> list[dict]:
    if mode == "satisfaction":
        return _explode_by_column(
            rows,
            target_column="Удовлетворенность клиента",
            category_value_getter=lambda _row: "Удовлетворение",
        )

    return _explode_by_column(
        rows,
        target_column="причина_провала_(СВ)",
        category_value_getter=lambda row: row.get("причина_провала", ""),
    )
