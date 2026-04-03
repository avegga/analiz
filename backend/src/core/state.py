from datetime import datetime
from typing import Any


class AppState:
    def __init__(self) -> None:
        self.loaded_rows: list[dict[str, Any]] = []
        self.errors: list[dict[str, Any]] = []
        self.total_rows: int = 0
        self.current_template_key: str = ""
        self.settings_tokens: dict[str, datetime] = {}


state = AppState()
