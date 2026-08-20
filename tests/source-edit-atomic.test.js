import {describe,expect,it} from "vitest";
import {createRequire} from "node:module";
import {prepareBillJournal,prepareInvoiceJournal} from "../resources/js/ledger-firestore.js";
import {sourceEditExpectedState} from "../resources/js/source-edit-state.js";
import {readBillRecordWithSettlementGuard} from "../resources/js/bank-settlement-source-state.js";

const require=createRequire(import.meta.url);
const {createSourceWithReferenceService}=require("../functions/lib/source-create-service.js");
const {createSourceEditService}=require("../functions/lib/source-edit-service.js");
const {createSourceEditHandlers}=require("../functions/lib/source-edit-handlers.js");
const {editStateProjection}=require("../functions/lib/source-edit-state.js");
const {referenceRegistryKey}=require("../functions/lib/reference-registry-key.js");

const REQUEST_A="123e4567-e89b-42d3-a456-426614174000";
const REQUEST_B="223e4567-e89b-42d3-a456-426614174001";
const REQUEST_C="323e4567-e89b-42d3-a456-426614174002";
const REQUEST_D="423e4567-e89b-42d3-a456-426614174003";
const clone=value => value === undefined ? undefined : structuredClone(value);

class Ref{constructor(db,path){this.db=db;this.path=path;} collection(name){return new Collection(this.db,`${this.path}/${name}`);}}
class Collection{constructor(db,path){this.db=db;this.path=path;} doc(id){return new Ref(this.db,`${this.path}/${id}`);}}
class MemoryFirestore{
  constructor(entries=[]){this.documents=new Map(entries.map(([path,data])=>[path,clone(data)]));this.queue=Promise.resolve();this.failNextCommit=false;}
  collection(name){return new Collection(this,name);}
  snapshot(ref){
    if(ref instanceof Collection){const prefix=`${ref.path}/`;return {docs:[...this.documents].filter(([path])=>path.startsWith(prefix)&&!path.slice(prefix.length).includes("/")).map(([path,data])=>({id:path.slice(prefix.length),data:()=>clone(data)}))};}
    return {exists:this.documents.has(ref.path),data:()=>clone(this.documents.get(ref.path))};
  }
  runTransaction(execute){
    const run=this.queue.then(async()=>{const staged=[];const tx={
      get:async ref=>this.snapshot(ref),
      create:(ref,data)=>staged.push({operation:"create",path:ref.path,data:clone(data)}),
      set:(ref,data)=>staged.push({operation:"set",path:ref.path,data:clone(data)}),
      update:(ref,data)=>staged.push({operation:"update",path:ref.path,data:clone(data)})
    };const result=await execute(tx);if(this.failNextCommit){this.failNextCommit=false;throw new Error("commit-failed");}
      const next=new Map([...this.documents].map(([path,data])=>[path,clone(data)]));
      for(const write of staged){if(write.operation==="create"&&next.has(write.path))throw new Error("already-exists");if(write.operation==="update"&&!next.has(write.path))throw new Error("not-found");const before=next.get(write.path)||{};next.set(write.path,write.operation==="update"?{...before,...write.data}:write.data);}this.documents=next;return result;});
    this.queue=run.catch(()=>{});return run;
  }
  read(path){return clone(this.documents.get(path));}
  paths(prefix){return [...this.documents.keys()].filter(path=>path.startsWith(prefix));}
}

