import { describe,expect,it } from "vitest";
import {
  isSafeDocumentReference as browserIsSafeReference,
  normaliseDocumentReference as browserCanonicalReference
} from "../resources/js/bank-match-identity.js";
import {
  isSafeDocumentReference as sharedIsSafeReference,
  normaliseDocumentReference as sharedCanonicalReference
} from "../functions/lib/reference-canonicalization.mjs";
import registryKeyModule from "../functions/lib/reference-registry-key.js";
import registryServiceModule from "../functions/lib/reference-registry-service.js";
import registryHandlersModule from "../functions/lib/reference-registry-handlers.js";

const { referenceRegistryKey } = registryKeyModule;
const { REGISTRY_STATES,createReferenceRegistryService } = registryServiceModule;
const { createReferenceRegistryHandlers } = registryHandlersModule;
const REQUEST_A = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_B = "223e4567-e89b-42d3-a456-426614174001";
const REQUEST_C = "323e4567-e89b-42d3-a456-426614174002";

function clone(value){
  return value === undefined ? undefined : structuredClone(value);
}

class MemoryReference {
  constructor(firestore,path){
    this.firestore = firestore;
    this.path = path;
  }
  collection(name){
    return new MemoryCollection(this.firestore,`${this.path}/${name}`);
  }
}

class MemoryCollection {
  constructor(firestore,path){
    this.firestore = firestore;
    this.path = path;
  }
  doc(id){
    return new MemoryReference(this.firestore,`${this.path}/${id}`);
  }
}

