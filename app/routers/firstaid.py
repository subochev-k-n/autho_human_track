import random
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    FirstAidCategory,
    FirstAidActionType,
    FirstAidItem,
    FirstAidUsage,
    User,
)
from app.schemas import (
    FirstAidItemCreate,
    FirstAidItemOut,
    FirstAidItemUpdate,
    FirstAidStatsOut,
    FirstAidUsageCreate,
    FirstAidUsageOut,
    FirstAidUsageUpdate,
)

router = APIRouter()

CATEGORY_LABELS = {
    "fatigue": "Снижает усталость",
    "apathy": "Снимает апатию/скуку",
    "anxiety": "Убирает тревогу",
    "negativity": "Снижает негатив",
}

ACTION_TYPE_LABELS = {
    "instant": "Моментальный",
    "tactical": "Тактический",
    "daily": "Дневной",
}

ACTION_TYPE_DEFAULTS = {
    "instant": {"time_cost": "1-2 минуты", "duration": "15-60 минут"},
    "tactical": {"time_cost": "3-10 минут", "duration": "2-4 часа"},
    "daily": {"time_cost": "15-60 минут", "duration": "вечер/ночь"},
}


def _enrich_item(item: FirstAidItem, db: Session) -> dict:
    usages = db.query(FirstAidUsage).filter(FirstAidUsage.item_id == item.id)
    count = usages.count()
    avg_eff = db.query(FirstAidUsage.effectiveness).filter(
        FirstAidUsage.item_id == item.id,
        FirstAidUsage.effectiveness.isnot(None),
    ).all()
    avg = round(sum(e[0] for e in avg_eff) / len(avg_eff), 1) if avg_eff else None

    return {
        "id": item.id,
        "title": item.title,
        "category": item.category.value if hasattr(item.category, "value") else item.category,
        "action_type": item.action_type.value if hasattr(item.action_type, "value") else item.action_type,
        "time_cost": item.time_cost or "",
        "duration": item.duration or "",
        "feelings": item.feelings,
        "is_active": item.is_active,
        "sort_order": item.sort_order,
        "usage_count": count,
        "avg_effectiveness": avg,
    }


# === ITEMS ===

