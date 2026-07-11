from datetime import date, datetime

import pytz
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import settings, get_test_mode, get_test_date, get_test_hour
from app.database import get_db
from app.dependencies import get_current_user
from app.models import CustomColumn, Entry, EntryColumnValue
from app.schemas import (
    CalendarDay,
    EntryCreate,
    EntryListOut,
    EntryOut,
    StatsOut,
    TodayStatusOut,
)

router = APIRouter()

# Дни недели по-русски
WEEKDAYS_RU = [
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
]


def _now_tz() -> datetime:
    """Текущее время в настроенном часовом поясе.
    В TEST_MODE возвращает фиксированное время."""
    if get_test_mode():
        tz = pytz.timezone(settings.TIMEZONE)
        td = get_test_date()
        th = get_test_hour()
        if td:
            d = datetime.strptime(td, "%Y-%m-%d")
            return tz.localize(d.replace(hour=th))
        return tz.localize(datetime.now().replace(hour=th))
    tz = pytz.timezone(settings.TIMEZONE)
    return datetime.now(tz)


def _today() -> date:
    """Сегодняшняя дата. В TEST_MODE возвращает дату из test_date."""
    if get_test_mode() and get_test_date():
        return datetime.strptime(get_test_date(), "%Y-%m-%d").date()
    return _now_tz().date()


def _can_fill() -> bool:
    """Можно ли сейчас заполнять (после BLOCK_HOUR).
    В TEST_MODE всегда True."""
    if get_test_mode():
        return True
    return _now_tz().hour >= settings.BLOCK_HOUR


def _enrich_entry_out(entry: Entry, db: Session) -> dict:
    """Добавляет custom_values к выходным данным Entry."""
    data = {
        "id": entry.id,
        "user_id": entry.user_id,
        "date": entry.date,
        "day_of_week": entry.day_of_week,
        "energy": entry.energy,
        "comfort": entry.comfort,
        "productivity": entry.productivity,
        "interaction": entry.interaction,
        "sovereignty": entry.sovereignty,
        "self_score": entry.self_score,
        "day_score": entry.day_score,
        "event": entry.event,
        "custom_values": [],
    }
    for cv in entry.column_values:
        col = cv.column
        data["custom_values"].append({
            "column_id": col.id,
            "column_name": col.name,
            "value": cv.value,
            "column_type": col.column_type.value if hasattr(col.column_type, 'value') else col.column_type,
        })
    return data


