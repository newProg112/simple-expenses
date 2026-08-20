import {createRequire} from "node:module";
import {describe, expect, it} from "vitest";

const require=createRequire(import.meta.url);
const {
  BACKFILL_VERSION,CONFLICT_SOURCE_ID,MIGRATION_COLLECTION,createLegacyReferenceBackfillService
}=require("../functions/lib/legacy-reference-backfill-service.js");
const {createSourceEditService}=require("../functions/lib/source-edit-service.js");
const {editStateProjection}=require("../functions/lib/source-edit-state.js");
const {referenceRegistryKey}=require("../functions/lib/reference-registry-key.js");
const {assertEmulatorOnly}=require("../scripts/backfill-legacy-reference-registry.cjs");

const REQUEST_ID="123e4567-e89b-42d3-a456-426614174000";
const clone=value=>value===undefined?undefined:structuredClone(value);

class Ref{
  constructor(db,path){this.db=db;this.path=path;}
  collection(name){return new Collection(this.db,`${this.path}/${name}`);}
  get(){return Promise.resolve(this.db.snapshot(this));}
  set(data){this.db.writeCount+=1;this.db.documents.set(this.path,clone(data));return Promise.resolve();}
}
class Collection{
  constructor(db,path){this.db=db;this.path=path;}
  doc(id){return new Ref(this.db,`${this.path}/${id}`);}
  get(){return Promise.resolve(this.db.collectionSnapshot(this));}
}
class MemoryFirestore{
  constructor(entries=[]){this.documents=new Map(entries.map(([path,data])=>[path,clone(data)]));this.queue=Promise.resolve();this.writeCount=0;}
  collection(name){return new Collection(this,name);}
  snapshot(ref){return {exists:this.documents.has(ref.path),id:ref.path.split("/").at(-1),ref,data:()=>clone(this.documents.get(ref.path))};}
  collectionSnapshot(collection){const prefix=`${collection.path}/`;return {docs:[...this.documents].filter(([path])=>path.startsWith(prefix)&&!path.slice(prefix.length).includes("/")).map(([path])=>this.snapshot(new Ref(this,path)))};}
  runTransaction(execute){const run=this.queue.then(async()=>{const staged=[];const transaction={
    get:async ref=>this.snapshot(ref),
    create:(ref,data)=>staged.push({type:"create",ref,data:clone(data)}),
    set:(ref,data)=>staged.push({type:"set",ref,data:clone(data)}),
    update:(ref,data)=>staged.push({type:"update",ref,data:clone(data)})
  };const result=await execute(transaction);const next=new Map([...this.documents].map(([path,data])=>[path,clone(data)]));
    for(const operation of staged){if(operation.type==="create"&&next.has(operation.ref.path))throw new Error("already-exists");if(operation.type==="update"&&!next.has(operation.ref.path))throw new Error("not-found");const before=next.get(operation.ref.path)||{};next.set(operation.ref.path,operation.type==="update"?{...before,...operation.data}:operation.data);this.writeCount+=1;}this.documents=next;return result;});this.queue=run.catch(()=>{});return run;}
  read(path){return clone(this.documents.get(path));}
  paths(prefix){return [...this.documents.keys()].filter(path=>path.startsWith(prefix));}
}

function invoice(reference="INV-001",overrides={}){return {
  invoiceNo:reference,client:"Customer",clientEmail:"customer@example.test",clientAddress:"1 Road",
  paymentTerms:"14 days",dueDate:"2026-09-03",amount:100,vat:20,total:120,
  items:[{description:"Services",amount:100}],status:"Unpaid",date:"20/08/2026",
  recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",
  projectId:"",projectName:"",projectReference:"",createdAt:"2026-08-20T10:00:00.000Z",...overrides
};}
function bill(reference="BILL-001",overrides={}){return {
  supplier:"Supplier",billNumber:reference,billDate:"2026-08-20",dueDate:"2026-09-03",
  category:"Utilities",net:100,vatRate:0.2,vat:20,total:120,status:"Unpaid",notes:"",
  projectId:"",projectName:"",projectReference:"",attachmentName:"",attachmentUrl:"",
  attachmentPath:"",attachmentSize:0,attachmentType:"",createdAt:"2026-08-20T10:00:00.000Z",...overrides
};}
function fixture(entries=[]){const firestore=new MemoryFirestore(entries);let stamp=0;const serverTimestamp=()=>`server-${++stamp}`;return {
  firestore,backfill:createLegacyReferenceBackfillService({firestore,serverTimestamp}),
  edit:createSourceEditService({firestore,serverTimestamp,now:()=>`2026-08-20T12:00:0${++stamp}.000Z`})
};}
async function keyPath(uid,type,reference){const key=await referenceRegistryKey(type,reference);return `users/${uid}/referenceKeys/${key.registryDocumentId}`;}
function invoiceEdit(source,reference){const {status:_status,createdAt:_createdAt,updatedAt:_updatedAt,...payload}=source;return {...payload,invoiceNo:reference,businessName:"",businessEmail:"",businessWebsite:"",businessVat:""};}
function billEdit(source,reference){const {id:_id,createdAt:_createdAt,updatedAt:_updatedAt,paidAt:_paidAt,bankSettlement:_bankSettlement,...payload}=source;return {...payload,billNumber:reference};}

