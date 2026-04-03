from datetime import datetime, timedelta, timezone
from pathlib import Path
import secrets
import shutil
import tempfile
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, UploadFile, HTTPException
from fastapi.responses import FileResponse

from src.core.config import SETTINGS_ACCESS_PASSWORD, SETTINGS_ACCESS_TOKEN_TTL_SECONDS
from src.core.state import state
from src.models.schemas import (
    SettingsAuthPayload,
    SettingsAuthResponse,
    SettingsPayload,
    SettingsSummaryResponse,
    ColumnConfigPayload,
    ColumnConfigResponse,
    ColumnTypeConfigPayload,
    ColumnTypeConfigResponse,
    FilterConfigPayload,
    FilterConfigResponse,
    FilterPayload,
    ExportPayload,
    LoadResponse,
    AnalysisResponse,
)
from src.models.template_registry import all_templates, get_template
from src.services.settings_service import (
    load_settings,
    save_settings,
    load_column_config,
    save_column_config,
    load_column_type_config,
    save_column_type_config,
    load_filter_config,
    save_filter_config,
)
from src.services.loader_service import load_xlsx, load_xlsx_as_is
from src.services.analysis_service import run_analysis
from src.services.export_service import export_rows, export_rows_to_xlsx_in_directory


router = APIRouter(prefix="/api")


def _cleanup_expired_settings_tokens() -> None:
    now = datetime.now(timezone.utc)
    expired_tokens = [token for token, expires_at in state.settings_tokens.items() if expires_at <= now]
    for token in expired_tokens:
        state.settings_tokens.pop(token, None)


def _require_settings_access(settings_token: Annotated[str | None, Header(alias="X-Settings-Token")] = None) -> str:
    _cleanup_expired_settings_tokens()
    token = (settings_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Требуется пароль для доступа к настройкам")

    expires_at = state.settings_tokens.get(token)
    if expires_at is None or expires_at <= datetime.now(timezone.utc):
        state.settings_tokens.pop(token, None)
        raise HTTPException(status_code=401, detail="Доступ к настройкам истек. Введите пароль повторно")

    return token


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/settings/summary", response_model=SettingsSummaryResponse)
def get_settings_summary():
    settings = load_settings()
    return SettingsSummaryResponse(
        has_db_path_1=bool((settings.get("db_path_1") or "").strip()),
        has_db_path_2=bool((settings.get("db_path_2") or "").strip()),
    )


@router.post("/settings/auth", response_model=SettingsAuthResponse)
def authenticate_settings_access(payload: SettingsAuthPayload):
    if payload.password != SETTINGS_ACCESS_PASSWORD:
        raise HTTPException(status_code=401, detail="Неверный пароль")

    _cleanup_expired_settings_tokens()
    token = secrets.token_urlsafe(32)
    state.settings_tokens[token] = datetime.now(timezone.utc) + timedelta(seconds=SETTINGS_ACCESS_TOKEN_TTL_SECONDS)
    return SettingsAuthResponse(token=token, expires_in_seconds=SETTINGS_ACCESS_TOKEN_TTL_SECONDS)


@router.get("/settings")
def get_settings(_: str = Depends(_require_settings_access)):
    return load_settings()


@router.post("/settings")
def post_settings(payload: SettingsPayload, _: str = Depends(_require_settings_access)):
    return save_settings(payload.model_dump())


@router.get("/column-configs/{template_key}", response_model=ColumnConfigResponse)
def get_column_config(template_key: str):
    config = load_column_config(template_key)
    return ColumnConfigResponse(
        template_key=template_key,
        columns=config.get("columns", []),
        widths=config.get("widths", {}),
        general=config.get("general", {}),
    )


@router.post("/column-configs", response_model=ColumnConfigResponse)
def post_column_config(payload: ColumnConfigPayload):
    config = save_column_config(payload.template_key, payload.columns, payload.widths, payload.general)
    return ColumnConfigResponse(
        template_key=payload.template_key,
        columns=config.get("columns", []),
        widths=config.get("widths", {}),
        general=config.get("general", {}),
    )


@router.get("/column-type-configs/{template_key}", response_model=ColumnTypeConfigResponse)
def get_column_type_config(template_key: str):
    return ColumnTypeConfigResponse(template_key=template_key, overrides=load_column_type_config(template_key))


@router.post("/column-type-configs", response_model=ColumnTypeConfigResponse)
def post_column_type_config(payload: ColumnTypeConfigPayload):
    overrides = save_column_type_config(payload.template_key, payload.overrides)
    return ColumnTypeConfigResponse(template_key=payload.template_key, overrides=overrides)


@router.get("/filter-configs/{template_key}", response_model=FilterConfigResponse)
def get_filter_config(template_key: str):
    return FilterConfigResponse(template_key=template_key, filters=load_filter_config(template_key))


@router.post("/filter-configs", response_model=FilterConfigResponse)
def post_filter_config(payload: FilterConfigPayload):
    filters = save_filter_config(payload.template_key, payload.filters)
    return FilterConfigResponse(template_key=payload.template_key, filters=filters)


@router.get("/templates")
def get_templates():
    return [
        {
            "key": t.key,
            "display_name": t.display_name,
            "columns": [
                {"name": c.name, "expected_type": c.expected_type, "required": c.required}
                for c in t.columns
            ],
        }
        for t in all_templates()
    ]


@router.post("/facts/upload", response_model=LoadResponse)
def upload_facts(template_key: str, file: UploadFile = File(...)):
    template = get_template(template_key)
    if template is None:
        raise HTTPException(status_code=400, detail="Шаблон не найден")
    if template.key == "downtime":
        raise HTTPException(status_code=400, detail="Для шаблона «Простои» используется автоматическая загрузка")

    suffix = Path(file.filename or "uploaded.xlsx").suffix or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        rows, errors, total_rows = load_xlsx(tmp_path, template)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Ошибка чтения xlsx: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    state.loaded_rows = rows
    state.errors = errors
    state.total_rows = total_rows
    state.current_template_key = template.key

    status = "Нет данных" if total_rows == 0 else ("Готово" if not errors else f"Готово с ошибками ({len(errors)})")
    headers = list(rows[0].keys()) if rows else [column.name for column in template.columns]

    return LoadResponse(
        total_rows=total_rows,
        valid_count=len(rows),
        error_count=len(errors),
        status=status,
        rows=rows,
        errors=errors,
        headers=headers,
        source_file=file.filename or "",
    )


def _find_newest_downtime_file(directory: str | Path) -> Path:
    path = Path(directory)
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=400, detail="Маршрут БД 1 не найден или не является папкой")

    extension_priority = {
        ".xlsx": 2,
        ".xlsm": 1,
        ".xls": 0,
    }

    candidates = [
        candidate
        for candidate in path.iterdir()
        if candidate.is_file()
        and candidate.name.lower().startswith("prostoy")
        and candidate.suffix.lower() in {".xls", ".xlsx", ".xlsm"}
    ]
    if not candidates:
        raise HTTPException(status_code=404, detail="В Маршрут БД 1 не найден файл prostoy*")

    return max(
        candidates,
        key=lambda candidate: (
            extension_priority.get(candidate.suffix.lower(), -1),
            candidate.stat().st_mtime,
        ),
    )


