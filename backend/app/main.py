import json
import uuid
from datetime import date
from pathlib import Path

from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File, Query
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import Base, engine, get_db, SessionLocal
from app.models import (
    User, Assignment, Inspection, Photo, SyncOperation,
    AuditLog, Notification
)
from app.schemas import (
    LoginIn, RefreshIn, UserCreate, UserUpdate, UserOut,
    AssignmentCreate, InspectionSave, SyncInspection,
    InspectionReview, RevisitRequest
)
from app.security import (
    hash_password, verify_password, create_tokens, decode,
    current_user, require_admin
)


app = FastAPI(title=settings.app_name, version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    # Creates new tables, but does not alter columns in existing tables.
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.email == settings.admin_email.lower())):
            db.add(User(
                email=settings.admin_email.lower(),
                full_name="System Administrator",
                password_hash=hash_password(settings.admin_password),
                role="admin_supervisor",
                is_active=True,
            ))
            db.commit()


@app.get("/")
def home():
    return {"message": "Field Inspection Backend is running", "status": "success"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready(db: Session = Depends(get_db)):
    try:
        db.execute(select(User).limit(1))
        return {"status": "ready", "database": "available"}
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable")


def add_notification(db: Session, user_id: int, title: str, message: str, kind: str):
    db.add(Notification(
        user_id=user_id,
        title=title,
        message=message,
        notification_type=kind,
        is_read=False,
    ))


def notify_admins(db: Session, title: str, message: str, kind: str):
    admins = db.scalars(
        select(User).where(User.role == "admin_supervisor", User.is_active.is_(True))
    ).all()
    for admin in admins:
        add_notification(db, admin.id, title, message, kind)


@app.post("/api/v1/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not user.is_active or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return create_tokens(user)


@app.post("/api/v1/auth/refresh")
def refresh(data: RefreshIn, db: Session = Depends(get_db)):
    payload = decode(data.refresh_token, "refresh")
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User unavailable")
    return create_tokens(user)


@app.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }


# ---------------- USER MANAGEMENT ----------------

@app.get("/api/v1/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return list(db.scalars(select(User).order_by(User.id)))


@app.post("/api/v1/users", response_model=UserOut)
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already exists")

    user = User(
        email=email,
        full_name=data.full_name.strip(),
        password_hash=hash_password(data.password),
        role=data.role,
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(AuditLog(
        actor_id=admin.id, action="user_created",
        entity="user", entity_id=str(user.id)
    ))
    db.commit()
    db.refresh(user)
    return user


@app.patch("/api/v1/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    updates = data.model_dump(exclude_unset=True)
    assignment_reassignments = updates.pop("assignment_reassignments", {}) or {}
    assign_assignment_ids = updates.pop("assign_assignment_ids", []) or []

    # An administrator may edit their own profile, but cannot remove their own
    # administrative access or deactivate their own account.
    requested_role = updates.get("role", target.role)
    requested_active = updates.get("is_active", target.is_active)
    if target.id == admin.id and (requested_role != "admin_supervisor" or requested_active is False):
        raise HTTPException(status_code=400, detail="You cannot change your own Admin role or deactivate your own account")

    if "email" in updates and updates["email"] is not None:
        email = updates["email"].lower()
        existing = db.scalar(select(User).where(User.email == email, User.id != user_id))
        if existing:
            raise HTTPException(status_code=409, detail="Email already exists")
        target.email = email

    if "full_name" in updates and updates["full_name"] is not None:
        target.full_name = updates["full_name"].strip()

    if updates.get("password"):
        target.password_hash = hash_password(updates["password"])

    # Admin or inactive accounts must not retain active work. Completed,
    # approved, rejected and cancelled assignments remain as historical records.
    active_assignment_statuses = [
        "pending", "assigned", "in_progress", "submitted", "revisit_required"
    ]
    remaining_assignments = list(db.scalars(
        select(Assignment).where(
            Assignment.assignee_id == target.id,
            Assignment.status.in_(active_assignment_statuses),
        )
    ))
    if (requested_role != "field_staff" or requested_active is False) and remaining_assignments:
        names = ", ".join(a.title for a in remaining_assignments[:4])
        raise HTTPException(
            status_code=400,
            detail=(
                "This user still has active assignments. Reassign them from the Assignments page "
                f"before changing the role to Admin or making the account inactive. Active work: {names}"
            ),
        )

    if "role" in updates and updates["role"] is not None:
        target.role = updates["role"]
    if "is_active" in updates and updates["is_active"] is not None:
        target.is_active = updates["is_active"]

    db.add(AuditLog(
        actor_id=admin.id, action="user_updated",
        entity="user", entity_id=str(target.id)
    ))
    db.commit()
    db.refresh(target)
    return target


@app.delete("/api/v1/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # Soft-deactivate only. Never delete the user or historical records.
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    if list(db.scalars(select(Assignment).where(Assignment.assignee_id == target.id))):
        raise HTTPException(status_code=400, detail="Reassign this user's work before deactivating the account")

    target.is_active = False
    db.add(AuditLog(
        actor_id=admin.id, action="user_deactivated",
        entity="user", entity_id=str(target.id)
    ))
    db.commit()
    return {"status": "deactivated", "user_id": target.id}


# Keep the previous deactivate route working for older frontend versions.
@app.patch("/api/v1/users/{user_id}/deactivate")
def deactivate_user_legacy(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    target.is_active = False
    db.add(AuditLog(
        actor_id=admin.id, action="user_deactivated",
        entity="user", entity_id=str(target.id)
    ))
    db.commit()
    return {"status": "deactivated"}


# ---------------- ASSIGNMENTS ----------------

def assignment_json(a, db):
    assignee = db.get(User, a.assignee_id)
    creator = db.get(User, a.created_by)
    return {
        "id": a.id,
        "title": a.title,
        "location": a.location,
        "instructions": a.instructions,
        "priority": a.priority,
        "due_date": a.due_date,
        "status": a.status,
        "assignee_id": a.assignee_id,
        "assignee_name": assignee.full_name if assignee else "Unknown",
        "created_by": a.created_by,
        "created_by_name": creator.full_name if creator else "Unknown",
    }


@app.get("/api/v1/assignments")
def list_assignments(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    query = select(Assignment).order_by(Assignment.id.desc())
    if user.role == "field_staff":
        query = query.where(Assignment.assignee_id == user.id)
    return [assignment_json(row, db) for row in db.scalars(query).all()]


@app.post("/api/v1/assignments")
def create_assignment(
    data: AssignmentCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    assignee = db.get(User, data.assignee_id)
    if not assignee or not assignee.is_active or assignee.role != "field_staff":
        raise HTTPException(status_code=422, detail="Assignee must be an active field_staff user")

    row = Assignment(**data.model_dump(), created_by=admin.id, status="assigned")
    db.add(row)
    db.flush()
    add_notification(
        db, assignee.id, "New inspection assigned",
        f"You have been assigned: {row.title}. Due date: {row.due_date or 'Not set'}.",
        "assignment",
    )
    db.add(AuditLog(
        actor_id=admin.id, action="assignment_created",
        entity="assignment", entity_id=str(row.id)
    ))
    db.commit()
    db.refresh(row)
    return assignment_json(row, db)


# ---------------- INSPECTIONS ----------------

def inspection_json(row: Inspection, db: Session | None = None):
    result = {
        "id": row.id,
        "assignment_id": row.assignment_id,
        "staff_id": row.staff_id,
        "status": row.status,
        "remarks": row.remarks,
        "answers": json.loads(row.answers_json or "{}"),
        "version": row.version,
        "review_remarks": row.review_remarks or "",
        "reviewed_by": row.reviewed_by,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if db is not None:
        staff = db.get(User, row.staff_id)
        assignment = db.get(Assignment, row.assignment_id)
        result["staff_name"] = staff.full_name if staff else "Unknown"
        result["assignment_title"] = assignment.title if assignment else "Unknown"
    return result


def can_access_inspection(row: Inspection, user: User):
    if user.role == "admin_supervisor":
        return True
    return row.staff_id == user.id


@app.get("/api/v1/inspections")
def list_inspections(
    assignment_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    query = select(Inspection).order_by(Inspection.id.desc())
    if user.role == "field_staff":
        query = query.where(Inspection.staff_id == user.id)
    if assignment_id is not None:
        query = query.where(Inspection.assignment_id == assignment_id)
    rows = [inspection_json(row, db) for row in db.scalars(query).all()]
    return (rows[0] if rows else None) if assignment_id is not None else rows


@app.get("/api/v1/inspections/{inspection_id}")
def get_inspection(
    inspection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    row = db.get(Inspection, inspection_id)
    if not row or not can_access_inspection(row, user):
        raise HTTPException(status_code=404, detail="Inspection not found")
    result = inspection_json(row, db)
    photos = db.scalars(
        select(Photo).where(Photo.inspection_id == row.id).order_by(Photo.id)
    ).all()
    result["photos"] = [
        {
            "id": photo.id,
            "filename": photo.filename,
            "content_type": photo.content_type,
            "size_bytes": photo.size_bytes,
            "created_at": photo.created_at.isoformat() if photo.created_at else None,
            "url": f"/api/v1/photos/{photo.id}",
        }
        for photo in photos
    ]
    return result


@app.post("/api/v1/inspections")
def create_inspection(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if user.role == "field_staff" and assignment.assignee_id != user.id:
        raise HTTPException(status_code=403, detail="Not your assignment")

    existing = db.scalar(select(Inspection).where(
        Inspection.assignment_id == assignment_id,
        Inspection.staff_id == user.id,
    ))
    if existing:
        return inspection_json(existing, db)

    row = Inspection(assignment_id=assignment_id, staff_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return inspection_json(row, db)


@app.patch("/api/v1/inspections/{inspection_id}")
def update_inspection(
    inspection_id: int,
    data: InspectionSave,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    row = db.get(Inspection, inspection_id)
    if not row or not can_access_inspection(row, user):
        raise HTTPException(status_code=404, detail="Inspection not found")
    if user.role != "field_staff":
        raise HTTPException(status_code=403, detail="Only assigned field staff can update inspection data")
    if row.status in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail="Submitted inspection cannot be edited")

    if data.base_version is not None and data.base_version != row.version:
        raise HTTPException(status_code=409, detail={
            "code": "VERSION_CONFLICT",
            "server_version": row.version,
            "inspection": inspection_json(row, db),
        })

    row.status = data.status
    row.remarks = data.remarks
    row.answers_json = json.dumps(data.answers)
    row.version += 1
    assignment = db.get(Assignment, row.assignment_id)
    if assignment:
        assignment.status = data.status
    db.commit()
    db.refresh(row)
    return inspection_json(row, db)


@app.post("/api/v1/inspections/{inspection_id}/submit")
def submit_inspection(
    inspection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    row = db.get(Inspection, inspection_id)
    if not row or not can_access_inspection(row, user):
        raise HTTPException(status_code=404, detail="Inspection not found")
    if user.role != "field_staff":
        raise HTTPException(status_code=403, detail="Only field staff can submit inspections")

    row.status = "submitted"
    row.version += 1
    assignment = db.get(Assignment, row.assignment_id)
    if assignment:
        assignment.status = "submitted"
    notify_admins(
        db, "Inspection submitted",
        f"Inspection #{row.id} for assignment #{row.assignment_id} is ready for review.",
        "inspection_submitted",
    )
    db.add(AuditLog(
        actor_id=user.id, action="inspection_submitted",
        entity="inspection", entity_id=str(row.id)
    ))
    db.commit()
    db.refresh(row)
    return inspection_json(row, db)


@app.post("/api/v1/inspections/{inspection_id}/review")
def review_inspection(
    inspection_id: int,
    data: InspectionReview,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    row = db.get(Inspection, inspection_id)
    if not row:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if row.status != "submitted":
        raise HTTPException(status_code=409, detail="Only submitted inspections can be reviewed")

    row.review_remarks = data.review_remarks
    row.reviewed_by = admin.id
    from datetime import datetime, timezone
    row.reviewed_at = datetime.now(timezone.utc)
    row.version += 1

    if data.decision == "approved":
        row.status = "approved"
        staff_message = f"Your inspection #{row.id} has been approved."
        action = "inspection_approved"
        assignment_status = "approved"
    elif data.decision == "rejected":
        row.status = "rejected"
        staff_message = f"Your inspection #{row.id} was rejected. Review: {data.review_remarks or 'See admin for details.'}"
        action = "inspection_rejected"
        assignment_status = "rejected"
    elif data.decision == "request_correction":
        row.status = "in_progress"
        staff_message = f"Corrections are requested for inspection #{row.id}. Review: {data.review_remarks or 'Please contact admin.'}"
        action = "inspection_correction_requested"
        assignment_status = "in_progress"

    assignment = db.get(Assignment, row.assignment_id)
    if assignment:
        assignment.status = assignment_status

    add_notification(db, row.staff_id, "Inspection review update", staff_message, "inspection_review")
    db.add(AuditLog(
        actor_id=admin.id, action=action,
        entity="inspection", entity_id=str(row.id)
    ))
    db.commit()
    db.refresh(row)
    return inspection_json(row, db)


@app.post("/api/v1/assignments/{assignment_id}/revisit")
def request_assignment_revisit(
    assignment_id: int,
    data: RevisitRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    inspection = db.scalar(select(Inspection).where(
        Inspection.assignment_id == assignment_id
    ).order_by(Inspection.id.desc()))
    if not inspection or inspection.status != "approved":
        raise HTTPException(
            status_code=409,
            detail="A revisit can only be requested after an inspection is approved",
        )

    inspection.status = "revisit_required"
    inspection.review_remarks = data.reason
    inspection.reviewed_by = admin.id
    from datetime import datetime, timezone
    inspection.reviewed_at = datetime.now(timezone.utc)
    inspection.version += 1
    assignment.status = "revisit_required"

    add_notification(
        db,
        inspection.staff_id,
        "Repeat site visit required",
        f"Admin requested another visit for '{assignment.title}'. Reason: {data.reason}",
        "revisit_required",
    )
    db.add(AuditLog(
        actor_id=admin.id,
        action="inspection_revisit_requested",
        entity="inspection",
        entity_id=str(inspection.id),
    ))
    db.commit()
    db.refresh(inspection)
    return {
        "status": "revisit_required",
        "assignment_id": assignment.id,
        "inspection": inspection_json(inspection, db),
    }


# ---------------- PHOTO UPLOAD / VIEW ----------------

@app.post("/api/v1/inspections/{inspection_id}/photos")
async def upload_photo(
    inspection_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    row = db.get(Inspection, inspection_id)
    if not row or not can_access_inspection(row, user):
        raise HTTPException(status_code=404, detail="Inspection not found")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty photo file")
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo exceeds 8 MB")

    if content.startswith(b"\xff\xd8\xff"):
        detected_type, extension = "image/jpeg", ".jpg"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        detected_type, extension = "image/png", ".png"
    elif len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        detected_type, extension = "image/webp", ".webp"
    else:
        raise HTTPException(
            status_code=415,
            detail="Unsupported image format. Use JPEG, PNG or WEBP.",
        )

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}{extension}"
    (upload_dir / safe_name).write_bytes(content)

    photo = Photo(
        inspection_id=row.id,
        filename=safe_name,
        content_type=detected_type,
        size_bytes=len(content),
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return {
        "id": photo.id,
        "filename": photo.filename,
        "content_type": photo.content_type,
        "size_bytes": photo.size_bytes,
    }


@app.get("/api/v1/photos/{photo_id}")
def get_photo(
    photo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    inspection = db.get(Inspection, photo.inspection_id)
    if not inspection or not can_access_inspection(inspection, user):
        raise HTTPException(status_code=404, detail="Photo not found")

    file_path = Path(settings.upload_dir) / photo.filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Photo file is missing")
    return FileResponse(
        file_path,
        media_type=photo.content_type,
        filename=photo.filename,
    )


# ---------------- SYNC ----------------

@app.post("/api/v1/sync/operations")
def sync_operations(
    items: list[SyncInspection],
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    results = []
    for item in items:
        previous = db.scalar(select(SyncOperation).where(
            SyncOperation.operation_id == item.operation_id
        ))
        if previous:
            if previous.actor_id != user.id:
                results.append({
                    "operation_id": item.operation_id,
                    "status": "rejected",
                    "reason": "operation_id_owned_by_another_user",
                })
            else:
                results.append(json.loads(previous.response_json))
            continue

        assignment = db.get(Assignment, item.assignment_id)
        if not assignment or (
            user.role == "field_staff" and assignment.assignee_id != user.id
        ):
            results.append({
                "operation_id": item.operation_id,
                "status": "rejected",
                "reason": "not_authorized",
            })
            continue

        row = db.scalar(select(Inspection).where(
            Inspection.assignment_id == item.assignment_id,
            Inspection.staff_id == user.id,
        ))
        if not row:
            row = Inspection(
                assignment_id=item.assignment_id,
                staff_id=user.id,
            )
            db.add(row)
            db.flush()

        if item.base_version is not None and item.base_version != row.version:
            results.append({
                "operation_id": item.operation_id,
                "status": "conflict",
                "server_version": row.version,
            })
            continue

        row.status = item.status
        row.remarks = item.remarks
        row.answers_json = json.dumps(item.answers)
        row.version += 1
        assignment.status = item.status

        response = {
            "operation_id": item.operation_id,
            "status": "accepted",
            "inspection_id": row.id,
            "version": row.version,
        }
        db.add(SyncOperation(
            operation_id=item.operation_id,
            actor_id=user.id,
            response_json=json.dumps(response),
        ))
        db.add(AuditLog(
            actor_id=user.id, action="sync_inspection",
            entity="inspection", entity_id=str(row.id)
        ))
        results.append(response)

    db.commit()
    return {"results": results}


# ---------------- DASHBOARD ANALYTICS ----------------

@app.get("/api/v1/dashboard/analytics")
def dashboard_analytics(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    today = date.today()
    assignments = db.scalars(select(Assignment)).all()
    staff = db.scalars(select(User).where(
        User.role == "field_staff",
        User.is_active.is_(True),
    ).order_by(User.full_name)).all()

    def counts(rows):
        statuses = [str(x.status or "").lower() for x in rows]
        return {
            "total": len(rows),
            "pending": sum(s in ("assigned", "pending", "draft") for s in statuses),
            "in_progress": sum(s == "in_progress" for s in statuses),
            "submitted": sum(s == "submitted" for s in statuses),
            "completed": sum(s in ("completed", "approved") for s in statuses),
            "rejected": sum(s == "rejected" for s in statuses),
        }

    overdue = []
    for a in assignments:
        if not a.due_date or a.status in ("approved", "completed"):
            continue
        try:
            due = date.fromisoformat(a.due_date[:10])
        except ValueError:
            continue
        if due < today:
            overdue.append(a.id)

    staff_rows = []
    for member in staff:
        member_assignments = [a for a in assignments if a.assignee_id == member.id]
        staff_rows.append({
            "staff_id": member.id,
            "staff_name": member.full_name,
            **counts(member_assignments),
        })

    return {
        **counts(assignments),
        "overdue": len(overdue),
        "overdue_assignment_ids": overdue,
        "staff": staff_rows,
    }


# ---------------- NOTIFICATIONS ----------------

@app.get("/api/v1/notifications")
def list_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
    ).all()
    return [
        {
            "id": n.id,
            "title": n.title,
            "message": n.message,
            "notification_type": n.notification_type,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in rows
    ]


@app.patch("/api/v1/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.is_read = True
    db.commit()
    return {"status": "read", "id": notification.id}
