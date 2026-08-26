import { describe, expect, it } from "vitest";
import sourceCreateModule from "../functions/lib/source-create-service.js";
import accountingModule from "../functions/lib/source-create-accounting.js";
import handlerModule from "../functions/lib/source-create-handlers.js";
import registryKeyModule from "../functions/lib/reference-registry-key.js";
import deletionGuardModule from "../functions/lib/account-deletion-guard.js";
import { prepareBillJournal, prepareInvoiceJournal } from "../resources/js/ledger-firestore.js";

const { createSourceWithReferenceService } = sourceCreateModule;
const { billJournal, invoiceJournal } = accountingModule;
const { createSourceCreateHandlers } = handlerModule;
const { referenceRegistryKey } = registryKeyModule;
const { createAccountDeletionGuard } = deletionGuardModule;
const REQUEST_A = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_B = "223e4567-e89b-42d3-a456-426614174001";

const clone = value => value === undefined ? undefined : structuredClone(value);
class Ref {
  constructor(db,path){ this.db=db; this.path=path; }
  collection(name){ return new Collection(this.db,`${this.path}/${name}`); }
}
class Collection {
  constructor(db,path){ this.db=db; this.path=path; }
  doc(id){ return new Ref(this.db,`${this.path}/${id}`); }
}
class MemoryFirestore {
  constructor(entries=[]){
    this.documents=new Map(entries.map(([path,data]) => [path,clone(data)]));
    this.queue=Promise.resolve();
    this.failNextCommit=false;
  }
  collection(name){ return new Collection(this,name); }
  snapshot(ref){
    if(ref instanceof Collection){
      const prefix=`${ref.path}/`;
      return {docs:[...this.documents.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/")).map(([path,data]) => ({
        id:path.slice(prefix.length),data:() => clone(data)
      }))};
    }
    return { exists:this.documents.has(ref.path),data:() => clone(this.documents.get(ref.path)) };
  }
  runTransaction(execute){
    const run=this.queue.then(async () => {
      const staged=[];
      const tx={
        get:async ref => this.snapshot(ref),
        create:(ref,data) => staged.push([ref.path,clone(data)])
      };
      const result=await execute(tx);
      if(this.failNextCommit){ this.failNextCommit=false; throw new Error("commit-failed"); }
      const next=new Map([...this.documents].map(([path,data]) => [path,clone(data)]));
      for(const [path,data] of staged){ if(next.has(path)) throw new Error("already-exists"); next.set(path,data); }
      this.documents=next;
      return result;
    });
    this.queue=run.catch(() => {});
    return run;
  }
  read(path){ return clone(this.documents.get(path)); }
  paths(prefix){ return [...this.documents.keys()].filter(path => path.startsWith(prefix)); }
}

function invoice(overrides={}){
  return {
    invoiceNo:"INV-001",client:"Test Customer",clientEmail:"test@example.com",clientAddress:"1 Road",
    paymentTerms:"14 days",dueDate:"2026-09-03",amount:100,vat:20,total:120,
    items:[{description:"Bookkeeping",amount:100}],status:"Unpaid",date:"20/08/2026",
    recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",
    projectId:"project-1",projectName:"Project",projectReference:"P-1",...overrides
  };
}
function bill(overrides={}){
  return {
    id:1724140800000,supplier:"Test Supplier",billNumber:"BILL-001",billDate:"2026-08-20",
    dueDate:"2026-09-03",category:"Utilities",net:100,vatRate:0.2,vat:20,total:120,status:"Unpaid",
    notes:"",projectId:"project-1",projectName:"Project",projectReference:"P-1",
    attachmentName:"",attachmentUrl:"",attachmentPath:"",attachmentSize:0,attachmentType:"",...overrides
  };
}
function fixture(entries=[], options={}){
  const firestore=new MemoryFirestore(entries);
  let timestamp=0;
  const create=createSourceWithReferenceService({
    firestore,serverTimestamp:() => `server-${++timestamp}`,now:() => "2026-08-20T12:00:00.000Z",
    deletionGuard:options.guardDeletion ? createAccountDeletionGuard(firestore) : undefined
  });
  return {firestore,create};
}
const createInvoice=(create,overrides={}) => create({
  uid:"user-1",recordType:"invoice",sourceId:"invoice-1",requestId:REQUEST_A,payload:invoice(),...overrides
});
const createBill=(create,overrides={}) => create({
  uid:"user-1",recordType:"bill",sourceId:"1724140800000",requestId:REQUEST_A,payload:bill(),...overrides
});

