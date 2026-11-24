# Updated Implementation and Testing Guide

This update preserves the original 10-phase application and adds targeted fixes and test scaffolding. It does not claim production certification.

## Changes in this update

1. Fixed the inspection lookup contract: `GET /api/v1/inspections?assignment_id=<id>` now returns the matching inspection object or `null`; without the query it returns a list. This matches the frontend inspection workspace.
2. Added an admin-only inspection review endpoint: `POST /api/v1/inspections/{inspection_id}/review?decision=approved|rejected`. Only submitted inspections can be reviewed.
3. Connected locally queued photos to the inspection sync acknowledgement. Photos are uploaded after the server returns an inspection ID and are marked uploaded only after successful response. Failed uploads remain local for a later attempt.
4. Added a Dexie v2 compound index for `[staffId+assignmentId]` and scoped draft/outbox queries by the active user, reducing cross-account draft exposure on shared devices. This is a data-isolation improvement, not a complete shared-device logout/retention policy.
5. Added strict WebP signature checking (`RIFF` + `WEBP`) rather than accepting any RIFF file.
6. Added frontend unit-test scripts and examples for image validation and exponential retry timing.
7. Added a Playwright smoke test for the login screen.
8. Added backend API smoke tests for health/readiness, invalid login, and protected routes.
9. Pinned bcrypt below 4.1 to avoid the known Passlib compatibility issue with newer bcrypt releases.

## Backend API additions / behavior

### Inspection lookup
`GET /api/v1/inspections` returns all inspections visible to the authenticated user.
`GET /api/v1/inspections?assignment_id=12` returns one matching inspection or `null`. Field staff can only see their own records.

### Review
`POST /api/v1/inspections/12/review?decision=approved`
`POST /api/v1/inspections/12/review?decision=rejected`
Requires Admin/Supervisor. A record must be submitted first. Review actions are written to the audit log.

## Testing strategy

| Level | Tool | Scope | Command |
|---|---|---|---|
| Backend API tests | pytest + FastAPI TestClient | Health, readiness, auth boundary, API contracts | `cd backend && pytest -q` |
| Frontend unit tests | Vitest | Image validation and retry policy | `cd frontend && npm test` |
| Browser smoke tests | Playwright | Login page controls and app shell | `cd frontend && npx playwright install chromium && npm run test:e2e` |
| Manual API tests | Postman | Login, assignments, inspections, review, photos, sync | Import `docs/15-api-test-cases.md` |
| Performance | Locust (optional) | Concurrent API load and sync bursts | See below |
| Security | OWASP ZAP (optional) | Passive scan, auth boundaries, headers | Run only against a test deployment |

## Manual test checklist

- [ ] Admin can sign in; invalid credentials return 401.
- [ ] Unauthenticated users cannot access assignments or inspections.
- [ ] Field staff cannot access another staff member's assignment.
- [ ] Assignment is cached locally after online load.
- [ ] Inspection draft survives refresh while browser storage remains available.
- [ ] Offline edits are queued and are not deleted before server acknowledgement.
- [ ] Reconnect and run Sync now; accepted operations leave the outbox.
- [ ] Duplicate operation ID does not create a second inspection update.
- [ ] Version mismatch returns a conflict and local data remains intact.
- [ ] Supported JPEG/PNG/WebP files up to 8 MB are accepted; unsupported/oversized files are rejected.
- [ ] Locally queued photo uploads after inspection sync acknowledgement.
- [ ] Admin can approve/reject submitted inspection; field staff receives 403 if attempting review.
- [ ] Verify account switching on a shared device; user-scoped draft/outbox indexes are included; validate account-switch and retention policy on target browsers before production.

## Important remaining production work

- Refresh token rotation/revocation and hashed refresh-session persistence are not implemented by this update.
- Existing databases need Alembic migrations; `create_all` does not modify existing tables.
- Add per-user IndexedDB partitioning and a logout data-retention policy before shared-device rollout.
- Add robust photo MIME/signature validation for WebP (RIFF + WEBP marker), virus scanning if required, storage cleanup, and photo download/preview APIs.
- Add an explicit conflict resolution UI and retry scheduling with jitter. The helper tests cover delay calculation only; a durable scheduler is still required.
- Add admin review UI, assignment edit/cancel UI, password reset, audit-log viewer, and automated backup/restore drills.
- Run full browser tests on Chromium, Firefox, WebKit and real Android devices; service-worker/offline behavior needs real-browser verification.
- Replace development secrets and default admin password; deploy behind HTTPS with restrictive CORS.

## Run locally

### Backend
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Tests
```bash
# backend
cd backend && pytest -q
# frontend unit
cd frontend && npm test
# frontend browser smoke test
cd frontend && npx playwright install chromium && npm run test:e2e
```

Default local admin: `admin@example.com` / `ChangeMe123!`. Change this immediately outside local development.