@router.post("/", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(
    data: EntryCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Создать запись за сегодня (только после 18:00, только одна запись в день)."""
    # 1. Проверить, что дата — сегодня
    if data.date != _today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Можно создать запись только за сегодняшний день",
        )

    # 2. Проверить, что время >= BLOCK_HOUR (18:00)
    if not _can_fill():
        tz = pytz.timezone(settings.TIMEZONE)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Оценки можно вносить после {settings.BLOCK_HOUR}:00 по часовому поясу {settings.TIMEZONE}",
        )

    # 3. Проверить, что запись за сегодня ещё не существует
    existing = (
        db.query(Entry)
        .filter(Entry.user_id == current_user.id, Entry.date == data.date)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Запись за сегодняшний день уже существует. Изменение оценок задним числом невозможно.",
        )

    # 4. Создать запись
    entry = Entry(
        user_id=current_user.id,
        date=data.date,
        day_of_week=WEEKDAYS_RU[data.date.weekday()],
        energy=data.energy,
        comfort=data.comfort,
        productivity=data.productivity,
        interaction=data.interaction,
        sovereignty=data.sovereignty,
        self_score=data.self_score,
        day_score=data.day_score,
        event=data.event,
    )
    db.add(entry)
    db.flush()  # чтобы получить entry.id

    # 5. Сохранить кастомные значения, если переданы
    if data.custom_values:
        for cv in data.custom_values:
            # Проверить, что колонка принадлежит пользователю
            col = (
                db.query(CustomColumn)
                .filter(
                    CustomColumn.id == cv.column_id,
                    CustomColumn.user_id == current_user.id,
                )
                .first()
            )
            if not col:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Кастомная колонка с id {cv.column_id} не найдена",
                )

            # Проверить тип колонки
            if col.column_type.value == "rating":
                try:
                    val = int(cv.value)
                    if val < -10 or val > 10:
                        raise ValueError
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Значение для колонки '{col.name}' должно быть числом от -10 до 10",
                    )

            db.add(
                EntryColumnValue(
                    column_id=cv.column_id,
                    entry_id=entry.id,
                    value=cv.value,
                )
            )

    db.commit()
    db.refresh(entry)
    return _enrich_entry_out(entry, db)


@router.get("/", response_model=EntryListOut)
def list_entries(
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Список записей пользователя (только чтение, с пагинацией и фильтром по датам)."""
    query = db.query(Entry).filter(Entry.user_id == current_user.id)

    if date_from:
        query = query.filter(Entry.date >= date_from)
    if date_to:
        query = query.filter(Entry.date <= date_to)

    total = query.count()
    entries = (
        query.order_by(Entry.date.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return EntryListOut(
        entries=[_enrich_entry_out(e, db) for e in entries],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/today", response_model=TodayStatusOut)
def get_today_status(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Статус сегодняшней записи: заполнена ли, можно ли заполнить, нужно ли напоминание."""
    today = _today()
    filled = (
        db.query(Entry)
        .filter(Entry.user_id == current_user.id, Entry.date == today)
        .first()
    ) is not None

    can_fill = _can_fill()
    reminder = can_fill and not filled

    return TodayStatusOut(filled=filled, can_fill=can_fill, reminder=reminder)


@router.get("/stats", response_model=StatsOut)
def get_stats(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Агрегированная статистика по записям пользователя."""
    query = db.query(Entry).filter(Entry.user_id == current_user.id)

    if date_from:
        query = query.filter(Entry.date >= date_from)
    if date_to:
        query = query.filter(Entry.date <= date_to)

    entries = query.order_by(Entry.date.asc()).all()

    if not entries:
        return StatsOut(
            averages={},
            mins={},
            maxs={},
            best_day=None,
            worst_day=None,
            streak=0,
            trend={},
        )

    fields = ["energy", "comfort", "productivity", "interaction",
              "sovereignty", "self_score", "day_score"]

    averages = {}
    mins = {}
    maxs = {}
    trends = {}

    for f in fields:
        values = [getattr(e, f) for e in entries if getattr(e, f) is not None]
        if values:
            averages[f] = round(sum(values) / len(values), 1)
            mins[f] = min(values)
            maxs[f] = max(values)
            # Простой линейный тренд: первые 50% vs последние 50%
            half = max(len(values) // 2, 1)
            first_half = sum(values[:half]) / half
            second_half = sum(values[-half:]) / half
            trends[f] = round(second_half - first_half, 1)
        else:
            averages[f] = None
            mins[f] = None
            maxs[f] = None
            trends[f] = None

    # Подсчёт streak (непрерывных дней подряд)
    streak = 0
    if entries:
        all_dates = sorted(set(e.date for e in entries), reverse=True)
        from datetime import timedelta
        check_date = today = _today()
        for d in all_dates:
            if d == check_date:
                streak += 1
                check_date -= timedelta(days=1)
            else:
                break

    # Лучший и худший день (по среднему score)
    scored_entries = []
    for e in entries:
        scores = [getattr(e, f) for f in fields if getattr(e, f) is not None]
        if scores:
            avg = sum(scores) / len(scores)
            scored_entries.append((avg, e))

    best_day = None
    worst_day = None
    if scored_entries:
        best = max(scored_entries, key=lambda x: x[0])
        worst = min(scored_entries, key=lambda x: x[0])
        best_day = {
            "date": best[1].date.isoformat(),
            "avg_score": round(best[0], 1),
        }
        worst_day = {
            "date": worst[1].date.isoformat(),
            "avg_score": round(worst[0], 1),
        }

    return StatsOut(
        averages=averages,
        mins=mins,
        maxs=maxs,
        best_day=best_day,
        worst_day=worst_day,
        streak=streak,
        trend=trends,
    )


@router.get("/calendar", response_model=list[CalendarDay])
def get_calendar(
    year: int | None = None,
    month: int | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Данные для тепловой карты календаря за указанный месяц."""
    today = _today()
    y = year or today.year
    m = month or today.month

    import calendar as cal_mod
    days_in_month = cal_mod.monthrange(y, m)[1]

    entries = (
        db.query(Entry)
        .filter(
            Entry.user_id == current_user.id,
            Entry.date >= date(y, m, 1),
            Entry.date <= date(y, m, days_in_month),
        )
        .all()
    )

    entry_map = {e.date: e for e in entries}
    fields = ["energy", "comfort", "productivity", "interaction",
              "sovereignty", "self_score", "day_score"]

    result = []
    for day_num in range(1, days_in_month + 1):
        d = date(y, m, day_num)
        e = entry_map.get(d)
        if e:
            scores = [getattr(e, f) for f in fields if getattr(e, f) is not None]
            avg_score = round(sum(scores) / len(scores), 1) if scores else None
            result.append(CalendarDay(date=d, avg_score=avg_score, filled=True))
        else:
            result.append(CalendarDay(date=d, avg_score=None, filled=False))

    return result


@router.get("/{entry_id}", response_model=EntryOut)
def get_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Получить конкретную запись."""
    entry = (
        db.query(Entry)
        .filter(Entry.id == entry_id, Entry.user_id == current_user.id)
        .first()
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись не найдена",
        )
    return _enrich_entry_out(entry, db)
