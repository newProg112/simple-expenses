import {describe, expect, it} from "vitest";
import restoreModule from "../functions/lib/json-backup-restore-service.js";
import handlerModule from "../functions/lib/json-backup-restore-handler.js";
import registryModule from "../functions/lib/reference-registry-key.js";
import {JSON_BACKUP_COLLECTIONS, createJsonBackupV2} from "../resources/js/json-backup-schema.js";

const {createJsonBackupRestoreService, inspectDestination, verifyRestore} = restoreModule;
const {createJsonBackupRestoreHandler} = handlerModule;
const {referenceRegistryKey} = registryModule;
const UID = "destination-user";
const JOB = "123e4567-e89b-42d3-a456-426614174000";

class FakeTimestamp {
  constructor(seconds, nanoseconds){ this.seconds=seconds; this.nanoseconds=nanoseconds; }
  toDate(){ return new Date(this.seconds*1000+this.nanoseconds/1e6); }
  toMillis(){ return this.seconds*1000+this.nanoseconds/1e6; }
}
const clone=value=>value===undefined?undefined:structuredClone(value);
class Ref {
  constructor(db,path){this.db=db;this.path=path;}
  collection(name){return new Query(this.db,`${this.path}/${name}`);}
  get(){return Promise.resolve(this.db.documentSnapshot(this.path));}
  set(data,options){this.db.set(this.path,data,options);return Promise.resolve();}
}
class Query {
  constructor(db,path,filters=[],maximum=null){this.db=db;this.path=path;this.filters=filters;this.maximum=maximum;}
  doc(id){return new Ref(this.db,`${this.path}/${id}`);}
  where(field,operator,value){return new Query(this.db,this.path,[...this.filters,[field,operator,value]],this.maximum);}
  limit(maximum){return new Query(this.db,this.path,this.filters,maximum);}
  get(){return Promise.resolve(this.db.querySnapshot(this));}
}
class MemoryFirestore {
  constructor(entries=[]){this.documents=new Map(entries.map(([path,data])=>[path,clone(data)]));this.commitCount=0;this.failCommitNumber=0;}
  collection(name){return new Query(this,name);}
  documentSnapshot(path){return {exists:this.documents.has(path),id:path.split("/").at(-1),data:()=>clone(this.documents.get(path))};}
  querySnapshot(query){
    const prefix=`${query.path}/`;
    let docs=[...this.documents.entries()].filter(([path])=>path.startsWith(prefix)&&!path.slice(prefix.length).includes("/"));
    for(const [field,operator,value] of query.filters){if(operator!=="==")throw new Error("unsupported-query");docs=docs.filter(([,data])=>data?.[field]===value);}
    if(query.maximum!==null)docs=docs.slice(0,query.maximum);
    const snapshots=docs.map(([path])=>this.documentSnapshot(path));
    return {docs:snapshots,empty:snapshots.length===0,size:snapshots.length,forEach:callback=>snapshots.forEach(callback)};
  }
  set(path,data,options={}){const next=clone(data);this.documents.set(path,options.merge?{...(this.documents.get(path)||{}),...next}:next);}
  batch(){
    const writes=[];
    return {set:(ref,data,options)=>writes.push([ref.path,data,options]),commit:async()=>{this.commitCount++;if(this.failCommitNumber===this.commitCount)throw new Error("injected-batch-failure");for(const write of writes)this.set(...write);}};
  }
  async runTransaction(execute){
    const writes=[];
    const transaction={get:ref=>ref.get(),set:(ref,data,options)=>writes.push([ref.path,data,options])};
    const result=await execute(transaction);for(const write of writes)this.set(...write);return result;
  }
  read(path){return clone(this.documents.get(path));}
  remove(path){this.documents.delete(path);}
}

