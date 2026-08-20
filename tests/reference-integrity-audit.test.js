import { describe,expect,it } from "vitest";
import { auditReferenceIntegrity } from "../resources/js/reference-integrity-audit.js";

describe("reference integrity audit",() => {
  it("groups Invoice case, punctuation, and spacing variants by the Phase 3A canonical reference",() => {
    const result = auditReferenceIntegrity({
      invoices:[
        { id:"invoice-1",invoiceNo:"INV-001" },
        { id:"invoice-2",invoiceNo:"inv / 001" },
        { id:"invoice-3",invoiceNo:" I N V . 0 0 1 " }
      ]
    });

    expect(result.invoices).toMatchObject({
      totalRecords:3,
      blankReferences:0,
      uniqueCanonicalReferences:0,
      canonicalCollisionGroups:1,
      recordsInCanonicalCollisions:3,
      unsafeReferences:0
    });
    expect(result.invoices.collisionGroups).toEqual([{
      sourceType:"invoice",
      canonicalReference:"inv001",
      visibleReferences:[" I N V . 0 0 1 ","INV-001","inv / 001"],
      documentIds:["invoice-1","invoice-2","invoice-3"],
      count:3
    }]);
  });

  it("uses Unicode NFKC normalization for collision detection",() => {
    const result = auditReferenceIntegrity({
      invoices:[
        { id:"invoice-ascii",invoiceNo:"INV-002" },
        { id:"invoice-fullwidth",invoiceNo:"\uFF29\uFF2E\uFF36\uFF0D\uFF10\uFF10\uFF12" },
        { id:"invoice-composed",invoiceNo:"R\u00C9F-003" },
        { id:"invoice-decomposed",invoiceNo:"RE\u0301F / 003" }
      ]
    });

    expect(result.invoices.collisionGroups).toEqual([
      expect.objectContaining({
        canonicalReference:"inv002",
        documentIds:["invoice-ascii","invoice-fullwidth"],
        count:2
      }),
      expect.objectContaining({
        canonicalReference:"r\u00E9f003",
        documentIds:["invoice-composed","invoice-decomposed"],
        count:2
      })
    ]);
  });

  it("counts blank, numeric-only unsafe, and safe unique references",() => {
    const result = auditReferenceIntegrity({
      invoices:[
        { id:"blank",invoiceNo:"  " },
        { id:"punctuation-only",invoiceNo:" /.- " },
        { id:"numeric",invoiceNo:"123456" },
        { id:"safe",invoiceNo:"INV-900" }
      ]
    });

    expect(result.invoices).toMatchObject({
      totalRecords:4,
      blankReferences:2,
      uniqueCanonicalReferences:2,
      canonicalCollisionGroups:0,
      recordsInCanonicalCollisions:0,
      unsafeReferences:3
    });
  });

  it("audits Invoice legacy fallback, agreeing fields, and canonical conflicts",() => {
    const result = auditReferenceIntegrity({
      invoices:[
        { id:"legacy",invoiceNumber:"LEG-100" },
        { id:"agree",invoiceNo:"INV-200",invoiceNumber:"inv / 200" },
        { id:"conflict",invoiceNo:"INV-300",invoiceNumber:"OLD-300" }
      ]
    });

    expect(result.invoices).toMatchObject({
      totalRecords:3,
      uniqueCanonicalReferences:3,
      legacyFallbackRecords:1,
      bothReferenceFieldsRecords:2,
      conflictingReferenceFieldsRecords:1
    });
  });

  it("audits equivalent Bill invoiceNumber fallback and duplicate references",() => {
    const result = auditReferenceIntegrity({
      bills:[
        { id:"bill-1",billNumber:"BILL-001" },
        { id:"bill-2",billNumber:"bill / 001" },
        { id:"bill-legacy",invoiceNumber:"SUP-900" },
        { id:"bill-agree",billNumber:"SUP-901",invoiceNumber:"sup.901" },
        { id:"bill-conflict",billNumber:"SUP-902",invoiceNumber:"OLD-902" }
      ]
    });

    expect(result.bills).toMatchObject({
      totalRecords:5,
      uniqueCanonicalReferences:3,
      canonicalCollisionGroups:1,
      recordsInCanonicalCollisions:2,
      legacyFallbackRecords:1,
      bothReferenceFieldsRecords:2,
      conflictingReferenceFieldsRecords:1
    });
    expect(result.bills.collisionGroups[0]).toEqual({
      sourceType:"bill",
      canonicalReference:"bill001",
      visibleReferences:["BILL-001","bill / 001"],
      documentIds:["bill-1","bill-2"],
      count:2
    });
  });

  it("keeps Invoice and Bill canonical namespaces separate",() => {
    const result = auditReferenceIntegrity({
      invoices:[{ id:"invoice-1",invoiceNo:"SHARED-001" }],
      bills:[{ id:"bill-1",billNumber:"shared / 001" }]
    });

    expect(result.invoices).toMatchObject({ uniqueCanonicalReferences:1,canonicalCollisionGroups:0 });
    expect(result.bills).toMatchObject({ uniqueCanonicalReferences:1,canonicalCollisionGroups:0 });
  });

  it("returns deterministic frozen diagnostics without changing its inputs",() => {
    const sources = {
      invoices:[{ id:"z",invoiceNo:"INV-500" },{ id:"a",invoiceNo:"inv.500" }],
      bills:[]
    };
    const before = structuredClone(sources);
    const result = auditReferenceIntegrity(sources);

    expect(sources).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.invoices)).toBe(true);
    expect(Object.isFrozen(result.invoices.collisionGroups)).toBe(true);
    expect(Object.isFrozen(result.invoices.collisionGroups[0].documentIds)).toBe(true);
    expect(result.invoices.collisionGroups[0].documentIds).toEqual(["a","z"]);
  });
});
