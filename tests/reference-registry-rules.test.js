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

  it.each(["referenceCreateRequests","referenceEditRequests","referenceBackfillMigrations"])("denies all browser access to internal %s documents",collection => {
    const block=rules.match(new RegExp(`match /users/\\{uid\\}/${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n    \\}`))?.[1] || "";
    expect(block).toContain("allow read, write: if false;");
  });

  it("excludes both server-owned collections from the recursive owner write grant",() => {
    expect(rules).toContain("match /users/{uid}/{collectionName}/{document=**}");
    expect(rules).toContain("collectionName != 'referenceKeys'");
    expect(rules).toContain("collectionName != 'referenceCreateRequests'");
    expect(rules).toContain("collectionName != 'referenceEditRequests'");
    expect(rules).toContain("collectionName != 'referenceBackfillMigrations'");
  });
});
