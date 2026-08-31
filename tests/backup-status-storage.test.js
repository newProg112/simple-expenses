import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {
  LEGACY_BACKUP_STATUS_KEYS,
  LEGACY_EXPORT_STATUS_KEYS,
  backupStatusStorageKeys,
  clearLegacyBackupStatus,
  clearLegacyExportStatus,
  exportStatusStorageKeys,
  markBackupDownloaded,
  readLastAccountantPackGeneratedAt,
  readLastBackupDownloadedAt,
  readLastRestoreCompletedAt,
  wasBackupDownloaded,
  writeLastAccountantPackGeneratedAt,
  writeLastBackupDownloadedAt,
  writeLastRestoreCompletedAt
} from "../resources/js/backup-status-storage.js";

const exportsHtml=readFileSync(new URL("../exports.html",import.meta.url),"utf8");
const dashboardHtml=readFileSync(new URL("../dashboard.html",import.meta.url),"utf8");

class MemoryStorage {
  constructor(entries={}){this.values=new Map(Object.entries(entries));}
  getItem(key){return this.values.has(key)?this.values.get(key):null;}
  setItem(key,value){this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
}

describe("account-scoped backup status",()=>{
  it("isolates timestamps and downloaded flags between authenticated users",()=>{
    const storage=new MemoryStorage();
    writeLastBackupDownloadedAt(storage,"user-a","2026-08-28T07:56:00.000Z");
    markBackupDownloaded(storage,"user-a");
    expect(readLastBackupDownloadedAt(storage,"user-a")).toBe("2026-08-28T07:56:00.000Z");
    expect(wasBackupDownloaded(storage,"user-a")).toBe(true);
    expect(readLastBackupDownloadedAt(storage,"user-b")).toBe("");
    expect(wasBackupDownloaded(storage,"user-b")).toBe(false);
  });

  it("preserves the same user's status across a new storage helper/page instance",()=>{
    const storage=new MemoryStorage();
    writeLastBackupDownloadedAt(storage,"user-a","2026-08-28T07:56:00.000Z");
    expect(readLastBackupDownloadedAt(storage,"user-a")).toBe("2026-08-28T07:56:00.000Z");
    expect(backupStatusStorageKeys("user-a").downloadedAt).toContain(":user-a");
  });

  it("never reads legacy unscoped values for an authenticated user",()=>{
    const storage=new MemoryStorage({
      simpleBooksLastBackupDownloadedAt:"2026-08-28T07:56:00.000Z",
      simpleBooksBackupDownloaded:"true"
    });
    expect(readLastBackupDownloadedAt(storage,"user-b")).toBe("");
    expect(wasBackupDownloaded(storage,"user-b")).toBe(false);
    clearLegacyBackupStatus(storage);
    LEGACY_BACKUP_STATUS_KEYS.forEach(key=>expect(storage.getItem(key)).toBeNull());
  });

  it("removes stale legacy values whenever scoped status is written",()=>{
    const storage=new MemoryStorage({simpleBooksLastBackupDownloadedAt:"old",simpleBooksBackupDownloaded:"true"});
    writeLastBackupDownloadedAt(storage,"user-a","2026-08-28T08:00:00.000Z");
    markBackupDownloaded(storage,"user-a");
    LEGACY_BACKUP_STATUS_KEYS.forEach(key=>expect(storage.getItem(key)).toBeNull());
  });

  it("clears the visible KPI on account change and uses scoped status in Exports and Dashboard",()=>{
    expect(exportsHtml).toContain("window.renderLastBackupStatus?.(null)");
    expect(exportsHtml).toContain("statusStorage.readDownloadedAt(localStorage, user.uid)");
    expect(exportsHtml).not.toContain('localStorage.getItem("simpleBooksLastBackupDownloadedAt")');
    expect(dashboardHtml).toContain("wasBackupDownloaded(localStorage, user.uid)");
    expect(dashboardHtml).not.toContain('localStorage.getItem("simpleBooksBackupDownloaded")');
  });

  it("isolates Accountant Pack and restore timestamps while preserving same-user reloads",()=>{
    const storage=new MemoryStorage();
    writeLastAccountantPackGeneratedAt(storage,"user-a","2026-08-30T12:00:00.000Z");
    writeLastRestoreCompletedAt(storage,"user-a","2026-08-31T09:30:00.000Z");
    expect(readLastAccountantPackGeneratedAt(storage,"user-a")).toBe("2026-08-30T12:00:00.000Z");
    expect(readLastRestoreCompletedAt(storage,"user-a")).toBe("2026-08-31T09:30:00.000Z");
    expect(readLastAccountantPackGeneratedAt(storage,"user-b")).toBe("");
    expect(readLastRestoreCompletedAt(storage,"user-b")).toBe("");
    expect(exportStatusStorageKeys("user-a").restoreCompletedAt).toContain(":user-a");
  });

  it("never reads and actively removes legacy unscoped export KPI values",()=>{
    const storage=new MemoryStorage({
      simpleBooksLastAccountantPackGeneratedAt:"2026-08-30T12:00:00.000Z",
      simpleBooksLastRestoreCompletedAt:"2026-08-31T09:30:00.000Z"
    });
    expect(readLastAccountantPackGeneratedAt(storage,"user-b")).toBe("");
    expect(readLastRestoreCompletedAt(storage,"user-b")).toBe("");
    clearLegacyExportStatus(storage);
    LEGACY_EXPORT_STATUS_KEYS.forEach(key=>expect(storage.getItem(key)).toBeNull());
  });

  it("clears all account-specific visible KPIs before loading an account switch",()=>{
    expect(exportsHtml).toContain("window.renderLastBackupStatus?.(null)");
    expect(exportsHtml).toContain("window.updateAccountantPackGeneratedStatus?.(null)");
    expect(exportsHtml).toContain("window.renderLastRestoreStatus?.(null)");
    expect(exportsHtml).toContain("void window.loadAccountantPackGeneratedAt?.()");
    expect(exportsHtml).toContain("void window.loadLastRestoreCompletedAt?.()");
    expect(exportsHtml).not.toContain('localStorage.getItem("simpleBooksLastAccountantPackGeneratedAt")');
    expect(exportsHtml).not.toContain('localStorage.getItem("simpleBooksLastRestoreCompletedAt")');
  });
});
