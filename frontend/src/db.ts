import Dexie,{Table} from "dexie";
import type {Assignment,InspectionDraft} from "./types";
export type OutboxItem={id?:number;operationId:string;staffId:number;assignmentId:number;status:InspectionDraft["status"];remarks:string;answers:Record<string,string>;baseVersion:number|null;createdAt:number;state:"pending"|"conflict"};
export type LocalPhoto={id?:number;localId:string;inspectionLocalId:string;blob:Blob;name:string;type:string;uploaded:boolean};
class LocalDB extends Dexie{
 assignments!:Table<Assignment,number>; drafts!:Table<InspectionDraft,string>; outbox!:Table<OutboxItem,number>; photos!:Table<LocalPhoto,number>;
 constructor(){super("FieldInspectionLocal");
  this.version(1).stores({assignments:"id,assignee_id",drafts:"localId,assignmentId,staffId,syncState",outbox:"++id,operationId,assignmentId,state",photos:"++id,localId,inspectionLocalId,uploaded"});
  this.version(2).stores({assignments:"id,assignee_id",drafts:"localId,assignmentId,staffId,syncState,[staffId+assignmentId]",outbox:"++id,operationId,assignmentId,staffId,state,[staffId+assignmentId]",photos:"++id,localId,inspectionLocalId,uploaded"});
 }
}
export const localDB=new LocalDB();
export async function saveDraft(draft:InspectionDraft){
 await localDB.transaction("rw",localDB.drafts,localDB.outbox,async()=>{
  await localDB.drafts.put(draft);
  if(draft.syncState!=="synced"){
   const existing=await localDB.outbox.where("[staffId+assignmentId]").equals([draft.staffId,draft.assignmentId]).first();
   const item:OutboxItem={operationId:existing?.operationId||crypto.randomUUID(),staffId:draft.staffId,assignmentId:draft.assignmentId,status:draft.status,remarks:draft.remarks,answers:draft.answers,baseVersion:draft.baseVersion,createdAt:Date.now(),state:"pending"};
   if(existing)await localDB.outbox.put({...existing,...item});else await localDB.outbox.add(item);
  }
 });
}
