import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditReferenceIntegrity } from "../resources/js/reference-integrity-audit.js";

const inputPath = process.argv[2];

if(!inputPath){
  throw new Error("Usage: node scripts/audit-reference-integrity.mjs <simple-books-backup.json>");
}

const backup = JSON.parse(await readFile(resolve(inputPath),"utf8"));

if(!Array.isArray(backup?.invoices) || !Array.isArray(backup?.bills)){
  throw new Error("The input must contain Invoice and Bill arrays from a Simple Books backup.");
}

const audit = auditReferenceIntegrity({
  invoices:backup.invoices,
  bills:backup.bills
});

process.stdout.write(`${JSON.stringify(audit,null,2)}\n`);
