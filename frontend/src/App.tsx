
import { useEffect, useState } from "react";
import { api, login, setAccessToken } from "./api";
import { localDB, saveDraft, type LocalPhoto } from "./db";
import type { User, Assignment, InspectionDraft } from "./types";

import DashboardLayout from "./components/DashboardLayout";
import Calendar from "./components/Calendar";
import "./components/dashboard.css";
import "./components/photo-upload-status.css";
import "./components/sidebar-and-status.css";
import "./components/user-management-update.css";

export default function App() {
    const [activePage, setActivePage] = useState("Dashboard");

    const [scheduledDate, setScheduledDate] = useState(
        new Date().toLocaleDateString("en-CA")
    );

    const [newDate, setNewDate] = useState(
        new Date().toLocaleDateString("en-CA")
    );

    const [user, setUser] = useState<User | null>(null);
    const [email, setEmail] = useState("admin@example.com");
    const [password, setPassword] = useState("");
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [creatingUser, setCreatingUser] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [savingUser, setSavingUser] = useState(false);

    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [inspectionRecords, setInspectionRecords] = useState<any[]>([]);
    const [inspectionManagementFilter, setInspectionManagementFilter] = useState("all");
    const [message, setMessage] = useState("Sign in to begin.");

    const [selected, setSelected] = useState<Assignment | null>(null);
    const [remarks, setRemarks] = useState("");
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [inspectionPhotos, setInspectionPhotos] = useState<LocalPhoto[]>([]);
    const [adminInspection, setAdminInspection] = useState<any | null>(null);
    const [inspectionReturnPage, setInspectionReturnPage] = useState("Assignments");
    const [reviewBusy, setReviewBusy] = useState(false);
    const [submittingInspection, setSubmittingInspection] = useState(false);

    const [newTitle, setNewTitle] = useState("Site safety inspection");
    const [newLocation, setNewLocation] = useState("Main site");
    const [assignee, setAssignee] = useState("");
    const [newPriority, setNewPriority] = useState("medium");

    const [pending, setPending] = useState(0);
    const [online, setOnline] = useState(navigator.onLine);
    const [syncing, setSyncing] = useState(false);
    const [assignmentStatusFilter, setAssignmentStatusFilter] = useState("all");
    const [priorityFilter, setPriorityFilter] = useState("all");

    // Restore the last signed-in profile after a browser refresh.
    // API authorization is still enforced by the backend using the stored access token.
    useEffect(() => {
        try {
            const rawUser = localStorage.getItem("field_inspection_user");
            if (!rawUser) return;
            const cachedUser = JSON.parse(rawUser) as User;
            if (
                cachedUser &&
                Number.isFinite(Number(cachedUser.id)) &&
                typeof cachedUser.email === "string" &&
                typeof cachedUser.full_name === "string" &&
                (cachedUser.role === "admin_supervisor" || cachedUser.role === "field_staff")
            ) {
                setUser(cachedUser);
                setMessage("Restored your previous session. Reconnecting...");
            }
        } catch {
            localStorage.removeItem("field_inspection_user");
        }
    }, []);

    const getStatus = (assignment: Assignment) =>
        String((assignment as Assignment & { status?: string }).status || "pending")
            .toLowerCase().replace(/\s+/g, "_");

    const getPriority = (assignment: Assignment) =>
        String((assignment as Assignment & { priority?: string }).priority || "normal").toLowerCase();

    const priorityOrder: Record<string, number> = {
        urgent: 0, high: 1, medium: 2, normal: 3, low: 4
    };

    const filteredAssignments = assignments
        .filter(a => assignmentStatusFilter === "all" || getStatus(a) === assignmentStatusFilter)
        .filter(a => priorityFilter === "all" || getPriority(a) === priorityFilter)
        .slice()
        .sort((a, b) => {
            const difference = (priorityOrder[getPriority(a)] ?? 5) - (priorityOrder[getPriority(b)] ?? 5);
            if (difference) return difference;
            return String(a.due_date || "9999-12-31").localeCompare(String(b.due_date || "9999-12-31"));
        });

    // Inspection Management is assignment-centric: every Admin-created assignment
    // appears here, even before a Field Staff member has created/synced an inspection.
    const inspectionManagementRows = assignments.map(assignment => {
        const inspection = inspectionRecords.find(
            item => Number(item.assignment_id) === Number(assignment.id)
        );
        const status = String(inspection?.status || (assignment as any).status || "assigned")
            .toLowerCase().replace(/\s+/g, "_");
        const progress = ["approved", "submitted", "completed"].includes(status) ? 100
            : ["in_progress", "request_correction", "revisit_required", "rejected"].includes(status) ? 50
            : status === "draft" ? 25
            : 0;
        return { assignment, inspection, status, progress };
    });

    // LOAD ASSIGNMENTS AND USERS
  
async function load() {
  try {
    const data = await api<Assignment[]>("/api/v1/assignments");

    // Read the latest inspection status for each assignment as well as assignment status.
    // The inspections endpoint is already used by openInspection() in this app.
    const enrichedAssignments = await Promise.all(data.map(async assignment => {
      try {
        const response = await api<any>(`/api/v1/inspections?assignment_id=${assignment.id}`);
        const inspection = Array.isArray(response)
          ? response[0]
          : (response?.items?.[0] || response?.data?.[0] || response?.inspection || response);
        const inspectionStatus = String(
          inspection?.status || inspection?.inspection_status || ""
        ).toLowerCase();
        if (inspectionStatus) {
          // Keep the actual inspection workflow status; do not collapse submitted into completed.
          return { ...assignment, status: inspectionStatus };
        }
      } catch {
        // An assignment may not have an inspection record yet.
      }
      return assignment;
    }));

    // Filter assignments for Field Staff
    const visibleAssignments =
      user?.role === "field_staff"
        ? enrichedAssignments.filter(a => Number(a.assignee_id) === Number(user.id))
        : enrichedAssignments;

    // Reflect this device's unsynced progress immediately after refresh.
    if (user?.role === "field_staff") {
      const localDrafts = await localDB.drafts.where("staffId").equals(user.id).toArray();
      const localProgress = new Map(
        localDrafts
          .filter(d => d.syncState !== "synced")
          .map(d => [d.assignmentId, d.status])
      );
      setAssignments(visibleAssignments.map(a =>
        localProgress.has(a.id) && !["completed", "approved"].includes(getStatus(a))
          ? ({ ...a, status: localProgress.get(a.id) } as Assignment)
          : a
      ));
    } else {
      setAssignments(visibleAssignments);
    }

    // Update local cache
    await localDB.assignments.bulkPut(enrichedAssignments);

    if (user?.role === "admin_supervisor") {
      setUsers(await api<User[]>("/api/v1/users"));
      try {
        const inspectionData = await api<any>("/api/v1/inspections");
        setInspectionRecords(Array.isArray(inspectionData) ? inspectionData : []);
      } catch (inspectionError) {
        console.error("Unable to load inspection management records:", inspectionError);
        setInspectionRecords([]);
      }
    }

    setMessage("Dashboard data refreshed successfully.");
  } catch (error) {
    const cached = await localDB.assignments.toArray();

    const visibleAssignments =
      user?.role === "field_staff"
        ? cached.filter(a => Number(a.assignee_id) === Number(user.id))
        : cached;

    if (user?.role === "field_staff") {
      const localDrafts = await localDB.drafts.where("staffId").equals(user.id).toArray();
      const localProgress = new Map(
        localDrafts.filter(d => d.syncState !== "synced").map(d => [d.assignmentId, d.status])
      );
      setAssignments(visibleAssignments.map(a =>
        localProgress.has(a.id) && !["completed", "approved"].includes(getStatus(a))
          ? ({ ...a, status: localProgress.get(a.id) } as Assignment)
          : a
      ));
    } else {
      setAssignments(visibleAssignments);
    }

    setMessage(
      "Network unavailable. Showing locally cached assignments."
    );
  }

  if (user) {
    const queuedOperations = await localDB.outbox.where("staffId").equals(user.id).count();
    const userDrafts = await localDB.drafts.where("staffId").equals(user.id).toArray();
    let queuedPhotos = 0;
    for (const draft of userDrafts) {
      queuedPhotos += await localDB.photos
        .where("inspectionLocalId")
        .equals(draft.localId)
        .filter(photo => !photo.uploaded)
        .count();
    }
    setPending(queuedOperations + queuedPhotos);
  }
}


    // INTERNET STATUS
    useEffect(() => {
        const on = () => setOnline(navigator.onLine);

        window.addEventListener("online", on);
        window.addEventListener("offline", on);

        return () => {
            window.removeEventListener("online", on);
            window.removeEventListener("offline", on);
        };
    }, []);

    // Automatically sync this staff member's queued drafts and photos whenever
    // connectivity returns. It also runs after session restoration if already online.
    useEffect(() => {
        if (!user || user.role !== "field_staff" || !online) return;
        void syncNow();
    }, [user, online]);


useEffect(() => {
  if (!user) return;

  const refresh = () => {
    if (navigator.onLine) {
      void load();
    }
  };

  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);

  return () => {
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}, [user]);

    // LOAD AFTER LOGIN
    useEffect(() => {
        if (user) {
            load().catch(e => setMessage(String(e)));
        }
    }, [user]);

    // LOGIN
    async function signIn(e: React.FormEvent) {
        e.preventDefault();

        try {
            setMessage("Signing in...");
            const u = await login(email, password);
            localStorage.setItem("field_inspection_user", JSON.stringify(u));
            setUser(u);
            setActivePage("Dashboard");
            setMessage(`Welcome ${u.full_name}`);
        } catch (e: any) {
            setMessage(e.message);
        }
    }

    // LOGOUT
    function logout() {
        setAccessToken(null);
        localStorage.removeItem("refresh_token");
        localStorage.removeItem("field_inspection_user");
        setUser(null);
        setAssignments([]);
        setSelected(null);
        setUsers([]);
        setActivePage("Dashboard");
    }

    // CREATE USER
async function createUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (creatingUser) return;

    const form = e.currentTarget;
    const f = new FormData(form);
    setCreatingUser(true);
    setMessage("Creating user account...");

    try {
        const role = String(f.get("role") || "field_staff");
        await api("/api/v1/users", {
            method: "POST",
            body: JSON.stringify({
                email: String(f.get("email") || "").trim(),
                full_name: String(f.get("name") || "").trim(),
                password: String(f.get("password") || ""),
                role
            })
        });

        setShowCreateUserModal(false);
        form.reset();
        await load();
        setMessage(`${role === "admin_supervisor" ? "Admin" : "Field Staff"} account created successfully.`);
    } catch (e: any) {
        console.error("Create user failed:", e);
        setMessage(e.message || "Unable to create user.");
    } finally {
        setCreatingUser(false);
    }
}

