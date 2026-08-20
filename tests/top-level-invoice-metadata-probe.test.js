import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {describe, expect, it} from "vitest";

const require = createRequire(import.meta.url);
const {
  MAX_TOP_LEVEL_INVOICE_DOCUMENTS,
  TOP_LEVEL_INVOICE_COLLECTION,
  createTopLevelInvoiceMetadataAdapter,
} = require("../scripts/lib/top-level-invoice-metadata-adapter.cjs");
const {
  HISTORICAL_WRITER_WINDOW,
  createTopLevelInvoiceMetadataProbe,
  historicalComparison,
} = require("../scripts/lib/top-level-invoice-metadata-probe.cjs");

const expected = "d95e98a89f89072a9690ba4b8fb906e7daf2d8c73a3f22259b8575a2306e6af4";
const hash = (value) => createHash("sha256").update(value,"utf8").digest("hex");
const metadata = (pathHash=expected, createTime="2026-05-20T12:00:00.000Z") => Object.freeze({
  pathHash,createTime,updateTime:"2026-05-20T12:01:00.000Z"
});
const adapter = (documents) => Object.freeze({readTopLevelInvoices:async()=>Object.freeze(documents)});

describe("top-level invoice metadata probe service",()=>{
  it("has one immutable collection and a fixed cap of two",()=>{
    expect(TOP_LEVEL_INVOICE_COLLECTION).toBe("invoices");
    expect(MAX_TOP_LEVEL_INVOICE_DOCUMENTS).toBe(2);
  });

  it("reports zero, one matching, one mismatching, and multiple safely",async()=>{
    const zero=await createTopLevelInvoiceMetadataProbe(adapter([]),{
      projectId:"demo-simple-books",expectedPathHash:expected
    });
    expect(zero.result).toMatchObject({documentsObserved:0,cardinalityStatus:"zero",cardinalityComplete:true});

    const one=await createTopLevelInvoiceMetadataProbe(adapter([metadata()]),{
      projectId:"demo-simple-books",expectedPathHash:expected
    });
    expect(one.result).toMatchObject({
      documentsObserved:1,expectedHashMatches:1,unexpectedHashMatches:0,
      cardinalityStatus:"exactly-one",provenanceInterpretation:"timestamp-comparison-only"
    });
    expect(one.documents[0]).toMatchObject({
      matchesExpectedPathHash:true,createdOn2026May20:true,createdWithinHistoricalWriterWindow:true
    });

    const mismatchHash=hash("invoices/not-the-known-document");
    const mismatch=await createTopLevelInvoiceMetadataProbe(adapter([metadata(mismatchHash)]),{
      projectId:"demo-simple-books",expectedPathHash:expected
    });
    expect(mismatch.result).toMatchObject({expectedHashMatches:0,unexpectedHashMatches:1});
    expect(mismatch.documents[0].matchesExpectedPathHash).toBe(false);

    const multiple=await createTopLevelInvoiceMetadataProbe(adapter([metadata(),metadata(mismatchHash)]),{
      projectId:"demo-simple-books",expectedPathHash:expected
    });
    expect(multiple.result).toMatchObject({
      documentsObserved:2,cardinalityStatus:"multiple-observed-at-cap",cardinalityComplete:false,
      provenanceInterpretation:"refused-multiple-documents"
    });
    expect(multiple.artifact.status).toBe("complete");
  });

  it("uses the fixed Europe/London historical day and makes no causal claim",()=>{
    expect(HISTORICAL_WRITER_WINDOW).toEqual({
      timezone:"Europe/London (BST, UTC+01:00)",
      start:"2026-05-20T00:00:00+01:00",
      endExclusive:"2026-05-21T00:00:00+01:00"
    });
    expect(historicalComparison("2026-05-19T23:00:00.000Z")).toEqual({
      createdOn2026May20:true,createdWithinHistoricalWriterWindow:true
    });
    expect(historicalComparison("2026-05-20T22:59:59.999Z").createdWithinHistoricalWriterWindow).toBe(true);
    expect(historicalComparison("2026-05-20T23:00:00.000Z").createdWithinHistoricalWriterWindow).toBe(false);
    expect(historicalComparison("invalid").createdWithinHistoricalWriterWindow).toBe("unknown");
  });

  it("fails closed with sanitized output for adapter errors or invalid metadata",async()=>{
    const failing=Object.freeze({readTopLevelInvoices:async()=>{
      throw Object.assign(new Error("users/private/invoices/INV-SECRET client@example.test"),{code:7});
    }});
    const report=await createTopLevelInvoiceMetadataProbe(failing,{
      projectId:"demo-simple-books",expectedPathHash:expected
    });
    expect(report.artifact.status).toBe("incomplete");
    expect(report.failure).toEqual({
      code:"top-level-invoice-metadata-read-failed",errorCategory:"permission-denied"
    });
    expect(JSON.stringify(report)).not.toMatch(/INV-SECRET|client@example|users\/private/);

    const tooMany=await createTopLevelInvoiceMetadataProbe(adapter([
      metadata(),metadata(hash("invoices/two")),metadata(hash("invoices/three"))
    ]),{projectId:"demo-simple-books",expectedPathHash:expected});
    expect(tooMany.artifact.status).toBe("incomplete");
    expect(tooMany.documents).toEqual([]);
  });

  it("requires the exact single-method adapter and a lowercase SHA-256 expectation",async()=>{
    await expect(createTopLevelInvoiceMetadataProbe({...adapter([]),set(){}},{expectedPathHash:expected}))
      .rejects.toThrow("exact top-level invoice read-only adapter");
    await expect(createTopLevelInvoiceMetadataProbe(adapter([]),{expectedPathHash:"bad"}))
      .rejects.toThrow("64 lowercase hexadecimal");
    await expect(createTopLevelInvoiceMetadataProbe(adapter([]),{expectedPathHash:expected.toUpperCase()}))
      .rejects.toThrow("64 lowercase hexadecimal");
  });
});

describe("top-level invoice metadata adapter",()=>{
  it("uses one empty projection query and never accesses document data",async()=>{
    const calls=[];
    const timestamp=(iso)=>({toDate:()=>new Date(iso)});
    const snapshots=[{
      ref:{path:"invoices/private-document-id"},
      createTime:timestamp("2026-05-20T10:00:00.000Z"),
      updateTime:timestamp("2026-05-20T11:00:00.000Z"),
      data(){throw new Error("business data must not be accessed");}
    }];
    const query={
      select(...fields){calls.push(["select",...fields]);return this;},
      orderBy(field){calls.push(["orderBy",field]);return this;},
      limit(value){calls.push(["limit",value]);return this;},
      async get(){calls.push(["get"]);return {docs:snapshots};}
    };
    const firestore={collection(name){calls.push(["collection",name]);return query;}};
    const readAdapter=createTopLevelInvoiceMetadataAdapter(firestore,{documentId:()=>"__name__"});
    expect(Object.keys(readAdapter)).toEqual(["readTopLevelInvoices"]);
    expect(Object.isFrozen(readAdapter)).toBe(true);
    const result=await readAdapter.readTopLevelInvoices();
    expect(calls).toEqual([
      ["collection","invoices"],["select"],["orderBy","__name__"],["limit",2],["get"]
    ]);
    expect(result).toEqual([{
      pathHash:hash("invoices/private-document-id"),
      createTime:"2026-05-20T10:00:00.000Z",updateTime:"2026-05-20T11:00:00.000Z"
    }]);
    expect(JSON.stringify(result)).not.toContain("private-document-id");
  });
});
