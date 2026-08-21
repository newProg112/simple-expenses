import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rules=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");

describe("server-owned reference rule boundary",() => {
  it("denies registry writes while retaining owner reads",() => {
    const collection="referenceKeys";
    const block=rules.match(new RegExp(`match /users/\\{uid\\}/${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`))?.[1] || "";
    expect(block).toContain("allow read: if isOwner(uid);");
    expect(block).toContain("allow write: if false;");
  });

  it.each(["referenceCreateRequests","referenceEditRequests","referenceDeleteRequests","referenceBackfillMigrations"])("denies all browser access to internal %s documents",collection => {
    const block=rules.match(new RegExp(`match /users/\\{uid\\}/${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`))?.[1] || "";
    expect(block).toContain("allow read, write: if false;");
  });

  it("excludes server-owned and lifecycle-controlled collections from the recursive owner write grant",() => {
    expect(rules).toContain("match /users/{uid}/{collectionName}/{document=**}");
    expect(rules).toContain("collectionName != 'referenceKeys'");
    expect(rules).toContain("collectionName != 'referenceCreateRequests'");
    expect(rules).toContain("collectionName != 'referenceEditRequests'");
    expect(rules).toContain("collectionName != 'referenceDeleteRequests'");
    expect(rules).toContain("collectionName != 'referenceBackfillMigrations'");
    expect(rules).toContain("collectionName != 'invoices'");
    expect(rules).toContain("collectionName != 'bills'");
  });

  it.each(["invoices","bills"])("denies direct %s create/delete and limits updates to an allowlist",collection => {
    const block=rules.match(new RegExp(`match /users/\\{uid\\}/${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`))?.[1] || "";
    expect(block).toContain("allow create, delete: if false;");
    expect(block).toMatch(/affectedKeys\(\)\s*\.hasOnly\(/);
  });
});
