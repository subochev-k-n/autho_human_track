from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    pool_pre_ping = False
else:
    connect_args = {}
    pool_pre_ping = True  # для PostgreSQL проверка соединения перед использованием

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=pool_pre_ping,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
