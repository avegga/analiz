from pydantic import BaseModel, Field


class SettingsPayload(BaseModel):
    db_path_1: str = ""
    db_path_2: str = ""


class SettingsAuthPayload(BaseModel):
    password: str = ""


class SettingsAuthResponse(BaseModel):
    token: str
    expires_in_seconds: int


class SettingsSummaryResponse(BaseModel):
    has_db_path_1: bool = False
    has_db_path_2: bool = False


class ColumnConfigPayload(BaseModel):
    template_key: str
    columns: list[str] = Field(default_factory=list)
    widths: dict[str, int] = Field(default_factory=dict)
    general: dict[str, int | bool] = Field(default_factory=dict)


class ColumnConfigResponse(BaseModel):
    template_key: str
    columns: list[str] = Field(default_factory=list)
    widths: dict[str, int] = Field(default_factory=dict)
    general: dict[str, int | bool] = Field(default_factory=dict)


class ColumnTypeConfigPayload(BaseModel):
    template_key: str
    overrides: dict[str, str] = Field(default_factory=dict)


class ColumnTypeConfigResponse(BaseModel):
    template_key: str
    overrides: dict[str, str] = Field(default_factory=dict)


class FilterConfigPayload(BaseModel):
    template_key: str
    filters: dict[str, dict[str, str]] = Field(default_factory=dict)


class FilterConfigResponse(BaseModel):
    template_key: str
    filters: dict[str, dict[str, str]] = Field(default_factory=dict)


class FilterPayload(BaseModel):
    mode: str = Field(default="prepare", pattern="^(prepare|satisfaction)$")


class ExportPayload(BaseModel):
    rows: list[dict] = Field(default_factory=list)
    format: str = Field(default="xlsx", pattern="^(xlsx|csv)$")
    filename: str = ""


class LoadResponse(BaseModel):
    total_rows: int
    valid_count: int
    error_count: int
    status: str
    rows: list[dict]
    errors: list[dict]
    headers: list[str] = Field(default_factory=list)
    source_file: str = ""


class AnalysisResponse(BaseModel):
    rows: list[dict]
    total: int
    valid: int
    errors: int
    status: str