@router.get("/items", response_model=list[FirstAidItemOut])
def list_items(
    category: str | None = None,
    action_type: str | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Список допингов с фильтрацией по категории и типу."""
    query = db.query(FirstAidItem).filter(FirstAidItem.user_id == current_user.id)

    if not include_inactive:
        query = query.filter(FirstAidItem.is_active == True)
    if category:
        query = query.filter(FirstAidItem.category == category)
    if action_type:
        query = query.filter(FirstAidItem.action_type == action_type)

    items = query.order_by(FirstAidItem.sort_order).all()
    return [_enrich_item(it, db) for it in items]


@router.post("/items", response_model=FirstAidItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    data: FirstAidItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Создать новый допинг."""
    # Автозаполнение времени/длительности по типу, если пусто
    time_cost = data.time_cost
    duration = data.duration
    if not time_cost and data.action_type in ACTION_TYPE_DEFAULTS:
        time_cost = ACTION_TYPE_DEFAULTS[data.action_type]["time_cost"]
    if not duration and data.action_type in ACTION_TYPE_DEFAULTS:
        duration = ACTION_TYPE_DEFAULTS[data.action_type]["duration"]

    max_order = db.query(FirstAidItem.sort_order).filter(
        FirstAidItem.user_id == current_user.id
    ).order_by(FirstAidItem.sort_order.desc()).first()
    next_order = (max_order[0] + 1) if max_order else 0

    item = FirstAidItem(
        user_id=current_user.id,
        title=data.title,
        category=FirstAidCategory(data.category),
        action_type=FirstAidActionType(data.action_type),
        time_cost=time_cost,
        duration=duration,
        feelings=data.feelings,
        sort_order=next_order,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _enrich_item(item, db)


@router.put("/items/{item_id}", response_model=FirstAidItemOut)
def update_item(
    item_id: int,
    data: FirstAidItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Обновить допинг."""
    item = db.query(FirstAidItem).filter(
        FirstAidItem.id == item_id,
        FirstAidItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Допинг не найден")

    if data.title is not None:
        item.title = data.title
    if data.category is not None:
        item.category = FirstAidCategory(data.category)
    if data.action_type is not None:
        item.action_type = FirstAidActionType(data.action_type)
    if data.time_cost is not None:
        item.time_cost = data.time_cost
    if data.duration is not None:
        item.duration = data.duration
    if data.feelings is not None:
        item.feelings = data.feelings
    if data.is_active is not None:
        item.is_active = data.is_active
    if data.sort_order is not None:
        item.sort_order = data.sort_order

    db.commit()
    db.refresh(item)
    return _enrich_item(item, db)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Удалить допинг (и все его использования)."""
    item = db.query(FirstAidItem).filter(
        FirstAidItem.id == item_id,
        FirstAidItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Допинг не найден")
    db.delete(item)
    db.commit()


@router.get("/items/random", response_model=FirstAidItemOut | None)
def random_item(
    category: str | None = None,
    action_type: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Случайный допинг с учётом фильтров."""
    query = db.query(FirstAidItem).filter(
        FirstAidItem.user_id == current_user.id,
        FirstAidItem.is_active == True,
    )
    if category:
        query = query.filter(FirstAidItem.category == category)
    if action_type:
        query = query.filter(FirstAidItem.action_type == action_type)

    items = query.all()
    if not items:
        return None
    item = random.choice(items)
    return _enrich_item(item, db)


# === USAGES ===

@router.get("/usages", response_model=list[FirstAidUsageOut])
def list_usages(
    item_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """История использований допингов."""
    query = db.query(FirstAidUsage).filter(FirstAidUsage.user_id == current_user.id)

    if item_id:
        query = query.filter(FirstAidUsage.item_id == item_id)
    if date_from:
        query = query.filter(FirstAidUsage.used_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.filter(FirstAidUsage.used_at <= datetime.combine(date_to, datetime.max.time()))

    usages = query.order_by(FirstAidUsage.used_at.desc()).all()

    result = []
    for u in usages:
        item = u.item
        result.append({
            "id": u.id,
            "item_id": u.item_id,
            "user_id": u.user_id,
            "used_at": u.used_at,
            "effectiveness": u.effectiveness,
            "note": u.note,
            "item_title": item.title if item else "",
            "item_category": item.category.value if item and hasattr(item.category, "value") else (item.category if item else ""),
        })
    return result


@router.post("/usages", response_model=FirstAidUsageOut, status_code=status.HTTP_201_CREATED)
def create_usage(
    data: FirstAidUsageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Зафиксировать использование допинга."""
    item = db.query(FirstAidItem).filter(
        FirstAidItem.id == data.item_id,
        FirstAidItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Допинг не найден")

    usage = FirstAidUsage(
        item_id=data.item_id,
        user_id=current_user.id,
        effectiveness=data.effectiveness,
        note=data.note,
    )
    db.add(usage)
    db.commit()
    db.refresh(usage)

    return {
        "id": usage.id,
        "item_id": usage.item_id,
        "user_id": usage.user_id,
        "used_at": usage.used_at,
        "effectiveness": usage.effectiveness,
        "note": usage.note,
        "item_title": item.title,
        "item_category": item.category.value if hasattr(item.category, "value") else item.category,
    }


@router.put("/usages/{usage_id}", response_model=FirstAidUsageOut)
def update_usage(
    usage_id: int,
    data: FirstAidUsageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Оценить эффективность использования (post-factum)."""
    usage = db.query(FirstAidUsage).filter(
        FirstAidUsage.id == usage_id,
        FirstAidUsage.user_id == current_user.id,
    ).first()
    if not usage:
        raise HTTPException(status_code=404, detail="Использование не найдено")

    if data.effectiveness is not None:
        usage.effectiveness = data.effectiveness
    if data.note is not None:
        usage.note = data.note

    db.commit()
    db.refresh(usage)

    item = usage.item
    return {
        "id": usage.id,
        "item_id": usage.item_id,
        "user_id": usage.user_id,
        "used_at": usage.used_at,
        "effectiveness": usage.effectiveness,
        "note": usage.note,
        "item_title": item.title if item else "",
        "item_category": item.category.value if item and hasattr(item.category, "value") else (item.category if item else ""),
    }


@router.get("/stats", response_model=FirstAidStatsOut)
def get_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Статистика по аптечке."""
    items = db.query(FirstAidItem).filter(
        FirstAidItem.user_id == current_user.id,
        FirstAidItem.is_active == True,
    ).all()

    usages = db.query(FirstAidUsage).filter(
        FirstAidUsage.user_id == current_user.id,
    ).order_by(FirstAidUsage.used_at.desc()).all()

    # Топ-5 по частоте использования
    from collections import Counter
    item_counts = Counter(u.item_id for u in usages)
    top_ids = [iid for iid, _ in item_counts.most_common(5)]

    top_items = []
    for iid in top_ids:
        item = db.query(FirstAidItem).filter(FirstAidItem.id == iid).first()
        if item:
            top_items.append({
                "id": item.id,
                "title": item.title,
                "category": item.category.value if hasattr(item.category, "value") else item.category,
                "count": item_counts[iid],
            })

    avg_eff = [u.effectiveness for u in usages if u.effectiveness is not None]
    avg = round(sum(avg_eff) / len(avg_eff), 1) if avg_eff else None

    return FirstAidStatsOut(
        total_items=len(items),
        total_usages=len(usages),
        top_items=top_items,
        avg_effectiveness=avg,
    )