describe("legacy reference registry backfill",()=>{
  it("refuses executable use without an explicit local Firestore emulator",()=>{
    const options={projectId:"demo-simple-books",uid:"user-1"};
    expect(()=>assertEmulatorOnly(options,{})).toThrow("FIRESTORE_EMULATOR_HOST");
    expect(()=>assertEmulatorOnly(options,{FIRESTORE_EMULATOR_HOST:"firestore.googleapis.com:443"})).toThrow("localhost");
    expect(()=>assertEmulatorOnly(options,{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"})).not.toThrow();
  });
  it.each([
    ["invoice","invoices","legacy-invoice",invoice("INV-001"),"INV-001"],
    ["bill","bills","legacy-bill",bill("BILL-001"),"BILL-001"]
  ])("creates one active claim for a unique %s reference",async(type,collection,sourceId,source,reference)=>{
    const context=fixture([[`users/user-1/${collection}/${sourceId}`,source]]);
    const result=await context.backfill({uid:"user-1",dryRun:false});
    expect(result.summary).toMatchObject({scanned:1,activeClaimCreated:1,cutoverReady:true,status:"complete"});
    expect(context.firestore.read(await keyPath("user-1",type,reference))).toMatchObject({schemaVersion:1,recordType:type,sourceId,state:"active"});
  });

  it("skips blank Invoice and Bill references without claims",async()=>{
    const context=fixture([["users/user-1/invoices/invoice-blank",invoice("")],["users/user-1/bills/bill-blank",bill("")]]);
    const result=await context.backfill({uid:"user-1",dryRun:false});
    expect(result.summary).toMatchObject({scanned:2,blankSkipped:2,activeClaimCreated:0,cutoverReady:true});
    expect(context.firestore.paths("users/user-1/referenceKeys/")).toHaveLength(0);
  });

  it("creates a deterministic legacy-conflict without choosing a winner",async()=>{
    const context=fixture([
      ["users/user-1/invoices/z-source",invoice("INV-001")],
      ["users/user-1/invoices/a-source",invoice("inv 001")],
      ["users/user-1/invoices/m-source",invoice("INV/001")]
    ]);
    const result=await context.backfill({uid:"user-1",dryRun:false});
    const stored=context.firestore.read(await keyPath("user-1","invoice","INV-001"));
    expect(stored).toMatchObject({state:"legacy-conflict",sourceId:CONFLICT_SOURCE_ID,conflictCount:3,conflictingSourceIds:["a-source","m-source","z-source"]});
    expect(result.summary).toMatchObject({legacyConflictCreated:1,collisionGroups:1,cutoverReady:false,status:"incomplete"});
  });

  it("preserves separate Invoice and Bill reference namespaces",async()=>{
    const context=fixture([["users/user-1/invoices/invoice-1",invoice("SHARED-001")],["users/user-1/bills/bill-1",bill("shared001")]]);
    const result=await context.backfill({uid:"user-1",dryRun:false});
    expect(result.summary).toMatchObject({activeClaimCreated:2,collisionGroups:0,cutoverReady:true});
    expect(await keyPath("user-1","invoice","SHARED-001")).not.toBe(await keyPath("user-1","bill","SHARED-001"));
  });

  it("verifies a correct active claim and reruns without timestamp churn",async()=>{
    const path=await keyPath("user-1","invoice","INV-001");const existing={schemaVersion:1,recordType:"invoice",canonicalReference:"inv001",sourceId:"invoice-1",state:"active",claimedAt:"historical",retiredAt:null,claimRequestId:"historical-request"};
    const context=fixture([["users/user-1/invoices/invoice-1",invoice("INV-001")],[path,existing]]);
    const first=await context.backfill({uid:"user-1",dryRun:false});const afterFirst=context.firestore.read(path);
    const firstMetadata=context.firestore.read(`users/user-1/${MIGRATION_COLLECTION}/${BACKFILL_VERSION}`);
    const second=await context.backfill({uid:"user-1",dryRun:false});
    expect(first.summary.activeClaimAlreadyValid).toBe(1);expect(second.summary.activeClaimAlreadyValid).toBe(1);
    expect(afterFirst).toEqual(existing);expect(context.firestore.read(path)).toEqual(existing);
    expect(context.firestore.read(`users/user-1/${MIGRATION_COLLECTION}/${BACKFILL_VERSION}`).completedAt).toBe(firstMetadata.completedAt);
  });

  it.each([
    ["active","wrong-source"],["retired","invoice-1"]
  ])("fails closed for an existing %s claim incompatible with a live source",async(state,sourceId)=>{
    const path=await keyPath("user-1","invoice","INV-001");const context=fixture([
      ["users/user-1/invoices/invoice-1",invoice("INV-001")],
      [path,{schemaVersion:1,recordType:"invoice",canonicalReference:"inv001",sourceId,state,claimedAt:"historical"}]
    ]);
    const before=context.firestore.read(path);const result=await context.backfill({uid:"user-1",dryRun:false});
    expect(result.summary).toMatchObject({incompatibleExistingRegistry:1,cutoverReady:false,status:"incomplete"});
    expect(context.firestore.read(path)).toEqual(before);
  });

  it("verifies an exact existing legacy-conflict safely",async()=>{
    const path=await keyPath("user-1","invoice","INV-001");const conflict={schemaVersion:1,recordType:"invoice",canonicalReference:"inv001",sourceId:CONFLICT_SOURCE_ID,state:"legacy-conflict",conflictingSourceIds:["invoice-1","invoice-2"],conflictCount:2,conflictDetectedAt:"historical"};
    const context=fixture([["users/user-1/invoices/invoice-2",invoice("inv001")],["users/user-1/invoices/invoice-1",invoice("INV-001")],[path,conflict]]);
    const result=await context.backfill({uid:"user-1",dryRun:false});
    expect(result.summary).toMatchObject({legacyConflictAlreadyValid:1,cutoverReady:false});expect(context.firestore.read(path)).toEqual(conflict);
  });

  it.each([
    ["legacy-alpha-document","legacy-payload-id"],
    ["1787211129743",1787211129743],
    ["legacy-missing-id",undefined]
  ])("uses authoritative Bill document ID %s independently of persisted id",async(sourceId,persistedId)=>{
    const source=bill("BILL-001");if(persistedId!==undefined)source.id=persistedId;
    const context=fixture([[`users/user-1/bills/${sourceId}`,source]]);await context.backfill({uid:"user-1",dryRun:false});
    expect(context.firestore.read(await keyPath("user-1","bill","BILL-001")).sourceId).toBe(sourceId);
  });

  it("never reads or writes another UID",async()=>{
    const context=fixture([["users/user-1/invoices/one",invoice("INV-ONE")],["users/user-2/invoices/two",invoice("INV-TWO")]]);
    const result=await context.backfill({uid:"user-1",dryRun:false});
    expect(result.summary.scanned).toBe(1);expect(context.firestore.read(await keyPath("user-2","invoice","INV-TWO"))).toBeUndefined();
  });

  it("performs zero writes in dry-run and reports intended actions",async()=>{
    const context=fixture([["users/user-1/invoices/one",invoice("INV-ONE")]]);const before=context.firestore.writeCount;
    const result=await context.backfill({uid:"user-1",dryRun:true});
    expect(result.summary).toMatchObject({mode:"dry-run",activeClaimWouldCreate:1,activeClaimCreated:0});
    expect(context.firestore.writeCount).toBe(before);expect(context.firestore.paths("users/user-1/referenceKeys/")).toHaveLength(0);
    expect(context.firestore.read(`users/user-1/${MIGRATION_COLLECTION}/${BACKFILL_VERSION}`)).toBeUndefined();
  });

  it.each([
    ["invoice","invoices","legacy-invoice",invoice("INV-OLD"),"INV-OLD","INV-NEW"],
    ["bill","bills","legacy-bill-alpha",bill("BILL-OLD",{id:"persisted-legacy"}),"BILL-OLD","BILL-NEW"]
  ])("unblocks Phase 3C.3B %s edit and preserves normal claim lifecycle",async(type,collection,sourceId,source,oldReference,newReference)=>{
    const context=fixture([[`users/user-1/${collection}/${sourceId}`,source]]);const before=clone(source);
    const input={uid:"user-1",recordType:type,sourceId,requestId:REQUEST_ID,expectedState:editStateProjection(type,before),payload:type==="invoice"?invoiceEdit(before,newReference):billEdit(before,newReference)};
    await expect(context.edit(input)).rejects.toMatchObject({code:"source-reference-unclaimed"});
    expect((await context.backfill({uid:"user-1",dryRun:false})).summary.cutoverReady).toBe(true);
    expect((await context.edit(input)).status).toBe("updated");
    expect(context.firestore.read(await keyPath("user-1",type,oldReference))).toMatchObject({state:"retired",sourceId});
    expect(context.firestore.read(await keyPath("user-1",type,newReference))).toMatchObject({state:"active",sourceId});
  });
});
