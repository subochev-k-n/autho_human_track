import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(120), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    entries = relationship("Entry", back_populates="user", cascade="all, delete-orphan")
    custom_columns = relationship("CustomColumn", back_populates="user", cascade="all, delete-orphan")
    first_aid_items = relationship("FirstAidItem", back_populates="user", cascade="all, delete-orphan")
    first_aid_usages = relationship("FirstAidUsage", back_populates="user", cascade="all, delete-orphan")


class Entry(Base):
    __tablename__ = "entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(Date, nullable=False)
    day_of_week = Column(String(20), nullable=False)
    energy = Column(Integer, nullable=True)
    comfort = Column(Integer, nullable=True)
    productivity = Column(Integer, nullable=True)
    interaction = Column(Integer, nullable=True)
    sovereignty = Column(Integer, nullable=True)
    self_score = Column(Integer, nullable=True)
    day_score = Column(Integer, nullable=True)
    event = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_user_date"),
    )

    user = relationship("User", back_populates="entries")
    column_values = relationship("EntryColumnValue", back_populates="entry", cascade="all, delete-orphan")


class ColumnType(str, enum.Enum):
    RATING = "rating"
    TEXT = "text"


class FirstAidCategory(str, enum.Enum):
    FATIGUE = "fatigue"
    APATHY = "apathy"
    ANXIETY = "anxiety"
    NEGATIVITY = "negativity"


class FirstAidActionType(str, enum.Enum):
    INSTANT = "instant"
    TACTICAL = "tactical"
    DAILY = "daily"


class FirstAidItem(Base):
    __tablename__ = "first_aid_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    category = Column(Enum(FirstAidCategory), nullable=False)
    action_type = Column(Enum(FirstAidActionType), nullable=False)
    time_cost = Column(String(50), default="")
    duration = Column(String(50), default="")
    feelings = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="first_aid_items")
    usages = relationship("FirstAidUsage", back_populates="item", cascade="all, delete-orphan")


class FirstAidUsage(Base):
    __tablename__ = "first_aid_usages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    item_id = Column(Integer, ForeignKey("first_aid_items.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    used_at = Column(DateTime, default=datetime.utcnow)
    effectiveness = Column(Integer, nullable=True)
    note = Column(Text, nullable=True)

    user = relationship("User", back_populates="first_aid_usages")
    item = relationship("FirstAidItem", back_populates="usages")


class CustomColumn(Base):
    __tablename__ = "custom_columns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(100), nullable=False)
    column_type = Column(Enum(ColumnType), nullable=False, default=ColumnType.RATING)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="custom_columns")
    values = relationship("EntryColumnValue", back_populates="column", cascade="all, delete-orphan")


class EntryColumnValue(Base):
    __tablename__ = "entry_column_values"

    id = Column(Integer, primary_key=True, autoincrement=True)
    column_id = Column(Integer, ForeignKey("custom_columns.id"), nullable=False)
    entry_id = Column(Integer, ForeignKey("entries.id"), nullable=False)
    value = Column(String(500), nullable=False)

    __table_args__ = (
        UniqueConstraint("column_id", "entry_id", name="uq_column_entry"),
    )

    column = relationship("CustomColumn", back_populates="values")
    entry = relationship("Entry", back_populates="column_values")