function invoice(overrides={}){return {
  invoiceNo:"INV-A",client:"Customer",clientEmail:"customer@example.test",clientAddress:"1 Road",
  paymentTerms:"14 days",dueDate:"2026-09-03",amount:100,vat:20,total:120,
  items:[{description:"Services",amount:100}],status:"Unpaid",date:"20/08/2026",
  recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",
  projectId:"p1",projectName:"Project",projectReference:"P-1",...overrides
};}
function invoiceEdit(source,overrides={}){const {status:_status,createdAt:_createdAt,updatedAt:_updatedAt,...base}=source;return {
  ...base,businessName:source.businessName||"",businessEmail:source.businessEmail||"",
  businessWebsite:source.businessWebsite||"",businessVat:source.businessVat||"",...overrides
};}
function bill(overrides={}){return {
  id:1001,supplier:"Supplier",billNumber:"BILL-A",billDate:"2026-08-20",dueDate:"2026-09-03",
  category:"Utilities",net:100,vatRate:0.2,vat:20,total:120,status:"Unpaid",notes:"",
  projectId:"p1",projectName:"Project",projectReference:"P-1",attachmentName:"",attachmentUrl:"",
  attachmentPath:"",attachmentSize:0,attachmentType:"",...overrides
};}
function billEdit(source,overrides={}){const {id:_id,sourceId:_sourceId,createdAt:_createdAt,updatedAt:_updatedAt,paidAt:_paidAt,bankSettlement:_settlement,...base}=source;return {...base,...overrides};}

function fixture(){
  const firestore=new MemoryFirestore();let clock=0;
  const now=()=>`2026-08-20T12:00:0${++clock}.000Z`;
  const options={firestore,serverTimestamp:()=>`server-${clock}`,now};
  return {firestore,create:createSourceWithReferenceService(options),edit:createSourceEditService(options)};
}
const config={
  invoice:{sourceId:"invoice-1",collection:"invoices",reference:"invoiceNo",value:"INV-B",create:invoice,edit:invoiceEdit,journalPrefix:"invoice"},
  bill:{sourceId:"1001",collection:"bills",reference:"billNumber",value:"BILL-B",create:bill,edit:billEdit,journalPrefix:"bill"}
};
async function seed(context,type,overrides={}){
  const c=config[type];const payload=c.create(overrides);
  await context.create({uid:"user-1",recordType:type,sourceId:String(payload.id??c.sourceId),requestId:type==="invoice"?REQUEST_A:REQUEST_C,payload});
  return String(payload.id??c.sourceId);
}
function editInput(context,type,sourceId,overrides={},request=REQUEST_B){
  const c=config[type];const path=`users/user-1/${c.collection}/${sourceId}`;const source=context.firestore.read(path);
  return {uid:"user-1",recordType:type,sourceId,requestId:request,expectedState:editStateProjection(type,source),payload:c.edit(source,overrides)};
}