// UPDATE USER: edit only this user's profile, role and account status.
async function updateUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingUser || savingUser) return;

    const formData = new FormData(e.currentTarget);
    const role = String(formData.get("role") || editingUser.role);
    const isActive = formData.get("is_active") === "true";

    // Keep assignment management on the Assignments page. Do not allow an
    // account to lose Field Staff access while it still owns active work.
    const activeStatuses = new Set([
        "pending", "assigned", "in_progress", "submitted", "revisit_required"
    ]);
    const activeAssignments = assignments.filter(a =>
        Number(a.assignee_id) === Number(editingUser.id) && activeStatuses.has(getStatus(a))
    );

    if ((role !== "field_staff" || !isActive) && activeAssignments.length > 0) {
        const assignmentNames = activeAssignments.slice(0, 3).map(a => a.title).join(", ");
        setMessage(
            `This user still has active assignments${assignmentNames ? `: ${assignmentNames}` : ""}. Reassign them before changing the role to Admin or setting the account Inactive.`
        );
        return;
    }

    setSavingUser(true);
    setMessage("Updating user details...");
    try {
        await api(`/api/v1/users/${editingUser.id}`, {
            method: "PATCH",
            body: JSON.stringify({
                full_name: String(formData.get("name") || "").trim(),
                email: String(formData.get("email") || "").trim(),
                role,
                is_active: isActive
            })
        });

        setEditingUser(null);
        await load();
        setMessage("User details updated successfully.");
    } catch (error: any) {
        console.error("Update user failed:", error);
        setMessage(error.message || "Unable to update user.");
    } finally {
        setSavingUser(false);
    }
}

// SOFT DEACTIVATE USER - inspection and assignment history is retained.
async function deleteUser(target: User) {
    if (Number(target.id) === Number(user?.id)) {
        setMessage("You cannot deactivate your own account.");
        return;
    }
    const confirmed = window.confirm(
        `Deactivate ${target.full_name}? Their historical inspection records will be preserved.`
    );
    if (!confirmed) return;

    setMessage("Deactivating user...");
    try {
        await api(`/api/v1/users/${target.id}`, { method: "DELETE" });
        await load();
        setMessage("User deactivated. Historical records have been preserved.");
    } catch (error: any) {
        console.error("Deactivate user failed:", error);
        setMessage(error.message || "Unable to deactivate user.");
    }
}

// CREATE AND SCHEDULE ASSIGNMENT
   
