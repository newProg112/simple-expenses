import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

const html=readFileSync(new URL("../exports.html",import.meta.url),"utf8");
const importStart=html.indexOf("function importFullBackup(event)");
const importEnd=html.indexOf("function initialiseAccountantPackUi",importStart);
const importSource=html.slice(importStart,importEnd);

describe("JSON Backup V2 page integration",() => {
  it("loads the reusable schema and creates a V2-named download",() => {
    expect(html).toContain('/resources/js/json-backup-schema.js?v=20260828-json-backup-v2');
    expect(html).toContain("window.simpleBooksJsonBackupV2");
    expect(html).toContain("simple-books-backup-v2-");
  });

  it("exports safe record envelopes and owner-filtered journals",() => {
    expect(html).toContain("return snapshot.docs.map(item => ({ id: item.id, data: item.data() }))");
    expect(html).toContain('services.collection(services.db, "journals")');
    expect(html).toContain('services.where("userId", "==", user.uid)');
  });

  it("runs preflight and delegates restore writes exclusively to the authenticated callable",() => {
    expect(importSource).toContain("backupModule.preflight(backup)");
    expect(importSource).toContain("inspectCurrentBackupAccountState(user, services)");
    expect(importSource).not.toMatch(/localStorage\.setItem|setDoc\(|addDoc\(|writeBatch\(|runTransaction\(|deleteDoc\(|updateDoc\(/);
    expect(html).toContain('httpsCallable(functions, "restoreJsonBackupV2"');
    expect(html).toContain("restoreSelectedJsonBackup");
    expect(html).toContain('outcome?.status !== "completed" || outcome?.verified !== true');
    expect(html).toContain("window.location.reload()");
    expect(html).not.toContain("Backup imported successfully");
  });

  it("records Last Restore only after verified completion and gives persistent post-reload confirmation",()=>{
    const restoreStart=html.indexOf("async function restoreSelectedJsonBackup()");
    const restoreEnd=html.indexOf("function importFullBackup(event)",restoreStart);
    const restoreSource=html.slice(restoreStart,restoreEnd);
    const verifiedGuard=restoreSource.indexOf('outcome?.status !== "completed" || outcome?.verified !== true');
    const statusWrite=restoreSource.indexOf("await saveLastRestoreCompletedAt(new Date().toISOString())");
    expect(verifiedGuard).toBeGreaterThan(-1);
    expect(statusWrite).toBeGreaterThan(verifiedGuard);
    expect(restoreSource.slice(0,verifiedGuard)).not.toContain("saveLastRestoreCompletedAt(");
    expect(restoreSource.slice(statusWrite)).toContain("window.location.reload()");
    expect(restoreSource).not.toContain("setTimeout");
    expect(html).toContain('<span class="muted">Last restore</span>');
    expect(html).toContain('<strong id="lastRestoreStatus">Not yet restored</strong>');
  });

  it("keeps operational export KPI metadata outside JSON business backup data",()=>{
    expect(html).toContain("lastAccountantPackGeneratedAt");
    expect(html).toContain("lastRestoreCompletedAt");
    expect(html).not.toContain('account: { lastRestoreCompletedAt');
  });

  it("offers restore only for an empty account and warns about merge and Storage omissions",()=>{
    expect(html).toContain("if(!accountState.empty)");
    expect(html).toContain("V2 restore cannot merge");
    expect(html).toContain("Storage attachments and company-logo files are not included");
    expect(html).toContain("crypto.randomUUID()");
  });

  it("does not retain the obsolete full-backup localStorage fallback",() => {
    const builderStart=html.indexOf("async function buildFullBackupData()");
    const builderEnd=html.indexOf("async function readFirestoreCollection",builderStart);
    const builderSource=html.slice(builderStart,builderEnd);
    expect(builderSource).not.toContain('localStorage.getItem("simpleBooksInvoices")');
    expect(builderSource).not.toContain('localStorage.getItem("simpleBooksAccount")');
  });
});
