# PLATFORM-OWNED: тестовый набор runner (образ python312)
from fastapi.testclient import TestClient

from app.main import app


def test_health():
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_unknown_is_404():
    assert TestClient(app).get("/nope").status_code == 404
