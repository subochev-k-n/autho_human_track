from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import ColumnType, CustomColumn, User
from app.schemas import (
    ColumnCreate,
    ColumnOut,
    ColumnReorder,
    ColumnUpdate,
)

router = APIRouter()


@router.get("/", response_model=list[ColumnOut])
def list_columns(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Список кастомных колонок пользователя."""
    columns = (
        db.query(CustomColumn)
        .filter(CustomColumn.user_id == current_user.id)
        .order_by(CustomColumn.sort_order)
        .all()
    )
    return columns


@router.post("/", response_model=ColumnOut, status_code=status.HTTP_201_CREATED)
def create_column(
    data: ColumnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Создать новую кастомную колонку."""
    if data.column_type not in ("rating", "text"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Тип колонки должен быть "rating" или "text"',
        )

    max_order = (
        db.query(CustomColumn.sort_order)
        .filter(CustomColumn.user_id == current_user.id)
        .order_by(CustomColumn.sort_order.desc())
        .first()
    )
    next_order = (max_order[0] + 1) if max_order else 0

    col = CustomColumn(
        user_id=current_user.id,
        name=data.name,
        column_type=ColumnType(data.column_type),
        sort_order=next_order,
    )
    db.add(col)
    db.commit()
    db.refresh(col)
    return col


@router.put("/reorder", response_model=list[ColumnOut])
def reorder_columns(
    data: ColumnReorder,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Массовое обновление порядка колонок."""
    ids = [item.id for item in data.items]

    columns = (
        db.query(CustomColumn)
        .filter(
            CustomColumn.id.in_(ids),
            CustomColumn.user_id == current_user.id,
        )
        .all()
    )

    if len(columns) != len(ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некоторые колонки не найдены",
        )

    order_map = {item.id: item.sort_order for item in data.items}
    for col in columns:
        col.sort_order = order_map[col.id]

    db.commit()

    return (
        db.query(CustomColumn)
        .filter(CustomColumn.user_id == current_user.id)
        .order_by(CustomColumn.sort_order)
        .all()
    )


@router.put("/{column_id}", response_model=ColumnOut)
def update_column(
    column_id: int,
    data: ColumnUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Обновить кастомную колонку."""
    col = (
        db.query(CustomColumn)
        .filter(
            CustomColumn.id == column_id,
            CustomColumn.user_id == current_user.id,
        )
        .first()
    )
    if not col:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Колонка не найдена",
        )

    if data.name is not None:
        col.name = data.name
    if data.column_type is not None:
        if data.column_type not in ("rating", "text"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Тип колонки должен быть "rating" или "text"',
            )
        col.column_type = ColumnType(data.column_type)
    if data.sort_order is not None:
        col.sort_order = data.sort_order

    db.commit()
    db.refresh(col)
    return col


@router.delete("/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_column(
    column_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Удалить кастомную колонку (каскадно удалит все её значения)."""
    col = (
        db.query(CustomColumn)
        .filter(
            CustomColumn.id == column_id,
            CustomColumn.user_id == current_user.id,
        )
        .first()
    )
    if not col:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Колонка не найдена",
        )

    db.delete(col)
    db.commit()
