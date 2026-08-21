import {describe,expect,it} from "vitest";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {createSourceWithReferenceService}=require("../functions/lib/source-create-service.js");
const {createSourceEditService}=require("../functions/lib/source-edit-service.js");
const {createSourceDeleteService}=require("../functions/lib/source-delete-service.js");
const {createSourceDeleteHandlers}=require("../functions/lib/source-delete-handlers.js");
const {editStateProjection}=require("../functions/lib/source-edit-state.js");
const {referenceRegistryKey}=require("../functions/lib/reference-registry-key.js");

const REQUEST_A="123e4567-e89b-42d3-a456-426614174000";
const REQUEST_B="223e4567-e89b-42d3-a456-426614174001";
const REQUEST_C="323e4567-e89b-42d3-a456-426614174002";
const clone=value=>value===undefined?undefined:structuredClone(value);

class Ref{constructor(db,path){this.db=db;this.path=path;}collection(name){return new Collection(this.db,`${this.path}/${name}`);}}
class Collection{constructor(db,path){this.db=db;this.path=path;}doc(id){return new Ref(this.db,`${this.path}/${id}`);}}
class MemoryFirestore{
  constructor(){this.documents=new Map();this.queue=Promise.resolve();this.failNextCommit=false;}
  collection(name){return new Collection(this,name);}
  snapshot(ref){
    if(ref instanceof Collection){const prefix=`${ref.path}/`;return {docs:[...this.documents].filter(([path])=>path.startsWith(prefix)&&!path.slice(prefix.length).includes("/")).map(([path,data])=>({id:path.slice(prefix.length),data:()=>clone(data)}))};}
    return {exists:this.documents.has(ref.path),data:()=>clone(this.documents.get(ref.path))};
  }
  runTransaction(execute){
    const run=this.queue.then(async()=>{const writes=[];const tx={
      get:async ref=>this.snapshot(ref),create:(ref,data)=>writes.push({op:"create",path:ref.path,data:clone(data)}),
      set:(ref,data)=>writes.push({op:"set",path:ref.path,data:clone(data)}),
      update:(ref,data)=>writes.push({op:"update",path:ref.path,data:clone(data)}),
      delete:ref=>writes.push({op:"delete",path:ref.path})
    };const result=await execute(tx);if(this.failNextCommit){this.failNextCommit=false;throw new Error("commit-failed");}
      const next=new Map([...this.documents].map(([path,data])=>[path,clone(data)]));
      for(const write of writes){if(write.op==="create"&&next.has(write.path))throw new Error("already-exists");if(write.op==="update"&&!next.has(write.path))throw new Error("not-found");if(write.op==="delete"){next.delete(write.path);continue;}const before=next.get(write.path)||{};next.set(write.path,write.op==="update"?{...before,...write.data}:write.data);}this.documents=next;return result;});
    this.queue=run.catch(()=>{});return run;
  }
  read(path){return clone(this.documents.get(path));}
  paths(prefix){return [...this.documents.keys()].filter(path=>path.startsWith(prefix));}
}