describe.each(["invoice","bill"])("atomic %s edit",type=>{
  it("moves A to free B and atomically retires/activates registry keys",async()=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];
    const oldKey=await referenceRegistryKey(type,c.create()[c.reference]);const newKey=await referenceRegistryKey(type,c.value);
    const result=await context.edit(editInput(context,type,sourceId,{[c.reference]:c.value}));
    expect(result.status).toBe("updated");
    expect(context.firestore.read(`users/user-1/${c.collection}/${sourceId}`)[c.reference]).toBe(c.value);
    expect(context.firestore.read(`users/user-1/referenceKeys/${oldKey.registryDocumentId}`)).toMatchObject({state:"retired",sourceId});
    expect(context.firestore.read(`users/user-1/referenceKeys/${newKey.registryDocumentId}`)).toMatchObject({state:"active",sourceId});
    expect(context.firestore.paths(`journals/${c.journalPrefix}_user-1_`)).toHaveLength(1);
  });

  it("does not churn a formatting-equivalent reference",async()=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];const key=await referenceRegistryKey(type,c.create()[c.reference]);
    const before=context.firestore.read(`users/user-1/referenceKeys/${key.registryDocumentId}`);
    await context.edit(editInput(context,type,sourceId,{[c.reference]:type==="invoice"?"inv / a":"bill / a"}));
    expect(context.firestore.read(`users/user-1/referenceKeys/${key.registryDocumentId}`)).toEqual(before);
  });

  it("supports A to blank and blank to B",async()=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];const old=await referenceRegistryKey(type,c.create()[c.reference]);
    await context.edit(editInput(context,type,sourceId,{[c.reference]:""}));
    expect(context.firestore.read(`users/user-1/referenceKeys/${old.registryDocumentId}`).state).toBe("retired");
    const input=editInput(context,type,sourceId,{[c.reference]:c.value},REQUEST_C);
    const next=await referenceRegistryKey(type,c.value);await context.edit(input);
    expect(context.firestore.read(`users/user-1/referenceKeys/${next.registryDocumentId}`).state).toBe("active");
  });

  it.each([["retired","retired-reference"],["legacy-conflict","legacy-conflict"]])("rejects a %s destination without changes",async(state,code)=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];const key=await referenceRegistryKey(type,c.value);
    context.firestore.documents.set(`users/user-1/referenceKeys/${key.registryDocumentId}`,{schemaVersion:1,recordType:type,canonicalReference:key.canonicalReference,sourceId:"legacy",state});
    const beforeSource=context.firestore.read(`users/user-1/${c.collection}/${sourceId}`);const beforeJournal=context.firestore.read(`journals/${c.journalPrefix}_user-1_${sourceId}`);
    await expect(context.edit(editInput(context,type,sourceId,{[c.reference]:c.value}))).rejects.toMatchObject({code});
    expect(context.firestore.read(`users/user-1/${c.collection}/${sourceId}`)).toEqual(beforeSource);
    expect(context.firestore.read(`journals/${c.journalPrefix}_user-1_${sourceId}`)).toEqual(beforeJournal);
  });

  it("rejects an occupied destination without changing source, journal, or registry",async()=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];
    const occupied=type==="invoice"?invoice({invoiceNo:c.value}):bill({id:1002,billNumber:c.value});
    await context.create({uid:"user-1",recordType:type,sourceId:String(occupied.id??"invoice-2"),requestId:REQUEST_D,payload:occupied});
    const beforeSource=context.firestore.read(`users/user-1/${c.collection}/${sourceId}`);const beforeJournal=context.firestore.read(`journals/${c.journalPrefix}_user-1_${sourceId}`);
    await expect(context.edit(editInput(context,type,sourceId,{[c.reference]:c.value}))).rejects.toMatchObject({code:"reference-conflict"});
    expect(context.firestore.read(`users/user-1/${c.collection}/${sourceId}`)).toEqual(beforeSource);
    expect(context.firestore.read(`journals/${c.journalPrefix}_user-1_${sourceId}`)).toEqual(beforeJournal);
  });

  it("fails closed for a missing or wrongly owned old claim",async()=>{
    for(const mode of ["missing","wrong-owner"]){const context=fixture();const sourceId=await seed(context,type);const c=config[type];const key=await referenceRegistryKey(type,c.create()[c.reference]);const path=`users/user-1/referenceKeys/${key.registryDocumentId}`;
      if(mode==="missing")context.firestore.documents.delete(path);else context.firestore.documents.get(path).sourceId="other";
      await expect(context.edit(editInput(context,type,sourceId,{[c.reference]:c.value}))).rejects.toMatchObject({code:mode==="missing"?"source-reference-unclaimed":"reference-conflict"});}
  });

  it("rejects stale, settled, and deleted sources",async()=>{
    const c=config[type];
    {const context=fixture();const sourceId=await seed(context,type);const input=editInput(context,type,sourceId,{[c.reference]:c.value});const changed=context.firestore.documents.get(`users/user-1/${c.collection}/${sourceId}`);changed[type==="invoice"?"amount":"net"]+=1;await expect(context.edit(input)).rejects.toMatchObject({code:"stale-source"});}
    {const context=fixture();const sourceId=await seed(context,type);const input=editInput(context,type,sourceId,{[c.reference]:c.value});context.firestore.documents.get(`users/user-1/${c.collection}/${sourceId}`).bankSettlement={transactionId:"bank-1"};await expect(context.edit(input)).rejects.toMatchObject({code:"bank-settled-source"});}
    {const context=fixture();const sourceId=await seed(context,type);const input=editInput(context,type,sourceId,{[c.reference]:c.value});context.firestore.documents.delete(`users/user-1/${c.collection}/${sourceId}`);await expect(context.edit(input)).rejects.toMatchObject({code:"source-not-found"});}
  });

  it("serializes concurrent A to B and A to C",async()=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];const before=context.firestore.read(`users/user-1/${c.collection}/${sourceId}`);const expected=editStateProjection(type,before);
    const base={uid:"user-1",recordType:type,sourceId,expectedState:expected};
    const results=await Promise.allSettled([
      context.edit({...base,requestId:REQUEST_B,payload:c.edit(before,{[c.reference]:c.value})}),
      context.edit({...base,requestId:REQUEST_C,payload:c.edit(before,{[c.reference]:`${c.value}-OTHER`})})
    ]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(results.find(result=>result.status==="rejected").reason).toMatchObject({code:"stale-source"});
  });

  it("updates accounting once and proves exact idempotent retry",async()=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];const overrides=type==="invoice"
      ? {amount:10.01,vat:2,total:12.01,items:[{description:"A",amount:5},{description:"B",amount:5.01}],projectId:"p2",projectName:"Changed",projectReference:"P-2"}
      : {net:83.33,vat:16.67,total:100,category:"Professional fees",projectId:"p2",projectName:"Changed",projectReference:"P-2"};
    const input=editInput(context,type,sourceId,overrides);const first=await context.edit(input);const second=await context.edit(input);
    expect(first.status).toBe("updated");expect(second.status).toBe("already-updated");
    expect(context.firestore.paths(`journals/${c.journalPrefix}_user-1_`)).toHaveLength(1);
    expect(context.firestore.paths("users/user-1/referenceEditRequests/")).toHaveLength(1);
    const source=context.firestore.read(`users/user-1/${c.collection}/${sourceId}`);const journal=context.firestore.read(`journals/${c.journalPrefix}_user-1_${sourceId}`);
    const trusted=type==="invoice"?prepareInvoiceJournal("user-1",sourceId,source,{createdAt:journal.createdAt,updatedAt:journal.updatedAt}):prepareBillJournal("user-1",sourceId,source,{createdAt:journal.createdAt,updatedAt:journal.updatedAt});
    expect(journal).toEqual(trusted);
    await expect(context.edit({...input,payload:c.edit(source,{[c.reference]:c.value})})).rejects.toMatchObject({code:"idempotency-conflict"});
  });

  it("rolls back simulated transaction failure",async()=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];const before=new Map(context.firestore.documents);context.firestore.failNextCommit=true;
    await expect(context.edit(editInput(context,type,sourceId,{[c.reference]:c.value}))).rejects.toThrow("commit-failed");
    expect([...context.firestore.documents]).toEqual([...before]);
  });
});

