# API and Workflow Test Cases

| ID | Area | Action | Expected |
|---|---|---|---|
| AUTH-01 | Auth | Valid admin login | 200 + bearer tokens |
| AUTH-02 | Auth | Invalid password | 401 |
| AUTH-03 | Auth | Call protected route without token | 401 |
| AUTH-04 | RBAC | Field staff calls user creation | 403 |
| ASG-01 | Assignment | Admin creates assignment for active field staff | 200 |
| ASG-02 | Assignment | Field staff lists assignments | Only own assignments |
| INSP-01 | Inspection | GET with assignment_id | One inspection or null |
| INSP-02 | Inspection | Field staff opens another staff's inspection | Not found / denied |
| INSP-03 | Inspection | Save with stale base_version | 409 conflict |
| INSP-04 | Review | Admin reviews submitted inspection | Approved/rejected |
| INSP-05 | Review | Field staff attempts review | 403 |
| PHOTO-01 | Photo | Upload valid JPEG/PNG/WebP <= 8 MB | 200 |
| PHOTO-02 | Photo | Upload unsupported file | 415 |
| PHOTO-03 | Photo | Upload > 8 MB | 413 |
| SYNC-01 | Sync | Submit a unique operation ID | Accepted |
| SYNC-02 | Sync | Replay same operation ID | Original response; no duplicate |
| SYNC-03 | Sync | Stale base version | Conflict; retain local draft |
| OFF-01 | Offline | Save draft without network | IndexedDB draft + outbox entry |
| OFF-02 | Offline | Refresh while offline | Draft remains locally |
| OFF-03 | Offline | Reconnect and sync | Server acknowledgement before local cleanup |
| PHOTO-04 | Photo sync | Sync inspection with queued photo | Upload photo after inspection ack |
