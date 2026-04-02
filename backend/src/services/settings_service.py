import json
from pathlib import Path

from src.core.config import SETTINGS_FILE


DEFAULT_SETTINGS = {
    "db_path_1": "",
    "db_path_2": "",
    "column_configs": {},
    "filter_configs": {},
    "column_type_overrides": {
        "global": {},
        "templates": {},
    },
}

DEFAULT_COLUMN_GENERAL = {
    "default_width": 180,
    "min_width": 60,
    "row_limit": 0,
    "hide_money_cents": False,
}


def _normalize_column_general(value: object) -> dict[str, int | bool]:
    general = dict(DEFAULT_COLUMN_GENERAL)
    if not isinstance(value, dict):
        return general

    try:
        default_width = int(value.get("default_width", general["default_width"]))
    except (TypeError, ValueError):
        default_width = int(general["default_width"])

    try:
        min_width = int(value.get("min_width", general["min_width"]))
    except (TypeError, ValueError):
        min_width = int(general["min_width"])

    try:
        row_limit = int(value.get("row_limit", general["row_limit"]))
    except (TypeError, ValueError):
        row_limit = int(general["row_limit"])

    min_width = max(60, min_width)
    default_width = max(min_width, default_width)
    row_limit = max(0, row_limit)

    general["default_width"] = default_width
    general["min_width"] = min_width
    general["row_limit"] = row_limit
    general["hide_money_cents"] = bool(value.get("hide_money_cents", general["hide_money_cents"]))
    return general


def _normalize_column_configs(value: object) -> dict[str, dict]:
    normalized: dict[str, dict] = {}
    if not isinstance(value, dict):
        return normalized

    for template_key, config_value in value.items():
        columns: list[str] = []
        widths: dict[str, int] = {}

        if isinstance(config_value, list):
            columns = [str(column) for column in config_value]
        elif isinstance(config_value, dict):
            raw_columns = config_value.get("columns")
            if isinstance(raw_columns, list):
                columns = [str(column) for column in raw_columns]

            raw_widths = config_value.get("widths")
            if isinstance(raw_widths, dict):
                for column_name, width in raw_widths.items():
                    try:
                        normalized_width = int(width)
                    except (TypeError, ValueError):
                        continue
                    if normalized_width > 0:
                        widths[str(column_name)] = normalized_width

        normalized[str(template_key)] = {
            "columns": columns,
            "widths": {column: widths[column] for column in columns if column in widths},
            "general": _normalize_column_general(config_value.get("general") if isinstance(config_value, dict) else None),
        }

    return normalized


def _normalize_column_type_overrides(value: object) -> dict:
    normalized = {
        "global": {},
        "templates": {},
    }
    if not isinstance(value, dict):
        return normalized

    raw_global = value.get("global")
    if isinstance(raw_global, dict):
        normalized["global"] = {str(key): str(item) for key, item in raw_global.items()}

    raw_templates = value.get("templates")
    if isinstance(raw_templates, dict):
        templates: dict[str, dict[str, str]] = {}
        for template_key, template_value in raw_templates.items():
            if isinstance(template_value, dict):
                templates[str(template_key)] = {
                    str(column_name): str(column_type)
                    for column_name, column_type in template_value.items()
                }
        normalized["templates"] = templates

    return normalized


def _normalize_filter_configs(value: object) -> dict[str, dict[str, dict[str, str]]]:
    normalized: dict[str, dict[str, dict[str, str]]] = {}
    if not isinstance(value, dict):
        return normalized

    for template_key, filters_value in value.items():
        if not isinstance(filters_value, dict):
            continue
        template_filters: dict[str, dict[str, str]] = {}
        for column_name, filter_value in filters_value.items():
            if not isinstance(filter_value, dict):
                continue
            template_filters[str(column_name)] = {
                "text": str(filter_value.get("text", "")),
                "operator": str(filter_value.get("operator", "eq")),
                "value": str(filter_value.get("value", "")),
                "from": str(filter_value.get("from", "")),
                "to": str(filter_value.get("to", "")),
            }
        normalized[str(template_key)] = template_filters

    return normalized


