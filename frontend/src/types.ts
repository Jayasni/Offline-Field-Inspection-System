export type Role = "admin_supervisor" | "field_staff";
export type User = {id:number;email:string;full_name:string;role:Role};

export type Assignment = {
    id:number;
    title:string;
    location:string;
    instructions:string;
    priority:string;
    due_date:string;
    status:string;
    assignee_id:number;
    assignee_name?:string;
    created_by?:number;
    created_by_name?:string
};
export type InspectionDraft = {id?:number;localId:string;assignmentId:number;staffId:number;status:"draft"|"in_progress"|"submitted";remarks:string;answers:Record<string,string>;baseVersion:number|null;serverId?:number;syncState:"pending"|"synced"|"conflict";updatedAt:number};
