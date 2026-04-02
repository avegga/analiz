from dataclasses import dataclass


@dataclass
class ColumnSpec:
    name: str
    expected_type: str
    required: bool = True


@dataclass
class Template:
    key: str
    display_name: str
    sheet_index: int
    header_row: int
    columns: list[ColumnSpec]


_REGISTRY: dict[str, Template] = {
    "template_1": Template(
        key="template_1",
        display_name="Шаблон №1",
        sheet_index=0,
        header_row=0,
        columns=[
            ColumnSpec("deal_id", "int", True),
            ColumnSpec("date_create", "date", True),
            ColumnSpec("closedate", "date", True),
            ColumnSpec("причина_провала_(СВ)", "str", False),
            ColumnSpec("причина_провала", "str", False),
            ColumnSpec("Удовлетворенность_клиента_(текст)", "str", False),
            ColumnSpec("Удовлетворенность клиента", "str", False),
            ColumnSpec("оценка_клиента_от_1_до-5", "str", False),
        ],
    ),
    "downtime": Template(
        key="downtime",
        display_name="Простои",
        sheet_index=0,
        header_row=0,
        columns=[],
    )
}


def all_templates() -> list[Template]:
    return list(_REGISTRY.values())


def get_template(key: str) -> Template | None:
    return _REGISTRY.get(key)
