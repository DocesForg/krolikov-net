import os
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, Float, Integer, String, Text, create_engine, desc, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://krolikov:krolikov@db:5432/krolikov")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class Track(Base):
    __tablename__ = "tracks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    artist: Mapped[str] = mapped_column(String(300), index=True)
    title: Mapped[str] = mapped_column(String(300), index=True)
    album: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    lyrics: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(80), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class SearchEvent(Base):
    __tablename__ = "search_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    query: Mapped[str] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(String(80), default="search")
    artist: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

class TrackInput(BaseModel):
    artist: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=1, max_length=300)
    album: Optional[str] = Field(default=None, max_length=300)
    lyrics: str = Field(default="", max_length=50000)
    source: str = Field(default="manual", max_length=80)

class EventInput(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    event_type: str = Field(default="search", max_length=80)
    artist: Optional[str] = Field(default=None, max_length=300)
    title: Optional[str] = Field(default=None, max_length=300)

class SimilarInput(BaseModel):
    query: str = Field(min_length=3, max_length=5000)
    limit: int = Field(default=5, ge=1, le=10)

app = FastAPI(title="Krolikov Music Analytics", version="1.0.0")

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

@app.get("/health")
def health():
    try:
        with engine.connect() as connection:
            connection.execute(func.now().select())
        return {"status": "ok", "database": "connected"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc

@app.post("/tracks")
def save_track(payload: TrackInput):
    with SessionLocal() as session:
        track = Track(**payload.model_dump())
        session.add(track)
        session.commit()
        session.refresh(track)
        return {"id": track.id, "artist": track.artist, "title": track.title}

@app.post("/events")
def save_event(payload: EventInput):
    with SessionLocal() as session:
        event = SearchEvent(**payload.model_dump())
        session.add(event)
        session.commit()
        session.refresh(event)
        return {"id": event.id, "saved": True}

@app.get("/history")
def history(limit: int = 30):
    limit = max(1, min(limit, 100))
    with SessionLocal() as session:
        events = session.query(SearchEvent).order_by(desc(SearchEvent.created_at)).limit(limit).all()
        return [{"id": e.id, "query": e.query, "eventType": e.event_type,
                 "artist": e.artist, "title": e.title, "createdAt": e.created_at.isoformat()}
                for e in events]

@app.post("/similar")
def similar(payload: SimilarInput):
    with SessionLocal() as session:
        tracks = session.query(Track).filter(Track.lyrics != "").all()
        if len(tracks) < 2:
            return {"results": [], "message": "Для рекомендаций сохраните тексты минимум двух треков."}
        documents = [payload.query] + [f"{t.artist} {t.title} {t.lyrics}" for t in tracks]
        try:
            matrix = TfidfVectorizer(max_features=20000, ngram_range=(1, 2), min_df=1).fit_transform(documents)
            scores = cosine_similarity(matrix[0:1], matrix[1:]).flatten()
        except ValueError:
            return {"results": [], "message": "Недостаточно текста для сравнения."}
        ranked = sorted(zip(tracks, scores), key=lambda pair: float(pair[1]), reverse=True)
        results = [{"id": track.id, "artist": track.artist, "title": track.title,
                    "album": track.album, "similarity": round(float(score), 4)}
                   for track, score in ranked[:payload.limit] if score > 0]
        session.add(SearchEvent(query=payload.query[:2000], event_type="ml_similar"))
        session.commit()
        return {"algorithm": "scikit-learn TF-IDF + cosine similarity", "results": results}