describe("edit callable security boundary",()=>{
  it("rejects unauthenticated, forged ownership, settlement, and unknown fields",async()=>{
    const handlers=createSourceEditHandlers(async input=>input);
    await expect(handlers.updateInvoiceWithReference({data:{}})).rejects.toMatchObject({code:"unauthenticated"});
    await expect(handlers.updateInvoiceWithReference({auth:{uid:"user-1"},data:{sourceId:"one",requestId:REQUEST_A,payload:{},expectedState:{},uid:"forged"}})).rejects.toMatchObject({code:"invalid-argument"});
    for(const forged of [{bankSettlement:{}},{uid:"other"},{matched:true},{updatedAt:"forged"},{settlementStateFingerprint:"forged"},{registryState:"active"}]){const context=fixture();const sourceId=await seed(context,"invoice");const input=editInput(context,"invoice",sourceId);input.payload={...input.payload,...forged};await expect(context.edit(input)).rejects.toMatchObject({code:"invalid-argument"});}
  });

  it.each(["invoice","bill"])("keeps the browser and server %s expected-state projection identical",async type=>{
    const context=fixture();const sourceId=await seed(context,type);const c=config[type];const source=context.firestore.read(`users/user-1/${c.collection}/${sourceId}`);
    expect(sourceEditExpectedState(type,source)).toEqual(editStateProjection(type,source));
  });

  it("keeps Invoice and Bill registry namespaces separate",async()=>{
    const context=fixture();const invoiceId=await seed(context,"invoice",{invoiceNo:"SHARED-A"});const billId=await seed(context,"bill",{billNumber:"SHARED-A"});
    await context.edit(editInput(context,"invoice",invoiceId,{invoiceNo:"SHARED-B"},REQUEST_C));
    const billKey=await referenceRegistryKey("bill","SHARED-A");expect(context.firestore.read(`users/user-1/referenceKeys/${billKey.registryDocumentId}`).state).toBe("active");
  });

  it.each([
    ["1787211129743",1787211129743],
    ["legacy-alpha-document","legacy-payload-id"],
    ["legacy-missing-id",undefined]
  ])("edits Bill sourceId %s while preserving persisted id %s",async(sourceId,persistedId)=>{
    const context=fixture();const source=bill({billNumber:"EMU-BILL-001"});
    if(persistedId === undefined) delete source.id;else source.id=persistedId;
    source.createdAt="2026-08-20T10:00:00.000Z";
    const oldKey=await referenceRegistryKey("bill",source.billNumber);
    context.firestore.documents.set(`users/user-1/bills/${sourceId}`,clone(source));
    context.firestore.documents.set(`users/user-1/referenceKeys/${oldKey.registryDocumentId}`,{
      schemaVersion:1,recordType:"bill",canonicalReference:oldKey.canonicalReference,
      sourceId,state:"active",claimedAt:"server-old",retiredAt:null,claimRequestId:REQUEST_A
    });
    const guarded=await readBillRecordWithSettlementGuard({
      db:{},userId:"user-1",billId:sourceId,
      services:{
        doc:(_db,...parts)=>({path:parts.join("/")}),
        getDoc:async reference=>context.firestore.snapshot({path:reference.path})
      }
    });
    expect(guarded.sourceId).toBe(sourceId);
    if(persistedId === undefined) expect(guarded).not.toHaveProperty("id");
    else expect(guarded.id).toBe(persistedId);
    const payload=billEdit(guarded,{billNumber:"EMU-BILL-002"});
    expect(payload).not.toHaveProperty("id");
    const input={uid:"user-1",recordType:"bill",sourceId,requestId:REQUEST_B,
      expectedState:sourceEditExpectedState("bill",guarded),payload};
    expect((await context.edit(input)).status).toBe("updated");
    expect((await context.edit(input)).status).toBe("already-updated");
    const stored=context.firestore.read(`users/user-1/bills/${sourceId}`);
    if(persistedId === undefined) expect(stored).not.toHaveProperty("id");
    else expect(stored.id).toBe(persistedId);
    expect(stored.billNumber).toBe("EMU-BILL-002");
    expect(context.firestore.read(`users/user-1/referenceKeys/${oldKey.registryDocumentId}`).state).toBe("retired");
    const newKey=await referenceRegistryKey("bill","EMU-BILL-002");
    expect(context.firestore.read(`users/user-1/referenceKeys/${newKey.registryDocumentId}`)).toMatchObject({state:"active",sourceId});
    expect(context.firestore.read(`journals/bill_user-1_${sourceId}`)).toMatchObject({sourceId,sourceNumber:"EMU-BILL-002"});
  });

  it("rejects a client-supplied Bill id without beginning an edit",async()=>{
    const context=fixture();const sourceId=await seed(context,"bill");const before=new Map(context.firestore.documents);
    const input=editInput(context,"bill",sourceId,{billNumber:"BILL-B"});input.payload.id=9999;
    await expect(context.edit(input)).rejects.toMatchObject({code:"invalid-argument"});
    expect([...context.firestore.documents]).toEqual([...before]);
  });
});
