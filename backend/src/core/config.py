from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]
STORAGE_DIR = BASE_DIR / "storage"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = STORAGE_DIR / "settings.json"
EXPORT_DIR = STORAGE_DIR / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_ACCESS_PASSWORD = "220641"
SETTINGS_ACCESS_TOKEN_TTL_SECONDS = 12 * 60 * 60
