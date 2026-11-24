from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=8)
    role: Literal["admin_supervisor", "field_staff"] = "field_staff"


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    password: str | None = Field(default=None, min_length=8)
    role: Literal["admin_supervisor", "field_staff"] | None = None
    is_active: bool | None = None


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    location: str = Field(min_length=1, max_length=255)
    instructions: str = ""
    priority: Literal["low", "normal", "medium", "high", "urgent"] = "normal"
    due_date: str = ""
    assignee_id: int


class AssignmentOut(BaseModel):
    id: int
    title: str
    location: str
    instructions: str
    priority: str
    due_date: str
    status: str
    assignee_id: int

    model_config = {"from_attributes": True}


class InspectionSave(BaseModel):
    status: Literal["draft", "in_progress", "submitted"] = "draft"
    remarks: str = ""
    answers: dict[str, Any] = Field(default_factory=dict)
    base_version: int | None = None


class SyncInspection(BaseModel):
    operation_id: str
    assignment_id: int
    status: Literal["draft", "in_progress", "submitted"]
    remarks: str = ""
    answers: dict[str, Any] = Field(default_factory=dict)
    base_version: int | None = None


class InspectionReview(BaseModel):
    decision: Literal["approved", "rejected", "request_correction"]
    review_remarks: str = Field(default="", max_length=5000)


class NotificationOut(BaseModel):
    id: int
    title: str
    message: str
    notification_type: str
    is_read: bool
    created_at: Any

    model_config = {"from_attributes": True}


class RevisitRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=5000)