function invoice(overrides={}){return {invoiceNo:"INV-A",client:"Customer",clientEmail:"customer@example.test",clientAddress:"1 Road",paymentTerms:"14 days",dueDate:"2026-09-03",amount:100,vat:20,total:120,items:[{description:"Services",amount:100}],status:"Unpaid",date:"20/08/2026",recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",projectId:"p1",projectName:"Project",projectReference:"P-1",...overrides};}
function invoiceEdit(source,overrides={}){const {status:_status,createdAt:_createdAt,updatedAt:_updatedAt,...base}=source;return {...base,businessName:source.businessName||"",businessEmail:source.businessEmail||"",businessWebsite:source.businessWebsite||"",businessVat:source.businessVat||"",...overrides};}
function bill(overrides={}){return {id:1001,supplier:"Supplier",billNumber:"BILL-A",billDate:"2026-08-20",dueDate:"2026-09-03",category:"Utilities",net:100,vatRate:0.2,vat:20,total:120,status:"Unpaid",notes:"",projectId:"p1",projectName:"Project",projectReference:"P-1",attachmentName:"",attachmentUrl:"",attachmentPath:"",attachmentSize:0,attachmentType:"",...overrides};}
function billEdit(source,overrides={}){const {id:_id,createdAt:_createdAt,updatedAt:_updatedAt,paidAt:_paidAt,bankSettlement:_settlement,...base}=source;return {...base,...overrides};}

const config={invoice:{collection:"invoices",sourceId:"invoice-1",reference:"invoiceNo",payload:invoice,edit:invoiceEdit,journal:"invoice_user-1_invoice-1"},bill:{collection:"bills",sourceId:"1001",reference:"billNumber",payload:bill,edit:billEdit,journal:"bill_user-1_1001"}};
function fixture(){const firestore=new MemoryFirestore();let clock=0;const options={firestore,serverTimestamp:()=>`server-${clock}`,now:()=>`2026-08-21T12:00:0${++clock}.000Z`};return {firestore,create:createSourceWithReferenceService(options),edit:createSourceEditService(options),remove:createSourceDeleteService(options)};}
async function seed(context,type,overrides={}){const c=config[type];const payload=c.payload(overrides);const sourceId=String(payload.id??c.sourceId);await context.create({uid:"user-1",recordType:type,sourceId,requestId:REQUEST_A,payload});return sourceId;}
function deleteInput(context,type,sourceId,requestId=REQUEST_B){const c=config[type];return {uid:"user-1",recordType:type,sourceId,requestId,expectedState:editStateProjection(type,context.firestore.read(`users/user-1/${c.collection}/${sourceId}`))};}

describe.each(["invoice","bill"])("atomic %s delete",type=>{
  it("retires the active claim, removes the source, and intentionally leaves its journal",async()=>{const context=fixture();const c=config[type];const sourceId=await seed(context,type);const key=await referenceRegistryKey(type,c.payload()[c.reference]);const journalBefore=context.firestore.read(`journals/${c.journal}`);const result=await context.remove(deleteInput(context,type,sourceId));
    expect(result).toMatchObject({status:"deleted",sourceId,registryDocumentId:key.registryDocumentId,journalId:c.journal});
    expect(context.firestore.read(`users/user-1/${c.collection}/${sourceId}`)).toBeUndefined();
    expect(context.firestore.read(`users/user-1/referenceKeys/${key.registryDocumentId}`)).toMatchObject({state:"retired",sourceId,retireRequestId:REQUEST_B});
    expect(context.firestore.read(`journals/${c.journal}`)).toEqual(journalBefore);
  });

  it("is exactly idempotent for the same request",async()=>{const context=fixture();const sourceId=await seed(context,type);const input=deleteInput(context,type,sourceId);expect((await context.remove(input)).status).toBe("deleted");expect((await context.remove(input)).status).toBe("already-deleted");expect(context.firestore.paths("users/user-1/referenceDeleteRequests/")).toHaveLength(1);});

  it("rejects request-ID reuse with different delete intent and fails closed on a damaged retry tombstone",async()=>{const context=fixture();const c=config[type];const sourceId=await seed(context,type);const input=deleteInput(context,type,sourceId);await context.remove(input);const different={...input,expectedState:{...input.expectedState,status:"Changed"}};await expect(context.remove(different)).rejects.toMatchObject({code:"idempotency-conflict"});const key=await referenceRegistryKey(type,c.payload()[c.reference]);context.firestore.documents.get(`users/user-1/referenceKeys/${key.registryDocumentId}`).canonicalReference="corrupt";await expect(context.remove(input)).rejects.toMatchObject({code:"delete-integrity-error"});});

  it("rejects settled and legacy matched sources without mutation",async()=>{for(const guard of [{bankSettlement:{transactionId:"bank-1"}},{matched:true}]){const context=fixture();const c=config[type];const sourceId=await seed(context,type);const input=deleteInput(context,type,sourceId);Object.assign(context.firestore.documents.get(`users/user-1/${c.collection}/${sourceId}`),guard);const before=new Map([...context.firestore.documents].map(([path,data])=>[path,clone(data)]));await expect(context.remove(input)).rejects.toMatchObject({code:"bank-settled-source"});expect([...context.firestore.documents]).toEqual([...before]);}});

  it("fails closed for missing, wrongly owned, retired, and malformed claims",async()=>{for(const mode of ["missing","wrong","retired","malformed"]){const context=fixture();const c=config[type];const sourceId=await seed(context,type);const input=deleteInput(context,type,sourceId);const key=await referenceRegistryKey(type,c.payload()[c.reference]);const path=`users/user-1/referenceKeys/${key.registryDocumentId}`;if(mode==="missing")context.firestore.documents.delete(path);else if(mode==="wrong")context.firestore.documents.get(path).sourceId="other";else if(mode==="retired")context.firestore.documents.get(path).state="retired";else context.firestore.documents.get(path).canonicalReference="corrupt";const code=mode==="missing"?"source-reference-unclaimed":mode==="malformed"?"registry-integrity-error":"reference-conflict";await expect(context.remove(input)).rejects.toMatchObject({code});expect(context.firestore.read(`users/user-1/${c.collection}/${sourceId}`)).toBeDefined();}});

  it("rejects stale state and serializes a concurrent edit/delete safely",async()=>{const staleContext=fixture();const c=config[type];const staleId=await seed(staleContext,type);const removeInput=deleteInput(staleContext,type,staleId);staleContext.firestore.documents.get(`users/user-1/${c.collection}/${staleId}`)[type==="invoice"?"amount":"net"]+=1;await expect(staleContext.remove(removeInput)).rejects.toMatchObject({code:"stale-source"});
    const context=fixture();const sourceId=await seed(context,type);const fresh=context.firestore.read(`users/user-1/${c.collection}/${sourceId}`);const expectedState=editStateProjection(type,fresh);const payload=c.edit(fresh,type==="invoice"?{client:"Changed"}:{supplier:"Changed"});const outcomes=await Promise.allSettled([context.edit({uid:"user-1",recordType:type,sourceId,requestId:REQUEST_C,expectedState,payload}),context.remove({uid:"user-1",recordType:type,sourceId,requestId:REQUEST_B,expectedState})]);expect(outcomes.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(outcomes.find(result=>result.status==="rejected").reason).toMatchObject({code:"stale-source"});
  });

  it("rolls back all mutations if commit fails",async()=>{const context=fixture();const sourceId=await seed(context,type);const before=new Map([...context.firestore.documents].map(([path,data])=>[path,clone(data)]));context.firestore.failNextCommit=true;await expect(context.remove(deleteInput(context,type,sourceId))).rejects.toThrow("commit-failed");expect([...context.firestore.documents]).toEqual([...before]);});

  it("leaves a permanent tombstone that blocks later reuse",async()=>{const context=fixture();const c=config[type];const sourceId=await seed(context,type);const reference=c.payload()[c.reference];await context.remove(deleteInput(context,type,sourceId));const replacement=c.payload({[c.reference]:reference,...(type==="bill"?{id:1002}:{})});await expect(context.create({uid:"user-1",recordType:type,sourceId:type==="bill"?"1002":"invoice-2",requestId:REQUEST_C,payload:replacement})).rejects.toMatchObject({code:"retired-reference"});});
});

it("deletes a blank-reference source without creating or requiring a registry claim",async()=>{for(const type of ["invoice","bill"]){const context=fixture();const c=config[type];const sourceId=await seed(context,type,{[c.reference]:""});expect(context.firestore.paths("users/user-1/referenceKeys/")).toHaveLength(0);const result=await context.remove(deleteInput(context,type,sourceId));expect(result.registryDocumentId).toBeNull();expect(context.firestore.paths("users/user-1/referenceKeys/")).toHaveLength(0);}});

describe("delete callable security boundary",()=>{it("requires authentication and rejects forged/unknown fields",async()=>{const handlers=createSourceDeleteHandlers(async input=>input);await expect(handlers.deleteInvoiceWithReference({data:{}})).rejects.toMatchObject({code:"unauthenticated"});await expect(handlers.deleteBillWithReference({auth:{uid:"user-1"},data:{sourceId:"one",expectedState:{},requestId:REQUEST_A,uid:"other"}})).rejects.toMatchObject({code:"invalid-argument"});const accepted=await handlers.deleteInvoiceWithReference({auth:{uid:"user-1"},data:{sourceId:"one",expectedState:{},requestId:REQUEST_A}});expect(accepted).toMatchObject({uid:"user-1",recordType:"invoice"});});});
