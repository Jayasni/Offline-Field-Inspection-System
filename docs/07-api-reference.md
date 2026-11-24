# 07 — API Reference
- `GET /health`, `GET /ready`
- `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `GET /api/v1/auth/me`
- `GET/POST /api/v1/users`, `PATCH /api/v1/users/{id}`
- `GET/POST /api/v1/assignments`, `GET /api/v1/assignments/{id}`
- `GET/POST /api/v1/inspections`, `GET/PATCH /api/v1/inspections/{id}`, `POST /api/v1/inspections/{id}/submit`
- `POST /api/v1/inspections/{id}/photos`
- `POST /api/v1/sync/operations`
Protected endpoints use Bearer access token. Sync operation payload includes stable `operation_id`, `inspection_id`, `base_version` and inspection fields. 409 means version conflict.

## Updated inspection lookup and review

- `GET /api/v1/inspections?assignment_id={id}` returns the matching inspection object or `null` (authenticated; field staff scoped to their own inspections).
- `POST /api/v1/inspections/{id}/review?decision=approved` or `decision=rejected` reviews a submitted inspection (Admin/Supervisor only).
