# Offline Field Inspection Management System

A Docker-ready, offline-first field inspection application. This repository implements the ten planned phases as an integrated MVP: authentication, two-role authorization, assignments, inspections, local persistence, photo capture/upload, PWA shell, outbox synchronization, security boundaries and tests.

## Canonical roles
- `admin_supervisor`: the single privileged role for user management, assignments, team oversight and review.
- `field_staff`: sees only assigned work and completes inspections.

Admin and Supervisor are UI descriptions of the same role; they are not separate role values.

## Stack
- Frontend: React, Vite, TypeScript, React Router, Dexie/IndexedDB, PWA manifest and service worker.
- Backend: FastAPI, SQLAlchemy 2, Pydantic, JWT, password hashing.
- Database: PostgreSQL.
- Operations: Docker Compose, Alembic-ready schema setup, pytest and Vitest-ready frontend.

## Run everything
1. Copy `.env.example` to `.env`.
2. Change `JWT_SECRET` and the default admin password before using outside local development.
3. Run:

```bash
docker compose up --build
```

Open:
- Frontend: http://localhost:5173
- API docs: http://localhost:8000/docs
- API health: http://localhost:8000/health

Default local admin:
- Email: `admin@example.com`
- Password: `ChangeMe123!`

Change this password immediately. The default account is created only when the database is empty.

## How offline mode works
- Assignments are downloaded into IndexedDB after login.
- Inspection drafts and photo Blobs are saved locally before network sync is attempted.
- A durable outbox stores operations with stable operation IDs.
- On reconnect or manual retry, operations are sent to FastAPI.
- The backend checks role, ownership and base version, and uses the operation ID for idempotency.
- Local records are marked synced only after a server acknowledgement.

Browser storage is device-local, may be cleared by the browser and is not a server backup. Do not use this MVP as a regulated production system without security review, HTTPS, backups, retention policy and operational hardening.

## Local development without Docker
Backend:
```bash
cd backend
python -m venv .venv 
# Windows: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Frontend:
```bash
cd frontend
npm install
npm run dev
```
For local backend development set `DATABASE_URL=sqlite:///./inspection.db` in `backend/.env` or export it in the shell.

## Ten implementation phases
1. Project setup, app shell, FastAPI, PostgreSQL and Docker.
2. Authentication, JWT, refresh and two-role authorization.
3. Role-specific dashboards, users and assignment management.
4. Inspection forms, checklist, remarks and review lifecycle.
5. Dexie local database and offline drafts.
6. Camera/photo capture, local Blob storage and upload.
7. PWA manifest, service worker and connectivity handling.
8. Outbox synchronization, idempotency, retry and version conflict detection.
9. API integration, ownership checks, validation and audit events.
10. Tests, Docker workflow, setup and operational documentation.

See `docs/` for all 13 detailed project documents.


## Updated release package

See `docs/14-updated-implementation-and-testing.md` for the implementation changes, setup instructions, testing commands, and remaining production-readiness work. See `docs/15-api-test-cases.md` for manual API and workflow test cases.
