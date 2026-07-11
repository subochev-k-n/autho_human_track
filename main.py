from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import RedirectResponse
from pathlib import Path

app = FastAPI(title="Трекер автогуманиста (локальный)")

# Монтируем статику
static_dir = Path(__file__).parent / "app" / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

templates = Jinja2Templates(directory="app/templates")


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


@app.get("/health")
def health():
    return {"status": "ok", "mode": "local-storage"}
