from pydantic import BaseModel, Field


class SettingsPayload(BaseModel):
    db_path_1: str = ""
    db_path_2: str = ""


class FilterPayload(BaseModel):
    mode: str = Field(default="prepare", pattern="^(prepare|satisfaction)$")


class ExportPayload(BaseModel):
    rows: list[dict] = Field(default_factory=list)
    format: str = Field(default="xlsx", pattern="^(xlsx|csv)$")


class LoadResponse(BaseModel):
    total_rows: int
    valid_count: int
    error_count: int
    status: str
    rows: list[dict]
    errors: list[dict]


class AnalysisResponse(BaseModel):
    rows: list[dict]
    total: int
    valid: int
    errors: int
    status: str
