from fastapi.testclient import TestClient
from app.main import app

def test_health_and_readiness():
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json()["database"] == "available"

def test_invalid_login_is_rejected():
    with TestClient(app) as client:
        response = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong-password"})
        assert response.status_code == 401

def test_protected_endpoint_requires_authentication():
    with TestClient(app) as client:
        response = client.get("/api/v1/assignments")
        assert response.status_code == 401

def test_inspection_filter_contract_requires_authentication():
    with TestClient(app) as client:
        response = client.get("/api/v1/inspections?assignment_id=999")
        assert response.status_code == 401