function representativeBackup(overrides={}){
  const timestamp=new FakeTimestamp(100,200);
  return createJsonBackupV2({
    exportedAt:"2026-08-28T12:00:00.000Z",
    account:{businessName:"Restored Books",paymentTermsDefault:"14 days",uid:"old-user",currentPlan:"Pro"},
    collections:{
      clients:[{id:"client-1",data:{name:"Client",attachmentName:"contract.pdf",attachmentUrl:"https://old.invalid/file",attachmentPath:"users/old/file",attachmentSize:10}}],
      projects:[{id:"project-1",data:{name:"Project",customerId:"client-1"}}],
      invoices:[{id:"invoice-1",data:{id:"business-invoice-id",invoiceNo:"INV-001",client:"Client",clientEmail:"client@example.test",clientAddress:"1 Road",paymentTerms:"14 days",dueDate:"2026-09-10",amount:100,vat:20,total:120,items:[{description:"Services",amount:100}],status:"Unpaid",date:"28/08/2026",recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",projectId:"project-1",createdAt:timestamp,uid:"old-user"}}],
      bills:[{id:"bill-1",data:{id:"stored-bill-id",supplier:"Supplier",billNumber:"BILL-001",billDate:"2026-08-28",dueDate:"2026-09-10",category:"Utilities",net:50,vatRate:.2,vat:10,total:60,status:"Unpaid",notes:"",projectId:"project-1",attachmentName:"bill.pdf",attachmentUrl:"https://old.invalid/bill",attachmentPath:"users/old/bill",attachmentSize:50,attachmentType:"application/pdf",createdAt:timestamp,userId:"old-user"}}],
      expenses:[{id:"expense-1",data:{projectId:"project-1",amount:12,attachmentUrl:"https://old.invalid/receipt",attachmentPath:"users/old/receipt",userId:"old-user"}}],
      mileage:[{id:"mileage-legacy",data:{projectId:"project-1",amount:4}}],
      bankAccounts:[{id:"bank-1",data:{name:"Current",userId:"old-user"}}],
      bankTransactions:[{id:"tx-1",data:{bankAccountId:"bank-1",status:"unmatched",userId:"old-user",importedAt:timestamp}}],
      bankIncome:[{id:"income-1",data:{bankAccountId:"bank-1",bankTransactionId:"tx-1",gross:25,userId:"old-user"}}],
      journals:[{id:"bank-income_old-user_income-1",data:{userId:"old-user",journalId:"bank-income_old-user_income-1",date:"2026-08-28",sourceType:"bankIncome",sourceId:"income-1",sourceNumber:"tx-1",description:"Income",createdAt:timestamp,updatedAt:timestamp,reversedJournalId:"",lines:[{accountCode:"1000",description:"Income",debit:25,credit:0,bankAccountId:"bank-1"},{accountCode:"4200",description:"Income",debit:0,credit:25}]}}]
    },
    ...overrides
  });
}

function fixture(entries=[]){
  const firestore=new MemoryFirestore(entries);let tick=1000;
  const restore=createJsonBackupRestoreService({firestore,timestampFactory:(s,n)=>new FakeTimestamp(s,n),serverTimestamp:()=>new FakeTimestamp(++tick,0),now:()=>1700000000000,batchSize:3});
  return {firestore,restore};
}

describe("JSON Backup V2 server restore",()=>{
  it("performs a genuine representative round trip with IDs, timestamps, ownership, references, journals and stripped attachments",async()=>{
    const {firestore,restore}=fixture();
    const result=await restore({uid:UID,jobId:JOB,backup:representativeBackup()});
    expect(result).toMatchObject({status:"completed",verified:true,replayed:false});
    const restoredInvoice=firestore.read(`users/${UID}/invoices/invoice-1`);
    expect(restoredInvoice).toMatchObject({id:"business-invoice-id",createdAt:{seconds:100,nanoseconds:200}});
    expect(restoredInvoice).not.toHaveProperty("uid");
    expect(firestore.read(`users/${UID}/bankTransactions/tx-1`)).toMatchObject({userId:UID,importedAt:{seconds:100,nanoseconds:200}});
    expect(firestore.read(`users/${UID}/clients/client-1`)).toMatchObject({attachmentName:"",attachmentUrl:"",attachmentPath:"",attachmentSize:0});
    expect(firestore.read(`journals/invoice_${UID}_invoice-1`)).toMatchObject({userId:UID,sourceType:"salesInvoice",sourceId:"invoice-1"});
    expect(firestore.read(`journals/bill_${UID}_bill-1`)).toMatchObject({userId:UID,sourceType:"supplierBill",sourceId:"bill-1"});
    expect(firestore.read(`journals/bank-income_${UID}_income-1`)).toMatchObject({userId:UID,sourceType:"bankIncome"});
    const key=await referenceRegistryKey("invoice","INV-001");
    expect(firestore.read(`users/${UID}/referenceKeys/${key.registryDocumentId}`)).toMatchObject({state:"active",sourceId:"invoice-1",canonicalReference:key.canonicalReference});
    expect(firestore.read(`jsonRestoreJobs/${UID}_${JOB}`)).toMatchObject({status:"completed",verified:true});
  });

  it.each(JSON_BACKUP_COLLECTIONS)("rejects a non-empty destination when %s has data",async collectionName=>{
    const path=collectionName==="journals"?"journals/existing":`users/${UID}/${collectionName}/existing`;
    const data=collectionName==="journals"?{userId:UID}:{anything:true};
    const {restore}=fixture([[path,data]]);
    await expect(restore({uid:UID,jobId:JOB,backup:representativeBackup()})).rejects.toMatchObject({code:"NON_EMPTY_DESTINATION"});
  });

  it("does not treat account settings alone as a non-empty destination",async()=>{
    const {firestore,restore}=fixture([[`users/${UID}`,{uid:UID,currentPlan:"Pro"}]]);
    await expect(restore({uid:UID,jobId:JOB,backup:representativeBackup()})).resolves.toMatchObject({status:"completed"});
    expect(firestore.read(`users/${UID}`)).toMatchObject({uid:UID,currentPlan:"Pro",businessName:"Restored Books"});
  });

  it("returns a verified replay without duplicate writes for a completed job",async()=>{
    const {firestore,restore}=fixture();
    await restore({uid:UID,jobId:JOB,backup:representativeBackup()});
    const commits=firestore.commitCount;
    await expect(restore({uid:UID,jobId:JOB,backup:representativeBackup()})).resolves.toMatchObject({status:"completed",verified:true,replayed:true});
    expect(firestore.commitCount).toBe(commits);
  });

  it("rejects a different active restore job for the same account",async()=>{
    const activeLease=new Date(1700000600000);
    const {restore}=fixture([[`jsonRestoreLocks/${UID}`,{ownerUid:UID,jobId:"223e4567-e89b-42d3-a456-426614174001",backupHash:"other",status:"running",leaseExpiresAt:activeLease}]]);
    await expect(restore({uid:UID,jobId:JOB,backup:representativeBackup()})).rejects.toMatchObject({code:"RESTORE_IN_PROGRESS"});
  });

  it("fails a completed replay if restored data no longer verifies",async()=>{
    const {firestore,restore}=fixture();await restore({uid:UID,jobId:JOB,backup:representativeBackup()});
    firestore.remove(`users/${UID}/invoices/invoice-1`);
    await expect(restore({uid:UID,jobId:JOB,backup:representativeBackup()})).rejects.toMatchObject({code:"VERIFICATION_FAILED"});
  });

  it("rejects malformed backup fields, codecs, duplicates and dangling banking links server-side",async()=>{
    const cases=[];
    const wrongApp=representativeBackup();wrongApp.app="Other Books";cases.push(wrongApp);
    const wrongVersion=representativeBackup();wrongVersion.schemaVersion=1;cases.push(wrongVersion);
    const unknown=representativeBackup();unknown.collections.secrets=[];cases.push(unknown);
    const unsafe=representativeBackup();unsafe.account.uid="old";unsafe.manifest.accountFields.push("uid");cases.push(unsafe);
    const codec=representativeBackup();codec.collections.bankTransactions[0].data.importedAt.__simpleBooksV2Value.nanoseconds=1e9;cases.push(codec);
    const duplicate=representativeBackup();duplicate.collections.clients.push(structuredClone(duplicate.collections.clients[0]));duplicate.manifest.collectionCounts.clients++;cases.push(duplicate);
    const dangling=representativeBackup();dangling.collections.bankIncome[0].data.bankTransactionId="missing";cases.push(dangling);
    for(const backup of cases){const {restore}=fixture();await expect(restore({uid:UID,jobId:JOB,backup})).rejects.toMatchObject({code:"INVALID_BACKUP"});}
  });

  it("records a staged failure and safely resumes the identical job without duplicates",async()=>{
    const {firestore,restore}=fixture();firestore.failCommitNumber=2;
    await expect(restore({uid:UID,jobId:JOB,backup:representativeBackup()})).rejects.toThrow("injected-batch-failure");
    expect(firestore.read(`jsonRestoreJobs/${UID}_${JOB}`)).toMatchObject({status:"failed",failedStage:"business-sources",errorCode:"INTERNAL"});
    firestore.failCommitNumber=0;
    await expect(restore({uid:UID,jobId:JOB,backup:representativeBackup()})).resolves.toMatchObject({status:"completed",verified:true});
    expect([...firestore.documents.keys()].filter(path=>path===`users/${UID}/invoices/invoice-1`)).toHaveLength(1);
  });

  it("reports verification count, ID and ownership failures",async()=>{
    const {firestore}=fixture();
    const plan={account:{},collections:Object.fromEntries(JSON_BACKUP_COLLECTIONS.map(name=>[name,[]]))};
    plan.collections.bankAccounts=[{id:"bank-1",data:{userId:UID}}];
    firestore.set(`users/${UID}/bankAccounts/wrong-id`,{userId:"wrong"});
    await expect(verifyRestore(firestore,UID,plan)).rejects.toMatchObject({code:"VERIFICATION_FAILED",details:{failures:expect.arrayContaining([expect.stringContaining("bankAccounts/bank-1 is missing")])}});
  });

  it("binds authentication in the callable handler and rejects unauthenticated requests",async()=>{
    const calls=[];const handler=createJsonBackupRestoreHandler(async input=>{calls.push(input);return {status:"completed"};});
    await expect(handler({data:{jobId:JOB,backup:{}}})).rejects.toMatchObject({code:"unauthenticated"});
    await handler({auth:{uid:UID},data:{jobId:JOB,backup:{sourceUid:"forged"}}});
    expect(calls[0]).toEqual({uid:UID,jobId:JOB,backup:{sourceUid:"forged"}});
  });

  it("detects destination journals only for the authenticated owner",async()=>{
    const {firestore}=fixture([["journals/other",{userId:"other"}],["journals/current",{userId:UID}]]);
    expect((await inspectDestination(firestore,UID)).nonEmptyCollections).toContain("journals");
    expect((await inspectDestination(firestore,"third-user")).empty).toBe(true);
  });
});
