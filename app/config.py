import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "sqlite:///./tracker.db",
    )
    SECRET_KEY: str = "change-this-secret-key-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    TIMEZONE: str = "Europe/Moscow"
    BLOCK_HOUR: int = 18  # блокировка до 18:00

    class Config:
        env_file = ".env"


settings = Settings()

# Если хостинг передал PostgreSQL (Railway, Render) — чиним протокол
if settings.DATABASE_URL and settings.DATABASE_URL.startswith("postgres://"):
    # SQLAlchemy требует postgresql://, а не postgres://
    settings.DATABASE_URL = settings.DATABASE_URL.replace(
        "postgres://", "postgresql://", 1
    )

# --- Тестовый режим (переопределяется через API, не влияет на .env) ---

_test_mode = False
_test_date = ""
_test_hour = 20


def set_test_mode(enabled: bool, test_date: str = "", test_hour: int = 20):
    """Включить/выключить тестовый режим — отключает блокировку по времени."""
    global _test_mode, _test_date, _test_hour
    _test_mode = enabled
    if test_date:
        _test_date = test_date
    if test_hour != 20:
        _test_hour = test_hour


def get_test_mode() -> bool:
    return _test_mode


def get_test_date() -> str:
    return _test_date


def get_test_hour() -> int:
    return _test_hour