describe("atomic source creation",() => {
  it("keeps every Invoice create path Unpaid-only while preserving an optional VAT rate",async () => {
    const {firestore,create}=fixture();
    await expect(createInvoice(create,{payload:invoice({status:"Paid"})}))
      .rejects.toMatchObject({code:"invalid-argument"});
    const result=await createInvoice(create,{payload:invoice({vatRate:0.2})});
    expect(result.status).toBe("created");
    expect(firestore.read("users/user-1/invoices/invoice-1")).toMatchObject({
      status:"Unpaid",vatRate:0.2
    });
    expect(firestore.paths("journals/")).toHaveLength(1);
  });

  it("refuses a privileged source mutation once deletion has started", async () => {
    const {firestore,create}=fixture([
      ["users/user-1",{uid:"user-1",deletionInProgress:true}],
      ["accountDeletionJobs/user-1",{uid:"user-1",stage:"requested",status:"active"}]
    ],{guardDeletion:true});
    await expect(createInvoice(create)).rejects.toMatchObject({
      code:"failed-precondition",
      details:{reason:"account-deletion-in-progress"}
    });
    expect(firestore.paths("users/user-1/invoices/")).toHaveLength(0);
    expect(firestore.paths("journals/")).toHaveLength(0);
  });

  it.each([
    ["invoice",createInvoice,"users/user-1/invoices/","invoice_user-1_"],
    ["bill",createBill,"users/user-1/bills/","bill_user-1_"]
  ])("serializes canonical-equivalent concurrent %s creates",async (_type,invoke,sourcePrefix,journalPrefix) => {
    const {firestore,create}=fixture();
    const other=_type === "invoice"
      ? {sourceId:"invoice-2",requestId:REQUEST_B,payload:invoice({invoiceNo:"inv / 001"})}
      : {sourceId:"1724140800001",requestId:REQUEST_B,payload:bill({id:1724140800001,billNumber:"bill / 001"})};
    const results=await Promise.allSettled([invoke(create),invoke(create,other)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected").reason).toMatchObject({code:"reference-conflict"});
    expect(firestore.paths(sourcePrefix)).toHaveLength(1);
    expect(firestore.paths("users/user-1/referenceKeys/")).toHaveLength(1);
    expect(firestore.paths("journals/").filter(path => path.includes(journalPrefix))).toHaveLength(1);
  });

  it("returns only a proven exact retry and rejects changed or differently identified retries",async () => {
    const {firestore,create}=fixture();
    expect((await createInvoice(create)).status).toBe("created");
    expect((await createInvoice(create)).status).toBe("already-created");
    await expect(createInvoice(create,{payload:invoice({client:"Changed"})})).rejects.toMatchObject({code:"idempotency-conflict"});
    await expect(createInvoice(create,{requestId:REQUEST_B})).rejects.toMatchObject({code:"source-conflict"});
    expect(firestore.paths("users/user-1/invoices/")).toHaveLength(1);
    expect(firestore.paths("journals/")).toHaveLength(1);
  });

  it("fails closed when a supposedly idempotent source has since changed",async () => {
    const {firestore,create}=fixture();
    await createInvoice(create);
    firestore.documents.get("users/user-1/invoices/invoice-1").client="Changed after create";
    await expect(createInvoice(create)).rejects.toMatchObject({code:"create-integrity-error"});
  });

  it("rolls back source, journal, registry, and request marker together",async () => {
    const {firestore,create}=fixture();
    firestore.failNextCommit=true;
    await expect(createInvoice(create)).rejects.toThrow("commit-failed");
    expect(firestore.documents.size).toBe(0);
  });

  it("allows blank references without a registry claim",async () => {
    const {firestore,create}=fixture();
    await createInvoice(create,{payload:invoice({invoiceNo:" / . "})});
    expect(firestore.paths("users/user-1/invoices/")).toHaveLength(1);
    expect(firestore.paths("journals/")).toHaveLength(1);
    expect(firestore.paths("users/user-1/referenceKeys/")).toHaveLength(0);
  });

  it.each([
    ["invoice","users/user-1/invoices/legacy-1",{invoiceNo:"inv / 001"},createInvoice],
    ["bill","users/user-1/bills/legacy-1",{billNumber:"bill / 001"},createBill]
  ])("blocks a canonical %s collision with an unregistered legacy source",async (_type,path,legacy,invoke) => {
    const {firestore,create}=fixture([[path,legacy]]);
    await expect(invoke(create)).rejects.toMatchObject({code:"legacy-reference-conflict"});
    expect(firestore.paths("users/user-1/referenceKeys/")).toHaveLength(0);
    expect(firestore.paths("journals/")).toHaveLength(0);
  });

  it("keeps Invoice/Bill namespaces and user namespaces separate",async () => {
    const {firestore,create}=fixture();
    await Promise.all([
      createInvoice(create,{payload:invoice({invoiceNo:"SHARED-001"})}),
      createBill(create,{requestId:REQUEST_B,payload:bill({billNumber:"shared / 001"})}),
      createInvoice(create,{uid:"user-2",sourceId:"invoice-2",requestId:REQUEST_B,payload:invoice({invoiceNo:"shared.001"})})
    ]);
    expect(firestore.paths("users/user-1/referenceKeys/")).toHaveLength(2);
    expect(firestore.paths("users/user-2/referenceKeys/")).toHaveLength(1);
  });

  it.each(["retired","legacy-conflict"])("blocks a %s registry tombstone",async state => {
    const key=await referenceRegistryKey("invoice","INV-001");
    const path=`users/user-1/referenceKeys/${key.registryDocumentId}`;
    const {create}=fixture([[path,{schemaVersion:1,recordType:"invoice",canonicalReference:"inv001",sourceId:"legacy",state}]]);
    await expect(createInvoice(create)).rejects.toMatchObject({code:state === "retired" ? "retired-reference" : "legacy-conflict"});
  });

  it("rejects unknown, settlement, matched, malformed money, and forged Invoice status fields",async () => {
    for(const payload of [
      {...invoice(),unknown:true},{...invoice(),bankSettlement:{}},{...invoice(),matched:true},
      invoice({total:119}),invoice({status:"Paid"})
    ]){
      const {create}=fixture();
      await expect(createInvoice(create,{payload})).rejects.toMatchObject({code:"invalid-argument"});
    }
  });

  it("rejects a Bill attachment path outside the authenticated Bill scope",async () => {
    const {create}=fixture();
    await expect(createBill(create,{payload:bill({
      attachmentName:"bill.pdf",attachmentUrl:"https://example.invalid/bill.pdf",
      attachmentPath:"users/other/attachments/bills/1724140800000/bill.pdf",attachmentSize:10,
      attachmentType:"application/pdf"
    })})).rejects.toMatchObject({code:"invalid-argument"});
  });

  it("requires auth and rejects caller ownership fields at the callable boundary",async () => {
    const handlers=createSourceCreateHandlers(async input => input);
    await expect(handlers.createInvoiceWithReference({data:{}})).rejects.toMatchObject({code:"unauthenticated"});
    await expect(handlers.createInvoiceWithReference({auth:{uid:"user-1"},data:{sourceId:"one",requestId:REQUEST_A,payload:invoice(),uid:"forged"}})).rejects.toMatchObject({code:"invalid-argument"});
  });
});

describe("accounting equivalence",() => {
  it("matches the trusted Invoice journal including project-neutral ledger lines and penny rounding",() => {
    const payload=invoice({amount:10.01,vat:2,total:12.01,items:[{description:"A",amount:5.005},{description:"B",amount:5.005}]});
    // The UI rounds item aggregates before submission; use representative persisted pennies.
    payload.items=[{description:"A",amount:5},{description:"B",amount:5.01}];
    const timestamp="2026-08-20T12:00:00.000Z";
    expect(invoiceJournal("user-1","invoice-1",payload,timestamp).data)
      .toEqual(prepareInvoiceJournal("user-1","invoice-1",payload,{createdAt:timestamp,updatedAt:timestamp}));
  });

  it("matches the trusted Bill journal for VAT, category accounts, dates, and linkage",() => {
    const payload=bill({net:83.33,vat:16.67,total:100,category:"Professional fees"});
    const timestamp="2026-08-20T12:00:00.000Z";
    expect(billJournal("user-1","1724140800000",payload,timestamp).data)
      .toEqual(prepareBillJournal("user-1","1724140800000",payload,{createdAt:timestamp,updatedAt:timestamp}));
  });
});
