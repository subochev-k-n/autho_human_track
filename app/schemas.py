from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


# === Auth schemas ===

class UserRegister(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    email: str = Field(..., max_length=120)
    password: str = Field(..., min_length=4, max_length=128)


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    is_admin: bool

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


# === Entry schemas ===

class CustomValueInput(BaseModel):
    column_id: int
    value: str = Field(..., max_length=500)


class EntryCreate(BaseModel):
    date: date
    energy: Optional[int] = Field(None, ge=-10, le=10)
    comfort: Optional[int] = Field(None, ge=-10, le=10)
    productivity: Optional[int] = Field(None, ge=-10, le=10)
    interaction: Optional[int] = Field(None, ge=-10, le=10)
    sovereignty: Optional[int] = Field(None, ge=-10, le=10)
    self_score: Optional[int] = Field(None, ge=-10, le=10)
    day_score: Optional[int] = Field(None, ge=-10, le=10)
    event: Optional[str] = Field(None, max_length=500)
    custom_values: Optional[list[CustomValueInput]] = None


class EntryOut(BaseModel):
    id: int
    user_id: int
    date: date
    day_of_week: str
    energy: Optional[int] = None
    comfort: Optional[int] = None
    productivity: Optional[int] = None
    interaction: Optional[int] = None
    sovereignty: Optional[int] = None
    self_score: Optional[int] = None
    day_score: Optional[int] = None
    event: Optional[str] = None
    custom_values: Optional[list["CustomValueOut"]] = None

    model_config = {"from_attributes": True}


class CustomValueOut(BaseModel):
    column_id: int
    column_name: str
    value: str
    column_type: str

    model_config = {"from_attributes": True}


class EntryListOut(BaseModel):
    entries: list[EntryOut]
    total: int
    page: int
    per_page: int


class TodayStatusOut(BaseModel):
    filled: bool
    can_fill: bool
    reminder: bool


# === Custom column schemas ===

class ColumnCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    column_type: str = Field(...)  # "rating" or "text"


class ColumnUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    column_type: Optional[str] = None
    sort_order: Optional[int] = None


class ColumnReorderItem(BaseModel):
    id: int
    sort_order: int


class ColumnReorder(BaseModel):
    items: list[ColumnReorderItem]


class ColumnOut(BaseModel):
    id: int
    name: str
    column_type: str
    sort_order: int

    model_config = {"from_attributes": True}


# === Stats schemas ===

class StatsOut(BaseModel):
    averages: dict
    mins: dict
    maxs: dict
    best_day: Optional[dict] = None
    worst_day: Optional[dict] = None
    streak: int = 0
    trend: dict


class CalendarDay(BaseModel):
    date: date
    avg_score: Optional[float] = None
    filled: bool


# === First Aid schemas ===

class FirstAidItemCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: str = Field(...)  # fatigue, apathy, anxiety, negativity
    action_type: str = Field(...)  # instant, tactical, daily
    time_cost: str = Field(default="", max_length=50)
    duration: str = Field(default="", max_length=50)
    feelings: Optional[str] = Field(None, max_length=1000)


class FirstAidItemUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = None
    action_type: Optional[str] = None
    time_cost: Optional[str] = Field(None, max_length=50)
    duration: Optional[str] = Field(None, max_length=50)
    feelings: Optional[str] = Field(None, max_length=1000)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class FirstAidItemOut(BaseModel):
    id: int
    title: str
    category: str
    action_type: str
    time_cost: str
    duration: str
    feelings: Optional[str] = None
    is_active: bool
    sort_order: int
    usage_count: int = 0
    avg_effectiveness: Optional[float] = None

    model_config = {"from_attributes": True}


class FirstAidUsageCreate(BaseModel):
    item_id: int
    effectiveness: Optional[int] = Field(None, ge=1, le=5)
    note: Optional[str] = Field(None, max_length=500)


class FirstAidUsageUpdate(BaseModel):
    effectiveness: Optional[int] = Field(None, ge=1, le=5)
    note: Optional[str] = Field(None, max_length=500)


class FirstAidUsageOut(BaseModel):
    id: int
    item_id: int
    user_id: int
    used_at: datetime
    effectiveness: Optional[int] = None
    note: Optional[str] = None
    item_title: str = ""
    item_category: str = ""

    model_config = {"from_attributes": True}


class FirstAidStatsOut(BaseModel):
    total_items: int
    total_usages: int
    top_items: list[dict] = []
    avg_effectiveness: Optional[float] = None