@router.post("/facts/load-downtime", response_model=LoadResponse)
def load_downtime_facts():
    settings = load_settings()
    source_file = _find_newest_downtime_file((settings.get("db_path_1") or "").strip())

    try:
        rows, headers, total_rows = load_xlsx_as_is(source_file)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Ошибка чтения файла простоя: {exc}") from exc

    state.loaded_rows = rows
    state.errors = []
    state.total_rows = total_rows
    state.current_template_key = "downtime"

    status = "Нет данных" if total_rows == 0 else "Готово"

    return LoadResponse(
        total_rows=total_rows,
        valid_count=len(rows),
        error_count=0,
        status=status,
        rows=rows,
        errors=[],
        headers=headers,
        source_file=str(source_file),
    )


@router.post("/analysis/upload-source", response_model=LoadResponse)
def upload_analysis_source(file: UploadFile = File(...)):
    suffix = Path(file.filename or "analysis-source.xlsx").suffix or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        rows, headers, total_rows = load_xlsx_as_is(tmp_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Ошибка чтения файла анализа: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    status = "Нет данных" if total_rows == 0 else "Готово"

    return LoadResponse(
        total_rows=total_rows,
        valid_count=len(rows),
        error_count=0,
        status=status,
        rows=rows,
        errors=[],
        headers=headers,
        source_file=file.filename or "",
    )


@router.post("/analysis/prepare", response_model=AnalysisResponse)
def prepare_analysis(payload: FilterPayload):
    if state.current_template_key == "downtime":
        raise HTTPException(status_code=400, detail="Для шаблона «Простои» вкладка «Анализ» недоступна")

    filtered = run_analysis(state.loaded_rows, mode=payload.mode)
    status = "Нет данных" if state.total_rows == 0 else ("Готово" if not state.errors else f"Готово с ошибками ({len(state.errors)})")
    return AnalysisResponse(
        rows=filtered,
        total=state.total_rows,
        valid=len(state.loaded_rows),
        errors=len(state.errors),
        status=status,
    )


@router.post("/export")
def export_data(payload: ExportPayload):
    try:
        out_file = export_rows(payload.rows, payload.format)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if payload.format == "csv":
        media = "text/csv"

    return FileResponse(path=out_file, filename=out_file.name, media_type=media)


@router.post("/export/xlsx-to-settings")
def export_xlsx_to_settings(payload: ExportPayload):
    if payload.format != "xlsx":
        raise HTTPException(status_code=400, detail="Для этого endpoint поддерживается только xlsx")

    settings = load_settings()
    target_dir = (settings.get("db_path_2") or "").strip()
    if not target_dir:
        raise HTTPException(status_code=400, detail="Маршрут БД 2 не задан в настройках")

    try:
        out_file = export_rows_to_xlsx_in_directory(payload.rows, target_dir, payload.filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "status": "ok",
        "saved_path": str(out_file),
        "filename": out_file.name,
    }
