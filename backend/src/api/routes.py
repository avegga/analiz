from pathlib import Path
import shutil
import tempfile

from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import FileResponse

from src.core.state import state
from src.models.schemas import (
    SettingsPayload,
    FilterPayload,
    ExportPayload,
    LoadResponse,
    AnalysisResponse,
)
from src.models.template_registry import all_templates, get_template
from src.services.settings_service import load_settings, save_settings
from src.services.loader_service import load_xlsx
from src.services.analysis_service import run_analysis
from src.services.export_service import export_rows, export_rows_to_xlsx_in_directory


router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/settings")
def get_settings():
    return load_settings()


@router.post("/settings")
def post_settings(payload: SettingsPayload):
    return save_settings(payload.model_dump())


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

    status = "Нет данных" if total_rows == 0 else ("Готово" if not errors else f"Готово с ошибками ({len(errors)})")

    return LoadResponse(
        total_rows=total_rows,
        valid_count=len(rows),
        error_count=len(errors),
        status=status,
        rows=rows,
        errors=errors,
    )


@router.post("/analysis/prepare", response_model=AnalysisResponse)
def prepare_analysis(payload: FilterPayload):
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
        out_file = export_rows_to_xlsx_in_directory(payload.rows, target_dir)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "status": "ok",
        "saved_path": str(out_file),
        "filename": out_file.name,
    }
