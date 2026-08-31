import { describe, expect, it } from "vitest";
import {
  DecodedBackupTimestamp,
  JSON_BACKUP_ACCOUNT_FIELDS,
  JSON_BACKUP_APP,
  JSON_BACKUP_COLLECTIONS,
  JSON_BACKUP_OMISSIONS,
  JsonBackupValidationError,
  backupAccountStateFromCounts,
  createJsonBackupV2,
  decodeJsonBackupValue,
  encodeJsonBackupValue,
  preflightJsonBackupV2,
  selectJsonBackupAccountSettings
} from "../resources/js/json-backup-schema.js";
import serverSchema from "../functions/lib/json-backup-v2-schema.js";

class FakeTimestamp {
  constructor(seconds, nanoseconds){
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  toDate(){ return new Date(this.seconds * 1000); }
  toMillis(){ return this.seconds * 1000 + this.nanoseconds / 1000000; }
}

function backup(overrides = {}){
  return createJsonBackupV2({
    exportedAt:"2026-08-28T12:00:00.000Z",
    account:{
      businessName:"Test Books Ltd",
      paymentTermsDefault:"14 days",
      uid:"must-not-export",
      demoMode:true,
      currentPlan:"Pro",
      companyLogoUrl:"https://storage.invalid/logo.png",
      updatedAt:new FakeTimestamp(10,20)
    },
    collections:{
      invoices:[{ id:"firestore-invoice-id",data:{ id:"stored-business-id",invoiceNo:"INV-001",createdAt:new FakeTimestamp(100,200) } }],
      projects:[{ id:"project-1",data:{ name:"Migration",customerId:"customer-1" } }],
      customers:[{ id:"customer-1",data:{ name:"Customer" } }],
      expenses:[{ id:"expense-1",data:{ projectId:"project-1" } }]
    },
    ...overrides
  });
}

function copy(value){
  return JSON.parse(JSON.stringify(value));
}

describe("JSON Backup V2 schema",() => {
  it("builds the explicit V2 envelope, deterministic manifest and safe records",() => {
    const result=backup();
    expect(result).toMatchObject({
      app:JSON_BACKUP_APP,
      schemaVersion:2,
      exportedAt:"2026-08-28T12:00:00.000Z",
      manifest:{ codecVersion:1,storageBinariesIncluded:false },
      account:{ businessName:"Test Books Ltd",paymentTermsDefault:"14 days" }
    });
    expect(Object.keys(result.collections)).toEqual(JSON_BACKUP_COLLECTIONS);
    expect(result.manifest.collectionCounts).toMatchObject({ invoices:1,projects:1,customers:1,expenses:1,journals:0 });
    expect(result.manifest.omissions).toEqual(JSON_BACKUP_OMISSIONS.map(item=>item.id));
    expect(result.collections.invoices[0]).toEqual({
      id:"firestore-invoice-id",
      data:{
        createdAt:{ __simpleBooksV2Value:{ version:1,type:"timestamp",seconds:100,nanoseconds:200 } },
        id:"stored-business-id",
        invoiceNo:"INV-001"
      }
    });
  });

  it("sorts records and object keys for deterministic output",() => {
    const result=createJsonBackupV2({
      exportedAt:"2026-08-28T12:00:00.000Z",
      collections:{ clients:[
        { id:"z",data:{ z:1,a:2 } },
        { id:"a",data:{ b:1,a:2 } }
      ] }
    });
    expect(result.collections.clients.map(record=>record.id)).toEqual(["a","z"]);
    expect(Object.keys(result.collections.clients[0].data)).toEqual(["a","b"]);
  });

  it("exports only allow-listed restorable account settings",() => {
    const selected=selectJsonBackupAccountSettings({
      fullName:"Owner",businessName:"Safe Ltd",sortCode:"20-00-00",
      uid:"user-1",demoMode:true,deletionInProgress:true,lastBackupDownloadedAt:"yesterday",
      currentPlan:"Pro",subscriptionStatus:"active",companyLogoUrl:"private-url",updatedAt:"now"
    });
    expect(selected).toEqual({ fullName:"Owner",businessName:"Safe Ltd",sortCode:"20-00-00" });
    expect(JSON_BACKUP_ACCOUNT_FIELDS).toContain("paymentTermsDefault");
    expect(JSON_BACKUP_ACCOUNT_FIELDS).not.toContain("uid");
    expect(JSON_BACKUP_ACCOUNT_FIELDS).not.toContain("companyLogoUrl");
    expect(JSON_BACKUP_ACCOUNT_FIELDS).not.toContain("lastAccountantPackGeneratedAt");
    expect(JSON_BACKUP_ACCOUNT_FIELDS).not.toContain("lastRestoreCompletedAt");
  });
});

describe("JSON Backup V2 Firestore value codec",() => {
  it("encodes and decodes Timestamp values with an explicit factory",() => {
    const encoded=encodeJsonBackupValue(new FakeTimestamp(123,456));
    expect(encoded).toEqual({
      __simpleBooksV2Value:{ version:1,type:"timestamp",seconds:123,nanoseconds:456 }
    });
    const decoded=decodeJsonBackupValue(encoded,{
      timestampFactory:(seconds,nanoseconds)=>new FakeTimestamp(seconds,nanoseconds)
    });
    expect(decoded).toBeInstanceOf(FakeTimestamp);
    expect(decoded).toMatchObject({ seconds:123,nanoseconds:456 });
  });

  it("round-trips nested arrays, objects, null and ordinary values",() => {
    const original={ text:"hello",number:4,flag:false,nothing:null,nested:[new FakeTimestamp(8,9),{ amount:12.5 }] };
    const decoded=decodeJsonBackupValue(encodeJsonBackupValue(original));
    expect(decoded).toMatchObject({ text:"hello",number:4,flag:false,nothing:null,nested:[{ seconds:8,nanoseconds:9 },{ amount:12.5 }] });
    expect(decoded.nested[0]).toBeInstanceOf(DecodedBackupTimestamp);
  });

  it("escapes ordinary objects that use the reserved marker key",() => {
    const original={ __simpleBooksV2Value:{ type:"ordinary-business-data" },other:"kept" };
    const encoded=encodeJsonBackupValue(original);
    expect(encoded.__simpleBooksV2Value.type).toBe("escaped-object");
    expect(decodeJsonBackupValue(encoded)).toEqual(original);
  });

  it.each([
    { __simpleBooksV2Value:{ version:1,type:"timestamp",seconds:"1",nanoseconds:0 } },
    { __simpleBooksV2Value:{ version:99,type:"timestamp",seconds:1,nanoseconds:0 } },
    { __simpleBooksV2Value:{ version:1,type:"unknown" } },
    { __simpleBooksV2Value:"bad" }
  ])("rejects malformed codec data",value => {
    expect(()=>decodeJsonBackupValue(value)).toThrow(JsonBackupValidationError);
  });

  it("rejects unsupported native object types instead of serializing them implicitly",() => {
    expect(()=>encodeJsonBackupValue(new Date("2026-08-28T12:00:00.000Z"))).toThrow("Unsupported backup value type");
  });
});

describe("JSON Backup V2 restore preflight",() => {
  it("accepts a valid backup and returns a non-mutating summary",() => {
    const result=preflightJsonBackupV2(backup());
    expect(result).toMatchObject({ valid:true,schemaVersion:2,totalRecords:4 });
    expect(result.collectionCounts.invoices).toBe(1);
    expect(result.accountFields).toEqual(["businessName","paymentTermsDefault"]);
  });

  it("rejects the wrong app",() => {
    const value=backup(); value.app="Another App";
    expect(()=>preflightJsonBackupV2(value)).toThrow("Backup app must be Simple Books.");
  });

  it.each([undefined,1,3,"2"])("rejects missing or unsupported schemaVersion %s",schemaVersion => {
    const value=backup(); value.schemaVersion=schemaVersion;
    expect(()=>preflightJsonBackupV2(value)).toThrow("Only schema version 2 is supported.");
  });

  it("rejects malformed record shape",() => {
    const value=copy(backup()); value.collections.invoices[0]={ id:"invoice-1",invoiceNo:"INV-1" };
    expect(()=>preflightJsonBackupV2(value)).toThrow("must have the shape {id, data}");
  });

  it("rejects duplicate IDs",() => {
    const value=copy(backup()); value.collections.invoices.push(copy(value.collections.invoices[0])); value.manifest.collectionCounts.invoices=2;
    expect(()=>preflightJsonBackupV2(value)).toThrow("duplicate document ID");
  });

  it("rejects mismatched manifest counts",() => {
    const value=copy(backup()); value.manifest.collectionCounts.invoices=99;
    expect(()=>preflightJsonBackupV2(value)).toThrow("Manifest count for invoices");
  });

  it("rejects malformed Timestamp markers",() => {
    const value=copy(backup()); value.collections.invoices[0].data.createdAt.__simpleBooksV2Value.nanoseconds=1000000000;
    expect(()=>preflightJsonBackupV2(value)).toThrow("malformed Timestamp marker");
  });

  it("rejects unknown collections",() => {
    const value=copy(backup()); value.collections.internalSecrets=[];
    expect(()=>preflightJsonBackupV2(value)).toThrow("Unknown backup collection: internalSecrets");
  });

  it("rejects unknown top-level and manifest fields",() => {
    const top=copy(backup()); top.legacyData=[];
    expect(()=>preflightJsonBackupV2(top)).toThrow("Unknown top-level backup field: legacyData");
    const manifest=copy(backup()); manifest.manifest.restoreInstructions="trust me";
    expect(()=>preflightJsonBackupV2(manifest)).toThrow("Unknown backup manifest field: restoreInstructions");
  });

  it("rejects obvious dangling relationships",() => {
    const value=copy(backup()); value.collections.expenses[0].data.projectId="missing-project";
    expect(()=>preflightJsonBackupV2(value)).toThrow("references missing project missing-project");
  });

  it("defines an empty destination as no records in any restorable collection",() => {
    expect(backupAccountStateFromCounts({}).empty).toBe(true);
    expect(backupAccountStateFromCounts({ referenceKeys:1 })).toMatchObject({ empty:false,totalRecords:1 });
    expect(backupAccountStateFromCounts({ journals:2 })).toMatchObject({ empty:false,totalRecords:2 });
  });
});

describe("JSON Backup V2 coverage",() => {
  it("covers current business source and integrity collections while excluding transient internals",() => {
    expect(JSON_BACKUP_COLLECTIONS).toEqual([
      "invoices","bills","expenses","mileage","clients","customers","projects","budgets",
      "bankAccounts","bankTransactions","bankIncome","bankReconciliations","bankTransfers",
      "bankTransferLinks","bankExceptionResolutions","journals","referenceKeys"
    ]);
    for(const internal of ["referenceCreateRequests","referenceEditRequests","referenceDeleteRequests","referenceBackfillMigrations","userProfiles"]){
      expect(JSON_BACKUP_COLLECTIONS).not.toContain(internal);
    }
  });

  it("keeps browser and server schema constants in lockstep",()=>{
    expect(serverSchema.JSON_BACKUP_APP).toBe(JSON_BACKUP_APP);
    expect(serverSchema.JSON_BACKUP_SCHEMA_VERSION).toBe(2);
    expect(serverSchema.JSON_BACKUP_COLLECTIONS).toEqual(JSON_BACKUP_COLLECTIONS);
    expect(serverSchema.JSON_BACKUP_ACCOUNT_FIELDS).toEqual(JSON_BACKUP_ACCOUNT_FIELDS);
    expect(serverSchema.JSON_BACKUP_OMISSION_IDS).toEqual(JSON_BACKUP_OMISSIONS.map(item=>item.id));
  });
});
