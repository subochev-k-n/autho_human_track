from datetime import datetime

import pytz
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.config import settings, set_test_mode as _set_test_mode, get_test_mode
from app.database import Base, SessionLocal, engine
from app.routers import auth, columns, entries
from app.services.auth_service import get_password_hash

app = FastAPI(title="Трекер автогуманиста")
templates = Jinja2Templates(directory="app/templates")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# API routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(entries.router, prefix="/api/entries", tags=["entries"])
app.include_router(columns.router, prefix="/api/columns", tags=["columns"])


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        from app.models import User
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            admin = User(
                username="admin",
                email="admin@tracker.local",
                hashed_password=get_password_hash("admin123"),
                is_admin=True,
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()


# --- HTML страницы ---

@app.get("/")
@app.get("/login")
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/register")
def register_page(request: Request):
    return templates.TemplateResponse("register.html", {"request": request})


@app.get("/dashboard")
def dashboard_page(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.get("/entries")
def entries_page(request: Request):
    return templates.TemplateResponse("entries.html", {"request": request})


@app.get("/settings")
def settings_page(request: Request):
    return templates.TemplateResponse("settings.html", {"request": request})


# --- API-only endpoints ---

@app.get("/health")
def health():
    tz = pytz.timezone(settings.TIMEZONE)
    now = datetime.now(tz)
    return {
        "status": "ok",
        "server_time": now.isoformat(),
        "can_fill": now.hour >= settings.BLOCK_HOUR,
        "test_mode": get_test_mode(),
    }


# --- Тестовый режим (для разработки и локального тестирования) ---

class TestModeSet(BaseModel):
    enabled: bool
    test_date: str = ""
    test_hour: int = 20


@app.post("/api/test-mode")
def set_test_mode_api(data: TestModeSet):
    """Включить/выключить тестовый режим — снимает блокировку по времени.
    Позволяет задать фиксированную дату для тестирования."""
    from app.config import get_test_date, get_test_hour
    _set_test_mode(data.enabled, data.test_date, data.test_hour)
    return {
        "test_mode": get_test_mode(),
        "test_date": get_test_date() or "реальная",
        "test_hour": get_test_hour(),
        "message": "Тестовый режим включён — блокировка по времени отключена"
        if get_test_mode() else "Тестовый режим выключен",
    }