class MemoryFirestore {
  constructor(entries = []){
    this.documents = new Map(entries.map(([path,data]) => [path,clone(data)]));
    this.queue = Promise.resolve();
    this.failNextCommit = false;
  }
  collection(name){
    return new MemoryCollection(this,name);
  }
  snapshot(reference,documents = this.documents){
    return {
      exists:documents.has(reference.path),
      data:() => clone(documents.get(reference.path))
    };
  }
  runTransaction(execute){
    const run = this.queue.then(async () => {
      const staged = [];
      const transaction = {
        get:async reference => this.snapshot(reference),
        create:(reference,data) => staged.push({type:"create",reference,data:clone(data)}),
        set:(reference,data) => staged.push({type:"set",reference,data:clone(data)}),
        update:(reference,data) => staged.push({type:"update",reference,data:clone(data)})
      };
      const result = await execute(transaction);
      if(this.failNextCommit){
        this.failNextCommit = false;
        throw new Error("simulated-commit-failure");
      }
      const next = new Map([...this.documents].map(([path,data]) => [path,clone(data)]));
      for(const operation of staged){
        const path = operation.reference.path;
        if(operation.type === "create" && next.has(path)) throw new Error("already-exists");
        if(operation.type === "update" && !next.has(path)) throw new Error("not-found");
        next.set(path,operation.type === "update"
          ? { ...next.get(path),...clone(operation.data) }
          : clone(operation.data));
      }
      this.documents = next;
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
  read(path){
    return clone(this.documents.get(path));
  }
  write(path,data){
    this.documents.set(path,clone(data));
  }
}

function fixture(entries = []){
  const firestore = new MemoryFirestore(entries);
  let timestamp = 0;
  const service = createReferenceRegistryService({
    firestore,
    serverTimestamp:() => `timestamp-${++timestamp}`
  });
  return { firestore,service };
}

function sourcePath(uid,recordType,sourceId){
  return `users/${uid}/${recordType === "invoice" ? "invoices" : "bills"}/${sourceId}`;
}

async function registryPath(uid,recordType,reference){
  const key = await referenceRegistryKey(recordType,reference);
  return `users/${uid}/referenceKeys/${key.registryDocumentId}`;
}

async function claim(service,overrides = {}){
  return service.claimReference({
    uid:"user-1",recordType:"invoice",sourceId:"invoice-1",
    reference:"INV-001",requestId:REQUEST_A,...overrides
  });
}

describe("shared reference canonicalization",() => {
  it.each([
    ["INV-001","inv001"],
    ["inv / 001","inv001"],
    ["INV.001","inv001"],
    [" I N V - 0 0 1 ","inv001"],
    ["\uFF29\uFF2E\uFF36\uFF0D\uFF10\uFF10\uFF11","inv001"],
    ["R\u00C9F-001","r\u00E9f001"],
    ["RE\u0301F/001","r\u00E9f001"],
    ["\u8ACB\u6C42-\uFF11\uFF12\uFF13","\u8ACB\u6C42123"],
    ["", ""],
    [null, ""],
    [undefined, ""],
    [123456,"123456"]
  ])("keeps browser and server canonicalization equivalent for %j",async (input,expected) => {
    expect(browserCanonicalReference(input)).toBe(expected);
    expect(sharedCanonicalReference(input)).toBe(expected);
    expect((await registryKeyModule.canonicalReference(input))).toBe(expected);
    expect(browserIsSafeReference(input)).toBe(sharedIsSafeReference(input));
  });

  it("retains Phase 3A safety semantics without using them to change canonicalization",() => {
    expect(sharedIsSafeReference("INV-001")).toBe(true);
    expect(sharedIsSafeReference("123456")).toBe(false);
    expect(sharedIsSafeReference("")).toBe(false);
  });
});

describe("reference registry keys",() => {
  it("builds the deterministic SHA-256 key from type, NUL, and canonical reference",async () => {
    await expect(referenceRegistryKey("invoice","INV-001")).resolves.toEqual({
      recordType:"invoice",
      canonicalReference:"inv001",
      registryDocumentId:"b0608d1d7a77a2e5df5c1225bbf0500d7185794a4b4f4e67a87973dcf28632a0",
      scopedCanonical:"invoice\0inv001"
    });
  });

  it("separates types and references and returns no key for a blank canonical value",async () => {
    const invoice = await referenceRegistryKey("invoice","SHARED-001");
    const bill = await referenceRegistryKey("bill","shared / 001");
    const different = await referenceRegistryKey("invoice","SHARED-002");
    expect(new Set([invoice.registryDocumentId,bill.registryDocumentId,different.registryDocumentId]).size).toBe(3);
    await expect(referenceRegistryKey("bill"," / . ")).resolves.toMatchObject({
      canonicalReference:"",registryDocumentId:null,scopedCanonical:null
    });
  });

  it("fails closed for unsupported record types",async () => {
    await expect(referenceRegistryKey("expense","EXP-001")).rejects.toMatchObject({code:"invalid-record-type"});
  });
});

describe("reference registry lifecycle service",() => {
  it.each(["invoice","bill"])("serializes simultaneous equivalent %s claims",async recordType => {
    const { service } = fixture();
    const reference = recordType === "invoice" ? "INV-001" : "BILL-001";
    const results = await Promise.allSettled([
      claim(service,{recordType,reference,sourceId:`${recordType}-1`,requestId:REQUEST_A}),
      claim(service,{recordType,reference:reference.toLowerCase().replace("-"," / "),sourceId:`${recordType}-2`,requestId:REQUEST_B})
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")[0].reason).toMatchObject({code:"reference-conflict"});
  });

  it("allows the same visible reference for two users and for Invoice/Bill namespaces",async () => {
    const { service } = fixture();
    const results = await Promise.all([
      claim(service),
      claim(service,{uid:"user-2",sourceId:"invoice-2",requestId:REQUEST_B}),
      claim(service,{recordType:"bill",sourceId:"bill-1",requestId:REQUEST_C})
    ]);
    expect(results.map(result => result.status)).toEqual(["claimed","claimed","claimed"]);
    expect(new Set(results.map(result => result.registryDocumentId)).size).toBe(2);
  });

  it("makes an exact same-source claim retry idempotent",async () => {
    const { service } = fixture();
    expect((await claim(service)).status).toBe("claimed");
    expect((await claim(service)).status).toBe("already-claimed");
    await expect(claim(service,{requestId:REQUEST_B})).rejects.toMatchObject({code:"reference-conflict"});
  });

  it("changes A to free B atomically, retires A, and preserves unrelated source fields",async () => {
    const path = sourcePath("user-1","invoice","invoice-1");
    const { firestore,service } = fixture([[path,{invoiceNo:"INV-001",total:120,status:"Unpaid",notes:"keep"}]]);
    await claim(service);
    const result = await service.changeReference({
      uid:"user-1",recordType:"invoice",sourceId:"invoice-1",
      newReference:"INV-002",requestId:REQUEST_B
    });
    expect(result.status).toBe("changed");
    expect(firestore.read(path)).toEqual({invoiceNo:"INV-002",total:120,status:"Unpaid",notes:"keep"});
    expect(firestore.read(await registryPath("user-1","invoice","INV-001"))).toMatchObject({
      state:REGISTRY_STATES.RETIRED,sourceId:"invoice-1",retireRequestId:REQUEST_B
    });
    expect(firestore.read(await registryPath("user-1","invoice","INV-002"))).toMatchObject({
      state:REGISTRY_STATES.ACTIVE,sourceId:"invoice-1",claimRequestId:REQUEST_B
    });
    expect((await service.changeReference({
      uid:"user-1",recordType:"invoice",sourceId:"invoice-1",
      newReference:"inv / 002",requestId:REQUEST_B
    })).status).toBe("already-changed");
  });

  it("updates an existing legacy reference field to agree without changing other Bill data",async () => {
    const path = sourcePath("user-1","bill","bill-1");
    const { firestore,service } = fixture([[path,{invoiceNumber:"OLD-001",total:50,notes:"keep"}]]);
    await claim(service,{recordType:"bill",sourceId:"bill-1",reference:"OLD-001"});
    await service.changeReference({
      uid:"user-1",recordType:"bill",sourceId:"bill-1",
      newReference:"NEW-001",requestId:REQUEST_B
    });
    expect(firestore.read(path)).toEqual({
      billNumber:"NEW-001",invoiceNumber:"NEW-001",total:50,notes:"keep"
    });
  });

  it("rejects occupied and retired destination keys without changing A or its source",async () => {
    const firstPath = sourcePath("user-1","invoice","invoice-1");
    const secondPath = sourcePath("user-1","invoice","invoice-2");
    const { firestore,service } = fixture([
      [firstPath,{invoiceNo:"INV-001",total:10}],
      [secondPath,{invoiceNo:"INV-002",total:20}]
    ]);
    await claim(service);
    await claim(service,{sourceId:"invoice-2",reference:"INV-002",requestId:REQUEST_B});
    await expect(service.changeReference({
      uid:"user-1",recordType:"invoice",sourceId:"invoice-1",
      newReference:"INV-002",requestId:REQUEST_C
    })).rejects.toMatchObject({code:"reference-conflict"});
    expect(firestore.read(firstPath)).toEqual({invoiceNo:"INV-001",total:10});
    expect(firestore.read(await registryPath("user-1","invoice","INV-001"))).toMatchObject({state:"active"});

    await service.retireReferenceForDelete({
      uid:"user-1",recordType:"invoice",sourceId:"invoice-2",requestId:REQUEST_C
    });
    await expect(service.changeReference({
      uid:"user-1",recordType:"invoice",sourceId:"invoice-1",
      newReference:"INV-002",requestId:REQUEST_B
    })).rejects.toMatchObject({code:"reference-conflict"});
    expect(firestore.read(firstPath).invoiceNo).toBe("INV-001");
  });

  it("retires a key without deleting the source and permanently blocks another source",async () => {
    const path = sourcePath("user-1","bill","bill-1");
    const { firestore,service } = fixture([[path,{billNumber:"BILL-001",total:60}]]);
    await claim(service,{recordType:"bill",sourceId:"bill-1",reference:"BILL-001"});
    const input = {uid:"user-1",recordType:"bill",sourceId:"bill-1",requestId:REQUEST_B};
    expect(await service.retireReferenceForDelete(input)).toMatchObject({status:"retired",sourceDeleted:false});
    expect(await service.retireReferenceForDelete(input)).toMatchObject({status:"already-retired",sourceDeleted:false});
    expect(firestore.read(path)).toEqual({billNumber:"BILL-001",total:60});
    await expect(claim(service,{
      recordType:"bill",sourceId:"bill-2",reference:"bill / 001",requestId:REQUEST_C
    })).rejects.toMatchObject({code:"reference-conflict"});
  });

  it("rejects reference changes and retirement for settled sources",async () => {
    const marker = {version:1,transactionId:"bank-1",journalId:"journal-1"};
    const path = sourcePath("user-1","invoice","invoice-1");
    const original = {invoiceNo:"INV-001",total:100,bankSettlement:marker};
    const { firestore,service } = fixture([[path,original]]);
    await claim(service);
    await expect(service.changeReference({
      uid:"user-1",recordType:"invoice",sourceId:"invoice-1",
      newReference:"INV-002",requestId:REQUEST_B
    })).rejects.toMatchObject({code:"bank-settled-source"});
    await expect(service.retireReferenceForDelete({
      uid:"user-1",recordType:"invoice",sourceId:"invoice-1",requestId:REQUEST_C
    })).rejects.toMatchObject({code:"bank-settled-source"});
    expect(firestore.read(path)).toEqual(original);
  });

  it("leaves no partial source or registry changes when transaction commit fails",async () => {
    const path = sourcePath("user-1","invoice","invoice-1");
    const { firestore,service } = fixture([[path,{invoiceNo:"INV-001",total:100}]]);
    await claim(service);
    firestore.failNextCommit = true;
    await expect(service.changeReference({
      uid:"user-1",recordType:"invoice",sourceId:"invoice-1",
      newReference:"INV-002",requestId:REQUEST_B
    })).rejects.toThrow("simulated-commit-failure");
    expect(firestore.read(path).invoiceNo).toBe("INV-001");
    expect(firestore.read(await registryPath("user-1","invoice","INV-001"))).toMatchObject({state:"active"});
    expect(firestore.read(await registryPath("user-1","invoice","INV-002"))).toBeUndefined();
  });

  it("fails closed when a legacy-conflict entry occupies the canonical key",async () => {
    const { firestore,service } = fixture();
    const key = await referenceRegistryKey("invoice","INV-001");
    firestore.write(await registryPath("user-1","invoice","INV-001"),{
      schemaVersion:1,recordType:"invoice",canonicalReference:key.canonicalReference,
      sourceId:"legacy-source",state:REGISTRY_STATES.LEGACY_CONFLICT,
      claimedAt:"migration-time",retiredAt:null
    });
    await expect(claim(service)).rejects.toMatchObject({code:"reference-conflict"});
  });

  it("returns a no-key result for blank claims without writing a registry document",async () => {
    const { firestore,service } = fixture();
    await expect(claim(service,{reference:" / . "})).resolves.toMatchObject({
      status:"unregistered-blank",registryDocumentId:null
    });
    expect([...firestore.documents.keys()]).toEqual([]);
  });
});

describe("unexported callable handler foundation",() => {
  it("derives ownership only from auth and rejects unauthenticated or UID-injected requests",async () => {
    const calls = [];
    const handlers = createReferenceRegistryHandlers({
      claimReference:async input => { calls.push(input); return {status:"claimed"}; },
      changeReference:async () => ({status:"changed"}),
      retireReferenceForDelete:async () => ({status:"retired"})
    });
    const data = {recordType:"invoice",sourceId:"invoice-1",reference:"INV-001",requestId:REQUEST_A};
    await expect(handlers.claimReference({data})).rejects.toMatchObject({code:"unauthenticated"});
    await expect(handlers.claimReference({auth:{uid:"user-1"},data:{...data,uid:"user-2"}}))
      .rejects.toMatchObject({code:"invalid-argument"});
    await expect(handlers.claimReference({auth:{uid:"user-1"},data})).resolves.toEqual({status:"claimed"});
    expect(calls).toEqual([{...data,uid:"user-1"}]);
  });

  it("rejects malformed reference values before any Firestore operation",async () => {
    const { service } = fixture();
    await expect(claim(service,{reference:{value:"INV-001"}})).rejects.toMatchObject({code:"invalid-argument"});
  });
});