def load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                data = json.load(f)
            settings = {**DEFAULT_SETTINGS, **data}
            settings["column_configs"] = _normalize_column_configs(settings.get("column_configs"))
            settings["filter_configs"] = _normalize_filter_configs(settings.get("filter_configs"))
            settings["column_type_overrides"] = _normalize_column_type_overrides(settings.get("column_type_overrides"))
            return settings
        except (json.JSONDecodeError, OSError):
            return dict(DEFAULT_SETTINGS)
    return dict(DEFAULT_SETTINGS)


def save_settings(payload: dict) -> dict:
    current = load_settings()
    data = {**current, **payload}
    data["column_configs"] = _normalize_column_configs(data.get("column_configs"))
    data["filter_configs"] = _normalize_filter_configs(data.get("filter_configs"))
    data["column_type_overrides"] = _normalize_column_type_overrides(data.get("column_type_overrides"))
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


def load_column_config(template_key: str) -> dict[str, object]:
    settings = load_settings()
    configs = settings.get("column_configs") or {}
    config = configs.get(template_key) or {}
    if not isinstance(config, dict):
        return {"columns": [], "widths": {}, "general": dict(DEFAULT_COLUMN_GENERAL)}

    columns = config.get("columns") or []
    widths = config.get("widths") or {}
    general = _normalize_column_general(config.get("general"))
    if not isinstance(columns, list):
        columns = []
    if not isinstance(widths, dict):
        widths = {}

    normalized_columns = [str(column) for column in columns]
    normalized_widths = {}
    for column_name, width in widths.items():
        try:
            normalized_width = int(width)
        except (TypeError, ValueError):
            continue
        if normalized_width > 0 and str(column_name) in normalized_columns:
            normalized_widths[str(column_name)] = normalized_width

    return {"columns": normalized_columns, "widths": normalized_widths, "general": general}


def save_column_config(template_key: str, columns: list[str], widths: dict[str, int], general: dict[str, object]) -> dict[str, object]:
    settings = load_settings()
    configs = settings.get("column_configs") or {}
    normalized_columns = [str(column) for column in columns]
    allowed_columns = set(normalized_columns)
    normalized_general = _normalize_column_general(general)
    normalized_widths: dict[str, int] = {}
    for column_name, width in widths.items():
        try:
            normalized_width = int(width)
        except (TypeError, ValueError):
            continue
        column_key = str(column_name)
        if normalized_width > 0 and column_key in allowed_columns:
            normalized_widths[column_key] = max(int(normalized_general["min_width"]), normalized_width)

    configs[template_key] = {
        "columns": normalized_columns,
        "widths": normalized_widths,
        "general": normalized_general,
    }
    save_settings({"column_configs": configs})
    return configs[template_key]


def load_column_type_config(template_key: str) -> dict[str, str]:
    settings = load_settings()
    templates = settings.get("column_type_overrides", {}).get("templates", {})
    overrides = templates.get(template_key) or {}
    if not isinstance(overrides, dict):
        return {}
    return {str(column_name): str(column_type) for column_name, column_type in overrides.items()}


def save_column_type_config(template_key: str, overrides: dict[str, str]) -> dict[str, str]:
    settings = load_settings()
    column_type_overrides = settings.get("column_type_overrides") or _normalize_column_type_overrides(None)
    templates = column_type_overrides.get("templates") or {}
    templates[template_key] = {
        str(column_name): str(column_type)
        for column_name, column_type in overrides.items()
        if str(column_type).strip()
    }
    column_type_overrides["templates"] = templates
    save_settings({"column_type_overrides": column_type_overrides})
    return templates[template_key]


def load_filter_config(template_key: str) -> dict[str, dict[str, str]]:
    settings = load_settings()
    filters = settings.get("filter_configs") or {}
    config = filters.get(template_key) or {}
    if not isinstance(config, dict):
        return {}
    return _normalize_filter_configs({template_key: config}).get(template_key, {})


def save_filter_config(template_key: str, filters: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    settings = load_settings()
    current_filters = settings.get("filter_configs") or {}
    normalized_filters = _normalize_filter_configs({template_key: filters}).get(template_key, {})
    current_filters[template_key] = normalized_filters
    save_settings({"filter_configs": current_filters})
    return normalized_filters