// CREATE AND SCHEDULE ASSIGNMENT
async function createAssignment(e: React.FormEvent) {
    e.preventDefault();

    if (!assignee) {
        setMessage("Please select field staff.");
        return;
    }

    setMessage("Creating assignment...");

    try {
        await api("/api/v1/assignments", {
            method: "POST",
            body: JSON.stringify({
                title: newTitle,
                location: newLocation,
                assignee_id: Number(assignee),
                priority: newPriority,
                due_date: newDate,
                instructions: "Complete checklist and attach evidence."
            })
        });

        // Refresh assignments
        await load();

        // Calendar removed from Admin Sidebar
        setActivePage("Assignments");

        // Show success message after refresh
        setMessage("Assignment created and allocated successfully!");

    } catch (e: any) {
        console.error("Create assignment failed:", e);
        setMessage(e.message || "Unable to create assignment.");
    }
}


    // ADMIN VIEW: load read-only assignment + submitted inspection evidence.
    async function viewAssignment(a: Assignment, returnTo: string = "Assignments") {
        setInspectionReturnPage(returnTo);
        setSelected(a);
        setAdminInspection(null);
        setActivePage("Assignment Details");

        try {
            const matching = await api<any>(`/api/v1/inspections?assignment_id=${a.id}`);
            const inspection = Array.isArray(matching)
                ? matching[0]
                : (matching?.items?.[0] || matching?.data?.[0] || matching?.inspection || matching);
            if (inspection?.id) {
                const details = await api<any>(`/api/v1/inspections/${inspection.id}`);
                setAdminInspection(details);
            } else {
                setAdminInspection(null);
            }
        } catch (error: any) {
            console.error("Unable to load inspection details:", error);
            setAdminInspection(null);
        }
    }

    // ADMIN ONLY: approve, reject, or request corrections for a submitted inspection.
    async function reviewInspection(decision: "approved" | "rejected" | "request_correction") {
        if (user?.role !== "admin_supervisor" || !adminInspection?.id || reviewBusy) return;

        const reviewRemarks = window.prompt(
            decision === "approved"
                ? "Optional approval remarks:"
                : "Enter the reason / instructions for the field staff:"
        );
        if (reviewRemarks === null) return;
        if (decision !== "approved" && !reviewRemarks.trim()) {
            setMessage("Please enter review remarks before sending this decision.");
            return;
        }

        setReviewBusy(true);
        try {
            const updated = await api<any>(`/api/v1/inspections/${adminInspection.id}/review`, {
                method: "POST",
                body: JSON.stringify({ decision, review_remarks: reviewRemarks })
            });
            setAdminInspection({ ...adminInspection, ...updated });
            await load();
            setMessage(
                decision === "approved"
                    ? "Inspection approved."
                    : decision === "rejected"
                        ? "Inspection rejected."
                        : "Correction request sent to field staff."
            );
        } catch (error: any) {
            setMessage(error.message || "Unable to submit inspection review.");
        } finally {
            setReviewBusy(false);
        }
    }

    // ADMIN ONLY: request a repeat site visit after an inspection was approved.
    async function requestRevisit() {
        if (user?.role !== "admin_supervisor" || !selected || reviewBusy) return;
        const reason = window.prompt("Why is another site visit required?");
        if (reason === null) return;
        if (!reason.trim()) {
            setMessage("Please provide a reason for the revisit.");
            return;
        }

        setReviewBusy(true);
        try {
            const result = await api<any>(`/api/v1/assignments/${selected.id}/revisit`, {
                method: "POST",
                body: JSON.stringify({ reason })
            });
            setAdminInspection((current: any) => current ? { ...current, ...result.inspection } : current);
            await load();
            setMessage("Revisit requested. The assigned field staff has been notified.");
        } catch (error: any) {
            setMessage(error.message || "Unable to request a revisit.");
        } finally {
            setReviewBusy(false);
        }
    }

    // OPEN INSPECTION
    async function openInspection(a: Assignment) {
        if (!user) return;

        setSelected(a);

        const existing = await localDB.drafts
            .where("[staffId+assignmentId]")
            .equals([user.id, a.id])
            .first();

        if (existing) {
            setRemarks(existing.remarks);
            setAnswers(existing.answers);
            const savedPhotos = await localDB.photos
                .where("inspectionLocalId")
                .equals(existing.localId)
                .toArray();
            setInspectionPhotos(savedPhotos);
            return;
        }

        setInspectionPhotos([]);
        try {
            const server = await api<any>(
                `/api/v1/inspections?assignment_id=${a.id}`
            );

            setRemarks(server?.remarks || "");
            setAnswers(server?.answers || {});
        } catch {
            setRemarks("");
            setAnswers({});
        }
    }

    // SAVE INSPECTION OFFLINE
    async function saveLocal() {
        if (!selected || !user) return;

        const existing = await localDB.drafts
            .where("[staffId+assignmentId]")
            .equals([user.id, selected.id])
            .first();

        const draft: InspectionDraft = {
            localId: existing?.localId || crypto.randomUUID(),
            assignmentId: selected.id,
            staffId: user.id,
            status: "in_progress",
            remarks,
            answers,
            baseVersion: existing?.baseVersion ?? null,
            serverId: existing?.serverId,
            syncState: "pending",
            updatedAt: Date.now()
        };

        try {
            await saveDraft(draft);
            setAssignments(previous => previous.map(a =>
                a.id === selected.id ? ({ ...a, status: "in_progress" } as Assignment) : a
            ));

            setPending(
                await localDB.outbox.where("staffId").equals(user.id).count()
            );

            setMessage("Saved on this device. Waiting to sync.");
            if (navigator.onLine) void syncNow();
        } catch (e: any) {
            setMessage(`Local save failed: ${e.message}`);
        }
    }

    // SUBMIT INSPECTION: save the final draft locally first. If offline, it remains
    // queued and will be submitted automatically after its data and photos sync.
    async function submitInspection() {
        if (!selected || !user || user.role !== "field_staff" || submittingInspection) return;
        if (!String(answers.site_condition || "").trim()) {
            setMessage("Please enter the site condition before submitting.");
            return;
        }
        if (!String(answers.safety || "").trim()) {
            setMessage("Please select the safety compliance result before submitting.");
            return;
        }
        const confirmed = window.confirm(
            "Submit this inspection to Admin for review? You will need an Admin correction request or revisit request to edit it again."
        );
        if (!confirmed) return;

        setSubmittingInspection(true);
        try {
            const existing = await localDB.drafts
                .where("[staffId+assignmentId]")
                .equals([user.id, selected.id])
                .first();
            const draft: InspectionDraft = {
                localId: existing?.localId || crypto.randomUUID(),
                assignmentId: selected.id,
                staffId: user.id,
                status: "submitted",
                remarks,
                answers,
                baseVersion: existing?.baseVersion ?? null,
                serverId: existing?.serverId,
                syncState: "pending",
                updatedAt: Date.now()
            };
            await saveDraft(draft);
            setAssignments(previous => previous.map(a =>
                a.id === selected.id ? ({ ...a, status: "submitted" } as Assignment) : a
            ));
            setMessage(navigator.onLine
                ? "Inspection saved. Uploading inspection data and evidence before submission..."
                : "Inspection saved for submission. It will be sent to Admin automatically when you are online.");
            if (navigator.onLine) await syncNow();
        } catch (error: any) {
            setMessage(`Unable to submit inspection: ${error.message || "Please try again."}`);
        } finally {
            setSubmittingInspection(false);
        }
    }

    // SYNC OFFLINE DATA
    async function syncNow() {
        if (!user || syncing) return;
        if (!navigator.onLine) {
            setMessage("Device is offline. Your local work is safe.");
            return;
        }
        setSyncing(true);
        try {
            const items = await localDB.outbox.where("staffId").equals(user.id).toArray();
            const pendingItems = items.filter(x => x.state === "pending");

            if (pendingItems.length) {
                const result = await api<any>("/api/v1/sync/operations", {
                    method: "POST",
                    body: JSON.stringify(pendingItems.map(x => ({
                        operation_id: x.operationId,
                        assignment_id: x.assignmentId,
                        // Keep the server record editable while evidence uploads. The
                        // dedicated submit endpoint is called after all photos are uploaded.
                        status: x.status === "submitted" ? "in_progress" : x.status,
                        remarks: x.remarks,
                        answers: x.answers,
                        base_version: x.baseVersion
                    })))
                });

                for (const r of (result?.results || [])) {
                    const job = items.find(x => x.operationId === r.operation_id);
                    if (!job) continue;
                    if (r.status === "accepted") {
                        const draft = await localDB.drafts
                            .where("[staffId+assignmentId]").equals([user.id, job.assignmentId]).first();
                        if (draft) {
                            draft.baseVersion = r.version ?? draft.baseVersion;
                            draft.serverId = r.inspection_id ?? draft.serverId;
                            draft.syncState = "pending";
                            await localDB.drafts.put(draft);
                        }
                        await localDB.outbox.where("operationId").equals(r.operation_id).delete();
                    } else if (r.status === "conflict") {
                        job.state = "conflict";
                        await localDB.outbox.put(job);
                        const draft = await localDB.drafts
                            .where("[staffId+assignmentId]").equals([user.id, job.assignmentId]).first();
                        if (draft) {
                            draft.syncState = "conflict";
                            await localDB.drafts.put(draft);
                        }
                    } else {
                        // Keep the operation queued for a later retry.
                        // The supplied OutboxItem type supports pending/conflict only.
                        job.state = "pending";
                        await localDB.outbox.put(job);
                    }
                }
            }

            // Upload evidence only after a server inspection ID exists.
            const drafts = await localDB.drafts.where("staffId").equals(user.id).toArray();
            for (const draft of drafts) {
                if (!draft.serverId) continue;
                const photos = await localDB.photos.where("inspectionLocalId").equals(draft.localId).toArray();
                for (const photo of photos) {
                    if (photo.uploaded) continue;
                    const body = new FormData();
                    body.append("file", photo.blob, photo.name);
                    await api(`/api/v1/inspections/${draft.serverId}/photos`, { method: "POST", body });
                    photo.uploaded = true;
                    await localDB.photos.put(photo);
                }
                const photosLeft = await localDB.photos.where("inspectionLocalId")
                    .equals(draft.localId).filter(photo => !photo.uploaded).count();
                const operationsLeft = await localDB.outbox.where("staffId").equals(user.id)
                    .filter(item => item.assignmentId === draft.assignmentId).count();

                // Submit only after all inspection data and photo evidence reached the server.
                // This prevents Admin from reviewing an incomplete evidence upload.
                if (!photosLeft && !operationsLeft && draft.syncState !== "conflict") {
                    if (draft.status === "submitted") {
                        if (!draft.serverId) {
                            throw new Error("Inspection data has not received a server ID yet. It will retry during the next sync.");
                        }
                        await api(`/api/v1/inspections/${draft.serverId}/submit`, { method: "POST" });
                    }
                    draft.syncState = "synced";
                    await localDB.drafts.put(draft);
                }
            }

            const operationsLeft = await localDB.outbox.where("staffId").equals(user.id).count();
            const currentDrafts = await localDB.drafts.where("staffId").equals(user.id).toArray();
            let photosLeft = 0;
            for (const draft of currentDrafts) {
                photosLeft += await localDB.photos.where("inspectionLocalId").equals(draft.localId)
                    .filter(photo => !photo.uploaded).count();
            }
            setPending(operationsLeft + photosLeft);
            const submittedReady = currentDrafts.filter(d => d.status === "submitted" && d.syncState === "synced").length;
            await load();
            setMessage(operationsLeft + photosLeft === 0
                ? (submittedReady > 0
                    ? "Inspection submitted successfully and is now awaiting Admin review."
                    : "Automatic sync completed. All queued inspection updates and photos were uploaded.")
                : `Automatic sync incomplete: ${operationsLeft} operations and ${photosLeft} photos remain. Local data is retained.`);
        } catch (e: any) {
            const operationsLeft = await localDB.outbox.where("staffId").equals(user.id).count();
            setPending(operationsLeft);
            setMessage(`Sync incomplete. Local data retained. ${e.message || "Please retry."}`);
        } finally {
            setSyncing(false);
        }
    }


    // CAPTURE AND SAVE PHOTO LOCALLY

    async function capturePhoto(e: React.ChangeEvent<HTMLInputElement>) {
        const input = e.currentTarget;
        const file = input.files?.[0];

        if (!file) return;

        try {
            if (!user || !selected) {
                setMessage("Select an inspection first.");
                return;
            }

            if (file.size === 0) {
                setMessage("Selected file is empty.");
                return;
            }

            if (file.size > 8 * 1024 * 1024) {
                setMessage("Photo must be smaller than 8 MB.");
                return;
            }

            setMessage("Saving photo locally...");

            const draft = await localDB.drafts
                .where("[staffId+assignmentId]")
                .equals([user.id, selected.id])
                .first();

            const localId = draft?.localId || crypto.randomUUID();

            if (!draft) {
                const newDraft: InspectionDraft = {
                    localId,
                    assignmentId: selected.id,
                    staffId: user.id,
                    status: "in_progress",
                    remarks,
                    answers,
                    baseVersion: null,
                    syncState: "pending",
                    updatedAt: Date.now()
                };

                await saveDraft(newDraft);
            }

            await localDB.photos.add({
                localId: crypto.randomUUID(),
                inspectionLocalId: localId,
                blob: file,
                name: file.name,
                type: file.type || "application/octet-stream",
                uploaded: false
            });

            const savedPhotos = await localDB.photos
                .where("inspectionLocalId")
                .equals(localId)
                .toArray();
            setInspectionPhotos(savedPhotos);

            const queuedOperations = await localDB.outbox
                .where("staffId")
                .equals(user.id)
                .count();
            const userDrafts = await localDB.drafts.where("staffId").equals(user.id).toArray();
            let queuedPhotos = 0;
            for (const item of userDrafts) {
                queuedPhotos += await localDB.photos
                    .where("inspectionLocalId")
                    .equals(item.localId)
                    .filter(photo => !photo.uploaded)
                    .count();
            }
            setPending(queuedOperations + queuedPhotos);

            setMessage(
                `Photo "${file.name}" saved locally. Waiting for synchronization.`
            );
            if (navigator.onLine) void syncNow();

        } catch (error: any) {
            console.error("Photo local save failed:", error);
            setMessage(`Photo save failed: ${error.message || "Unknown error"}`);
        } finally {
            input.value = "";
        }
    }



    // LOGIN PAGE - EXISTING LOGIN PRESERVED
    if (!user) {
        return (
            <main className="login-wrap">
                <section className="login-card">
                    <div className="logo">FI</div>

                    <p className="kicker">FIELD OPERATIONS</p>
                    <h1>Field Inspection</h1>

                    <p className="muted">
                        Sign in to manage and complete inspections.
                    </p>

                    <form onSubmit={signIn}>
                        <label>
                            Email
                            <input
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                type="email"
                                required
                            />
                        </label>

                        <label>
                            Password
                            <input
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                type="password"
                                required
                            />
                        </label>

                        <button className="primary">Sign in</button>
                    </form>

                    <p className="hint">
                        Sign in using your authorized account credentials.
                    </p>

                    <p className="message">{message}</p>
                </section>
            </main>
        );
    }

    // ROLE-BASED DASHBOARD
    return (
        <DashboardLayout
            user={user}
            activePage={activePage}
            onNavigate={setActivePage}
            onLogout={logout}
        >
            <p className="message">{message}</p>

            {/* DASHBOARD */}
            {activePage === "Dashboard" && (
                <>
                    <h1>
                        {user.role === "admin_supervisor"
                            ? "Operations Overview"
                            : "My Dashboard"}
                    </h1>

                    <div className="content-grid">
                        <div className="panel"><h2>Total Assignments</h2><h1>{assignments.length}</h1></div>
                        <div className="panel"><h2>Pending</h2><h1>{assignments.filter(a => ["pending", "assigned"].includes(getStatus(a))).length}</h1></div>
                        <div className="panel"><h2>In Progress</h2><h1>{assignments.filter(a => getStatus(a) === "in_progress").length}</h1></div>
                        <div className="panel"><h2>Completed</h2><h1>{assignments.filter(a => ["submitted", "completed", "approved"].includes(getStatus(a))).length}</h1></div>
                        <div className="panel"><h2>Pending Sync</h2><h1>{pending}</h1></div>
                        <div className="panel"><h2>Connection</h2><h2>{online ? "Online" : "Offline"}</h2></div>
                    </div>
                    <div className="button-row">
                        <button className="secondary" onClick={() => void load()}>Refresh Dashboard</button>
                    </div>

                    <section className="panel">
                        <h2>Completed Inspections</h2>
                        {assignments.filter(a => ["submitted", "completed", "approved"].includes(getStatus(a))).length === 0 ? (
                            <p className="muted">No completed inspections are available yet. Refresh after staff syncs an inspection.</p>
                        ) : (
                            assignments
                                .filter(a => ["submitted", "completed", "approved"].includes(getStatus(a)))
                                .map(a => (
                                    <div className="assignment" key={`completed-${a.id}`}>
                                        <span>
                                            <b>{a.title}</b>
                                            <small>{a.location} · {a.assignee_name || "Assigned staff"}</small>
                                            <small>Status: {getStatus(a).replace(/_/g, " ")}</small>
                                        </span>
                                        <button type="button" className="secondary" onClick={() => viewAssignment(a)}>View</button>
                                    </div>
                                ))
                        )}
                    </section>
                </>
            )}

            {/* USER MANAGEMENT */}
            {activePage === "User Management" &&
                user.role === "admin_supervisor" && (
                    <section className="panel user-management">

                        <div className="user-management-header">
                            <div>
                                <h2>User Management</h2>
                                <p className="muted">
                                    Create and manage Admin and Field Staff accounts, roles, assignments and account status.
                                </p>
                            </div>

                            <button
                                type="button"
                                className="primary"
                                onClick={() => setShowCreateUserModal(true)}
                            >
                                + Create User
                            </button>
                        </div>

                        <div className="user-list-header">
                            <h3>All Users</h3>
                            <span>{users.length} Members</span>
                        </div>

                        {users.length === 0 ? (
                            <p className="muted">No users found.</p>
                        ) : (
                            users.map(u => (
                                <div className="assignment user-row" key={u.id}>
                                    <div className="user-avatar">
                                        {u.full_name.charAt(0).toUpperCase()}
                                    </div>

                                    <div className="user-details">
                                        <b>{u.full_name}</b>
                                        <small>{u.email}</small>
                                    </div>

                                    <span className="user-role">
                                        {u.role === "admin_supervisor" ? "Admin" : "Field Staff"}
                                    </span>
                                    <span className={`user-role ${(u as User & { is_active?: boolean }).is_active === false ? "inactive" : "active"}`}>
                                        {(u as User & { is_active?: boolean }).is_active === false ? "Inactive" : "Active"}
                                    </span>
                                    <div className="button-row user-actions">
                                        <button type="button" className="secondary" onClick={() => setEditingUser(u)}>Edit</button>
                                        {(u as User & { is_active?: boolean }).is_active === false ? (
                                            <button
                                                type="button"
                                                className="secondary"
                                                onClick={async () => {
                                                    try {
                                                        await api(`/api/v1/users/${u.id}`, {
                                                            method: "PATCH",
                                                            body: JSON.stringify({ is_active: true })
                                                        });
                                                        await load();
                                                        setMessage(`${u.full_name} has been activated.`);
                                                    } catch (error: any) {
                                                        setMessage(error.message || "Unable to activate user.");
                                                    }
                                                }}
                                            >Activate</button>
                                        ) : (
                                            <button type="button" className="secondary" onClick={() => void deleteUser(u)}>Deactivate</button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}

                        {/* CREATE USER MODAL */}
                        {showCreateUserModal && (
                            <div
                                className="user-modal-overlay"
                                onMouseDown={e => {
                                    if (e.target === e.currentTarget && !creatingUser) {
                                        setShowCreateUserModal(false);
                                    }
                                }}
                            >
                                <div
                                    className="user-modal"
                                    role="dialog"
                                    aria-modal="true"
                                    aria-labelledby="create-user-title"
                                >
                                    <div className="user-modal-header">
                                        <div>
                                            <h2 id="create-user-title">Create New User</h2>
                                            <p className="muted">
                                                Create a new Admin or Field Staff account.
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            className="modal-close"
                                            disabled={creatingUser}
                                            onClick={() => setShowCreateUserModal(false)}
                                        >
                                            ×
                                        </button>
                                    </div>

                                    <form className="user-modal-form" onSubmit={createUser}>
                                        <label>
                                            Full Name
                                            <input name="name" type="text" placeholder="Enter full name" minLength={2} required />
                                        </label>

                                        <label>
                                            Email Address
                                            <input name="email" type="email" placeholder="Enter email address" required />
                                        </label>

                                        <label>
                                            Temporary Password
                                            <input name="password" type="password" placeholder="Minimum 8 characters" minLength={8} required />
                                        </label>

                                        <label>
                                            Role
                                            <select name="role" defaultValue="field_staff">
                                                <option value="field_staff">Field Staff</option>
                                                <option value="admin_supervisor">Admin</option>
                                            </select>
                                        </label>

                                        <p className="muted">
                                            New accounts are created as Active. You can manage account status and assignment transfers from Edit User.
                                        </p>

                                        <div className="user-modal-actions">
                                            <button type="button" className="secondary" disabled={creatingUser} onClick={() => setShowCreateUserModal(false)}>
                                                Cancel
                                            </button>
                                            <button type="submit" className="primary" disabled={creatingUser}>
                                                {creatingUser ? "Creating..." : "Create User"}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}

                        {/* EDIT USER MODAL */}
                        {editingUser && (
                            <div
                                className="user-modal-overlay"
                                onMouseDown={e => {
                                    if (e.target === e.currentTarget && !savingUser) setEditingUser(null);
                                }}
                            >
                                <div className="user-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
                                    <div className="user-modal-header">
                                        <div>
                                            <h2 id="edit-user-title">Edit User</h2>
                                            <p className="muted">Update this user's profile, role and account status.</p>
                                        </div>
                                        <button type="button" className="modal-close" disabled={savingUser} onClick={() => setEditingUser(null)}>×</button>
                                    </div>

                                    <form className="user-modal-form" onSubmit={updateUser}>
                                        <label>Full Name
                                            <input name="name" type="text" defaultValue={editingUser.full_name} minLength={2} required />
                                        </label>

                                        <label>Email Address
                                            <input name="email" type="email" defaultValue={editingUser.email} required />
                                        </label>

                                        <label>Role
                                            <select name="role" defaultValue={editingUser.role}>
                                                <option value="field_staff">Field Staff</option>
                                                <option value="admin_supervisor">Admin</option>
                                            </select>
                                        </label>

                                        <label>Account Status
                                            <select
                                                name="is_active"
                                                defaultValue={String((editingUser as User & { is_active?: boolean }).is_active !== false)}
                                            >
                                                <option value="true">Active</option>
                                                <option value="false">Inactive</option>
                                            </select>
                                        </label>

                                        <p className="muted">
                                            Assignment allocation and reassignment are managed separately from this form. A user with active assignments must have that work reassigned before changing their role to Admin or making their account inactive.
                                        </p>

                                        <div className="user-modal-actions">
                                            <button type="button" className="secondary" disabled={savingUser} onClick={() => setEditingUser(null)}>Cancel</button>
                                            <button type="submit" className="primary" disabled={savingUser}>{savingUser ? "Saving..." : "Save Changes"}</button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}

                    </section>
                )}

            {/* INSPECTION MANAGEMENT - ASSIGNMENT PROGRESS + REVIEW QUEUE */}
            {activePage === "Inspection Management" && user.role === "admin_supervisor" && (
                <section className="panel inspection-management">
                    <div className="user-management-header">
                        <div>
                            <h2>Inspection Management</h2>
                            <p className="muted">Track every assigned inspection, monitor Field Staff progress and review submitted work.</p>
                        </div>
                        <button type="button" className="secondary" onClick={() => void load()}>Refresh Inspections</button>
                    </div>

                    <div className="content-grid inspection-management-summary">
                        <div className="panel"><h3>Total Assigned</h3><h2>{inspectionManagementRows.length}</h2></div>
                        <div className="panel"><h3>Not Started</h3><h2>{inspectionManagementRows.filter(row => ["assigned", "pending"].includes(row.status)).length}</h2></div>
                        <div className="panel"><h3>In Progress</h3><h2>{inspectionManagementRows.filter(row => ["in_progress", "request_correction", "revisit_required"].includes(row.status)).length}</h2></div>
                        <div className="panel"><h3>Awaiting Review</h3><h2>{inspectionManagementRows.filter(row => row.status === "submitted").length}</h2></div>
                        <div className="panel"><h3>Approved</h3><h2>{inspectionManagementRows.filter(row => row.status === "approved").length}</h2></div>
                    </div>

                    <div className="inline-form">
                        <label>Filter inspections
                            <select value={inspectionManagementFilter} onChange={e => setInspectionManagementFilter(e.target.value)}>
                                <option value="all">All assignments</option>
                                <option value="assigned">Not started / Assigned</option>
                                <option value="draft">Draft saved</option>
                                <option value="in_progress">In progress</option>
                                <option value="submitted">Awaiting review</option>
                                <option value="approved">Approved</option>
                                <option value="request_correction">Correction requested</option>
                                <option value="rejected">Rejected</option>
                                <option value="revisit_required">Revisit required</option>
                            </select>
                        </label>
                    </div>

                    <div className="user-list-header">
                        <h3>Assigned Inspections & Progress</h3>
                        <span>{inspectionManagementRows.filter(row => inspectionManagementFilter === "all" || (inspectionManagementFilter === "assigned" ? ["assigned", "pending"].includes(row.status) : row.status === inspectionManagementFilter)).length} Assignments</span>
                    </div>

                    {inspectionManagementRows.filter(row => inspectionManagementFilter === "all" || (inspectionManagementFilter === "assigned" ? ["assigned", "pending"].includes(row.status) : row.status === inspectionManagementFilter)).length === 0 ? (
                        <div className="panel">
                            <h3>No assignments found</h3>
                            <p className="muted">Assignments created by Admin will appear here. Progress updates when Field Staff save and sync their inspection.</p>
                        </div>
                    ) : (
                        inspectionManagementRows
                            .filter(row => inspectionManagementFilter === "all" || (inspectionManagementFilter === "assigned" ? ["assigned", "pending"].includes(row.status) : row.status === inspectionManagementFilter))
                            .map(({ assignment, inspection, status, progress }) => (
                                <div className="assignment inspection-management-row" key={assignment.id}>
                                    <div className="user-details" style={{ flex: 1 }}>
                                        <b>{assignment.title}</b>
                                        <small>{assignment.location || "Location not available"} · Due: {assignment.due_date || "Not scheduled"}</small>
                                        <small>Assigned to: {assignment.assignee_name || `Staff #${assignment.assignee_id}`}</small>
                                        <small>Priority: {getPriority(assignment)} · Status: {status.replace(/_/g, " ")}</small>
                                        <div style={{ height: 8, background: "#e8eee9", borderRadius: 8, overflow: "hidden", marginTop: 8, maxWidth: 420 }}>
                                            <div style={{ height: "100%", width: `${progress}%`, background: progress === 100 ? "#25845a" : progress > 0 ? "#d69a32" : "#9aa8a0", borderRadius: 8, transition: "width 180ms ease" }} />
                                        </div>
                                        <small>{progress}% progress{inspection?.updated_at ? ` · Last updated: ${new Date(inspection.updated_at).toLocaleString()}` : " · Waiting for staff to start"}</small>
                                        {inspection?.review_remarks && <small>Latest review: {inspection.review_remarks}</small>}
                                    </div>
                                    <span className={`user-role ${status === "approved" ? "active" : status === "rejected" ? "inactive" : ""}`}>{status.replace(/_/g, " ")}</span>
                                    <div className="button-row user-actions">
                                        <button type="button" className="primary" onClick={() => void viewAssignment(assignment, "Inspection Management")}>
                                            {status === "submitted" ? "Review" : "View Details"}
                                        </button>
                                    </div>
                                </div>
                            ))
                    )}
                    <p className="muted">All assigned work is listed, including inspections not started yet. Progress is updated from the server inspection record after Field Staff sync their work. Submitted inspections can be approved, returned for correction or rejected. Approved inspections can be sent for a revisit.</p>
                </section>
            )}

            {/* ASSIGNMENTS */}
            {(activePage === "Assignments" ||
                activePage === "My Assignments") && (
                    <>
                        {user.role === "admin_supervisor" && (
                            <section className="panel">
                                <h2>Create New Assignment</h2>

                                <form className="inline-form" onSubmit={createAssignment}>
                                    <input
                                        value={newTitle}
                                        onChange={e => setNewTitle(e.target.value)}
                                        placeholder="Inspection title"
                                        required
                                    />

                                    <input
                                        value={newLocation}
                                        onChange={e => setNewLocation(e.target.value)}
                                        placeholder="Location"
                                        required
                                    />

                                    <input
                                        type="date"
                                        value={newDate}
                                        onChange={e => setNewDate(e.target.value)}
                                        required
                                    />

                                    <select
                                        value={assignee}
                                        onChange={e => setAssignee(e.target.value)}
                                        required
                                    >
                                        <option value="">Select Field Staff</option>

                                        {users
                                            .filter(u => u.role === "field_staff")
                                            .map(u => (
                                                <option key={u.id} value={u.id}>
                                                    {u.full_name}
                                                </option>
                                            ))}
                                    </select>
                                    <select value={newPriority} onChange={e => setNewPriority(e.target.value)}>
                                        <option value="high">High priority</option>
                                        <option value="medium">Medium priority</option>
                                        <option value="low">Low priority</option>
                                    </select>
                                    <button className="primary">Assign Work</button>
                                </form>
                            </section>
                        )}

                        <section className="panel">
                            <h2>{user.role === "admin_supervisor" ? "All Assignments" : "My Assignments"}</h2>
                            <div className="inline-form">
                                <select value={assignmentStatusFilter} onChange={e => setAssignmentStatusFilter(e.target.value)} aria-label="Filter by status">
                                    <option value="all">All statuses</option>
                                    <option value="pending">Pending</option>
                                    <option value="assigned">Assigned</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="completed">Completed</option>
                                    <option value="approved">Approved</option>
                                    <option value="revisit_required">Revisit Required</option>
                                </select>
                                <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} aria-label="Filter by priority">
                                    <option value="all">All priorities</option>
                                    <option value="urgent">Urgent</option>
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="normal">Normal</option>
                                    <option value="low">Low</option>
                                </select>
                            </div>
                            {filteredAssignments.length === 0 ? (
                                <p className="muted">No assignments match these filters.</p>
                            ) : (
                                filteredAssignments.map(a => (
                                    <button
                                        className={`assignment ${selected?.id === a.id ? "selected" : ""
                                            }`}
                                        key={a.id}
                                        onClick={() => {
                                            if (user.role === "admin_supervisor") {
                                                void viewAssignment(a);
                                            } else {
                                                void openInspection(a);
                                                setActivePage("Site Inspections");
                                            }
                                        }}
                                    >
                                        <span>
                                            <b>{a.title}</b>
                                            <small>{a.location} · Due: {a.due_date || "Not scheduled"}</small>
                                            <small>Status: {getStatus(a).replace(/_/g, " ")} · Priority: {getPriority(a)}</small>
                                        </span>
                                        <span>{user.role === "admin_supervisor" ? "View →" : "Open →"}</span>
                                    </button>
                                ))
                            )}
                        </section>
                    </>
                )}

            {/* CALENDAR */}
            {activePage === "Calendar" && (
                <>
                    <Calendar
                        assignments={assignments}
                        onDateSelect={date => {
                            setScheduledDate(date);
                            setNewDate(date);
                        }}
                    />

                    {user.role === "admin_supervisor" && (
                        <section className="panel">
                            <h2>Schedule Work for {scheduledDate}</h2>

                            <form className="inline-form" onSubmit={createAssignment}>
                                <input
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    placeholder="Inspection title"
                                    required
                                />

                                <input
                                    value={newLocation}
                                    onChange={e => setNewLocation(e.target.value)}
                                    placeholder="Location"
                                    required
                                />

                                <select
                                    value={assignee}
                                    onChange={e => setAssignee(e.target.value)}
                                    required
                                >
                                    <option value="">Select Field Staff</option>

                                    {users
                                        .filter(u => u.role === "field_staff")
                                        .map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.full_name}
                                            </option>
                                        ))}
                                </select>
                                <select value={newPriority} onChange={e => setNewPriority(e.target.value)}>
                                    <option value="high">High priority</option>
                                    <option value="medium">Medium priority</option>
                                    <option value="low">Low priority</option>
                                </select>
                                <button className="primary">
                                    Schedule Inspection
                                </button>
                            </form>
                        </section>
                    )}
                </>
            )}

            {/* ADMIN ASSIGNMENT DETAILS - VIEW ONLY */}
            {activePage === "Assignment Details" && user.role === "admin_supervisor" && (
                <section className="panel">
                    <div className="user-management-header">
                        <div>
                            <h2>Assignment Details</h2>
                            <p className="muted">View-only details. Inspection editing is available to assigned field staff.</p>
                        </div>
                        <button type="button" className="secondary" onClick={() => setActivePage(inspectionReturnPage)}>{inspectionReturnPage === "Inspection Management" ? "Back to Inspection Management" : "Back to Assignments"}</button>
                    </div>
                    {!selected ? (
                        <p className="muted">Select an assignment from the Assignments page.</p>
                    ) : (
                        <>
                            <div className="content-grid">
                                <div><b>Inspection title</b><p>{selected.title}</p></div>
                                <div><b>Location</b><p>{selected.location}</p></div>
                                <div><b>Assigned to</b><p>{selected.assignee_name || `Staff ID: ${selected.assignee_id}`}</p></div>
                                <div><b>Priority</b><p>{getPriority(selected)}</p></div>
                                <div><b>Due date</b><p>{selected.due_date || "Not scheduled"}</p></div>
                                <div><b>Assignment status</b><p>{getStatus(selected).replace(/_/g, " ")}</p></div>
                                <div><b>Instructions</b><p>{selected.instructions || "No instructions provided."}</p></div>
                            </div>

                            <div className="divider" />
                            <h3>Inspection Review</h3>
                            {!adminInspection ? (
                                <div className="panel">
                                    <h4>Inspection not started or not synced yet</h4>
                                    <p className="muted">This assignment is already visible in Inspection Management. Once Field Staff save and sync their inspection, its checklist, remarks and evidence will appear here. There is nothing to approve until the inspection is submitted.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="content-grid">
                                        <div><b>Inspection status</b><p>{String(adminInspection.status || "unknown").replace(/_/g, " ")}</p></div>
                                        {adminInspection.submitted_at && <div><b>Submitted at</b><p>{new Date(adminInspection.submitted_at).toLocaleString()}</p></div>}
                                        {adminInspection.reviewed_at && <div><b>Last reviewed at</b><p>{new Date(adminInspection.reviewed_at).toLocaleString()}</p></div>}
                                    </div>
                                    <p><b>Staff remarks:</b> {adminInspection.remarks || "No remarks provided."}</p>
                                    <h4>Checklist Answers</h4>
                                    {Object.entries(adminInspection.answers || {}).length === 0 ? (
                                        <p className="muted">No checklist answers recorded.</p>
                                    ) : (
                                        <div className="content-grid">
                                            {Object.entries(adminInspection.answers || {}).map(([key, value]) => (
                                                <div key={key}><b>{key.replace(/_/g, " ")}</b><p>{String(value)}</p></div>
                                            ))}
                                        </div>
                                    )}
                                    <h4>Uploaded Evidence</h4>
                                    {!adminInspection.photos?.length ? (
                                        <p className="muted">No uploaded photos found.</p>
                                    ) : (
                                        adminInspection.photos.map((photo: any) => (
                                            <p key={photo.id}>📷 {photo.filename} · {photo.content_type} · {Math.round((photo.size_bytes || 0) / 1024)} KB</p>
                                        ))
                                    )}
                                    {adminInspection.review_remarks && (
                                        <p><b>Latest review remarks:</b> {adminInspection.review_remarks}</p>
                                    )}

                                    {adminInspection.status === "submitted" && (
                                        <div className="panel">
                                            <h4>Admin decision required</h4>
                                            <p className="muted">Review the checklist answers, staff remarks and uploaded evidence before making a decision. Approval closes this review. Request Correction sends the inspection back to Field Staff with your instructions. Reject records the inspection as rejected.</p>
                                            <div className="button-row">
                                                <button className="primary" disabled={reviewBusy} onClick={() => void reviewInspection("approved")}>{reviewBusy ? "Saving..." : "Approve Inspection"}</button>
                                                <button className="secondary" disabled={reviewBusy} onClick={() => void reviewInspection("request_correction")}>Request Correction</button>
                                                <button className="secondary" disabled={reviewBusy} onClick={() => void reviewInspection("rejected")}>Reject Inspection</button>
                                            </div>
                                        </div>
                                    )}

                                    {adminInspection.status === "approved" && (
                                        <div className="panel">
                                            <h4>Inspection approved</h4>
                                            <p className="muted">Admin has approved this inspection. A revisit is optional and should only be requested when another site visit or fresh evidence is genuinely required.</p>
                                            <div className="button-row">
                                                <button className="secondary" disabled={reviewBusy} onClick={() => void requestRevisit()}>
                                                    {reviewBusy ? "Processing..." : "Request Revisit"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {adminInspection.status === "revisit_required" && (
                                        <div className="panel">
                                            <h4>Revisit requested</h4>
                                            <p className="message">The assigned Field Staff member must revisit the site, update the inspection and submit it again for Admin review.</p>
                                        </div>
                                    )}
                                    {adminInspection.status === "in_progress" && adminInspection.review_remarks && (
                                        <p className="message">Correction requested. Field Staff can update the inspection and submit it again for review.</p>
                                    )}
                                    {adminInspection.status === "rejected" && (
                                        <p className="message">This inspection has been rejected. Review remarks explain the reason.</p>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </section>
            )}

            {/* SITE INSPECTIONS */}
            {activePage === "Site Inspections" && (
                <section className="content-grid">
                    <div className="panel">
                        <h2>Available Inspections</h2>

                        {assignments.map(a => (
                            <button
                                className="assignment"
                                key={a.id}
                                onClick={() => void openInspection(a)}
                            >
                                <span>
                                    <b>{a.title}</b>
                                    <small>{a.location}</small>
                                </span>
                                <span>→</span>
                            </button>
                        ))}
                    </div>

                    <div className="panel">
                        <h2>Inspection Workspace</h2>

                        {!selected ? (
                            <p className="muted">
                                Select an assignment to start inspection.
                            </p>
                        ) : (
                            <>
                                <h3>{selected.title}</h3>
                                <p>{selected.location}</p>
                                <p>Status: <strong>{getStatus(selected).replace(/_/g, " ")}</strong>
                                    {" · "}Priority: <strong>{getPriority(selected)}</strong>
                                </p>
                                {selected.due_date && selected.due_date < new Date().toLocaleDateString("en-CA") &&
                                    !["completed", "approved"].includes(getStatus(selected)) && (
                                        <p className="message">This assignment is overdue.</p>
                                    )}

                                <label>
                                    Site condition
                                    <input
                                        value={answers.site_condition || ""}
                                        onChange={e =>
                                            setAnswers({
                                                ...answers,
                                                site_condition: e.target.value
                                            })
                                        }
                                        placeholder="Good / Needs attention"
                                    />
                                </label>

                                <label>
                                    Safety compliant?
                                    <select
                                        value={answers.safety || ""}
                                        onChange={e =>
                                            setAnswers({
                                                ...answers,
                                                safety: e.target.value
                                            })
                                        }
                                    >
                                        <option value="">Choose</option>
                                        <option>Yes</option>
                                        <option>No</option>
                                        <option>Not applicable</option>
                                    </select>
                                </label>

                                <label>
                                    Remarks
                                    <textarea
                                        rows={4}
                                        value={remarks}
                                        onChange={e => setRemarks(e.target.value)}
                                    />
                                </label>

                                <label className="photo-upload-label">
                                    Upload inspection photo
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        capture="environment"
                                        onChange={capturePhoto}
                                    />
                                </label>

                                <div className="inspection-photo-list">
                                    <h4>Attached Photos ({inspectionPhotos.length})</h4>
                                    {inspectionPhotos.length === 0 ? (
                                        <p className="muted">No photos attached yet.</p>
                                    ) : (
                                        inspectionPhotos.map(photo => (
                                            <div className="inspection-photo-item" key={photo.localId}>
                                                <span className="inspection-photo-name" title={photo.name}>
                                                    🖼️ {photo.name}
                                                </span>
                                                <span className={`photo-upload-status ${photo.uploaded ? "uploaded" : "waiting"}`}>
                                                    {photo.uploaded ? "Uploaded" : "Waiting to sync"}
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>

                                <div className="button-row">
                                    <button
                                        type="button"
                                        className="secondary"
                                        onClick={() => void saveLocal()}
                                    >
                                        Save Offline
                                    </button>
                                    <button
                                        type="button"
                                        className="primary"
                                        onClick={() => void submitInspection()}
                                        disabled={submittingInspection || syncing || ["submitted", "approved"].includes(getStatus(selected))}
                                    >
                                        {submittingInspection ? "Submitting..." : "Submit Inspection"}
                                    </button>

                                    <span className="muted">
                                        {syncing ? "Automatically syncing..." : online
                                            ? "Auto-sync enabled"
                                            : "Offline — saved data will sync when connection returns"}
                                    </span>
                                </div>
                                <p className="muted">Submitting sends your checklist, remarks and photos to Admin for review. If offline, submission is queued until synchronization completes.</p>
                            </>
                        )}
                    </div>
                </section>
            )}

            {/* SYNC MANAGEMENT */}
            {activePage === "Sync Management" && (
                <section className="panel">
                    <h2>Sync Management</h2>
                    <p>Pending operations: {pending}</p>
                    <p>Connection: {online ? "Online" : "Offline"}</p>

                    <p className="muted">
                        {syncing ? "Automatically syncing..." : online
                            ? "Auto-sync is enabled. Pending work will upload automatically."
                            : "Offline. Pending work is safely stored on this device."}
                    </p>
                </section>
            )}

            {/* OFFLINE RECORDS */}
            {activePage === "Offline Records" && (
                <section className="panel">
                    <h2>Offline Records</h2>
                    <p>Pending local records: {pending}</p>
                    <p>Your locally saved drafts remain on this device.</p>
                </section>
            )}

            {/* INSPECTION PHOTOS */}
            {activePage === "Inspection Photos" && (
                <section className="panel">
                    <h2>Inspection Photos</h2>
                    <p>
                        Photos are saved locally and uploaded during inspection sync.
                    </p>
                </section>
            )}

            {/* REPORTS */}
            {activePage === "Reports & Analytics" && (
                <section className="panel">
                    <h2>Reports & Analytics</h2>
                    <p>Total assignments: {assignments.length}</p>
                    <p>
                        Completed:{" "}
                        {assignments.filter(a => ["submitted", "completed", "approved"].includes(getStatus(a))).length}
                    </p>
                </section>
            )}

            {/* SETTINGS */}
            {activePage === "Settings" && (
                <section className="panel">
                    <h2>Settings</h2>
                    <p>User: {user.full_name}</p>
                    <p>Role: {user.role}</p>
                    <p>Connection: {online ? "Online" : "Offline"}</p>
                </section>
            )}
        </DashboardLayout>
    );
}
