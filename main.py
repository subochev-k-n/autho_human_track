from datetime import datetime

import pytz
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.config import settings, set_test_mode as _set_test_mode, get_test_mode
from app.database import Base, SessionLocal, engine
from app.routers import auth, columns, entries, firstaid
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
app.include_router(firstaid.router, prefix="/api/firstaid", tags=["firstaid"])


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

    # Создать стартовые допинги для admin, если ещё нет
    db2 = SessionLocal()
    try:
        from app.models import FirstAidItem, FirstAidCategory, FirstAidActionType
        admin_user = db2.query(User).filter(User.username == "admin").first()
        if admin_user:
            existing = db2.query(FirstAidItem).filter(FirstAidItem.user_id == admin_user.id).count()
            if existing == 0:
                starter_dopings = [
                    {"title": "Замедленное дыхание: удлинённый выдох",
                     "category": FirstAidCategory.ANXIETY, "action_type": FirstAidActionType.INSTANT,
                     "time_cost": "1-2 минуты", "duration": "15-60 минут",
                     "feelings": "Выдох на 6-8 счетов при вдохе на 4 — тело получает сигнал, что опасность прошла. Через несколько циклов приходит спокойствие."},
                    {"title": "Удар холода: лёд к лицу или запястьям",
                     "category": FirstAidCategory.ANXIETY, "action_type": FirstAidActionType.INSTANT,
                     "time_cost": "1-2 минуты", "duration": "15-30 минут",
                     "feelings": "Холод резко переключает нервную систему. Паника отступает почти мгновенно, дыхание выравнивается."},
                    {"title": "Тряска конечностями",
                     "category": FirstAidCategory.FATIGUE, "action_type": FirstAidActionType.INSTANT,
                     "time_cost": "30-60 секунд", "duration": "10-30 минут",
                     "feelings": "Физическое встряхивание рук и ног сбрасывает нереализованное мышечное возбуждение. После ощущение лёгкости в теле."},
                    {"title": "Обратный счёт: 5-4-3-2-1",
                     "category": FirstAidCategory.ANXIETY, "action_type": FirstAidActionType.INSTANT,
                     "time_cost": "1-2 минуты", "duration": "15-30 минут",
                     "feelings": "5 предметов вокруг, 4 звука, 3 тактильных ощущения, 2 запаха, 1 цвет. Возвращает из внутреннего мира в реальность, фокус переключается."},
                    {"title": "Мышечный сброс: напряжение-расслабление",
                     "category": FirstAidCategory.NEGATIVITY, "action_type": FirstAidActionType.INSTANT,
                     "time_cost": "1 минута", "duration": "15-30 минут",
                     "feelings": "Сильно напрячь всё тело на 5 секунд, затем резко расслабить. При упадке — поднимает тонус, при стрессе — успокаивает."},
                    {"title": "Яркий вкус: имбирь, мята, гвоздика",
                     "category": FirstAidCategory.APATHY, "action_type": FirstAidActionType.INSTANT,
                     "time_cost": "1-2 минуты", "duration": "15-30 минут",
                     "feelings": "Резкий вкус отвлекает от зацикленных мыслей. Пробуждение вкусовых рецепторов встряхивает и возвращает в тело."},
                ]
                for i, sd in enumerate(starter_dopings):
                    item = FirstAidItem(
                        user_id=admin_user.id,
                        title=sd["title"],
                        category=sd["category"],
                        action_type=sd["action_type"],
                        time_cost=sd["time_cost"],
                        duration=sd["duration"],
                        feelings=sd["feelings"],
                        sort_order=i,
                    )
                    db2.add(item)
                db2.commit()
    finally:
        db2.close()


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


@app.get("/firstaid")
def firstaid_page(request: Request):
    return templates.TemplateResponse("firstaid.html", {"request": request})


@app.get("/firstaid/edit")
def firstaid_edit_page(request: Request, id: int | None = None):
    return templates.TemplateResponse("firstaid_edit.html", {"request": request, "edit_id": id})


@app.get("/firstaid/history")
def firstaid_history_page(request: Request):
    return templates.TemplateResponse("firstaid_history.html", {"request": request})


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
