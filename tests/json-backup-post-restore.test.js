import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {
  LEGACY_BUSINESS_CACHE_KEYS,
  clearLegacyBusinessCachesAfterRestore
} from "../resources/js/json-backup-post-restore.js";

const exportsHtml=readFileSync(new URL("../exports.html",import.meta.url),"utf8");
const restoreService=readFileSync(new URL("../functions/lib/json-backup-restore-service.js",import.meta.url),"utf8");
const dashboard=readFileSync(new URL("../dashboard.html",import.meta.url),"utf8");

class MemoryStorage {
  constructor(){this.values=new Map();}
  getItem(key){return this.values.get(key) ?? null;}
  setItem(key,value){this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
}

describe("JSON restore completion and page refresh",()=>{
  it("clears only known legacy business caches after verified completion",()=>{
    const storage=new MemoryStorage();
    LEGACY_BUSINESS_CACHE_KEYS.forEach(key=>storage.setItem(key,"stale"));
    storage.setItem("unrelatedPreference","keep");
    clearLegacyBusinessCachesAfterRestore(storage);
    LEGACY_BUSINESS_CACHE_KEYS.forEach(key=>expect(storage.getItem(key)).toBeNull());
    expect(storage.getItem("unrelatedPreference")).toBe("keep");
  });

  it("invalidates caches and reloads only after completed and verified status",()=>{
    const statusCheck=exportsHtml.indexOf('outcome?.status !== "completed" || outcome?.verified !== true');
    const invalidation=exportsHtml.indexOf("clearLegacyBusinessCaches(localStorage)",statusCheck);
    const reload=exportsHtml.indexOf("window.location.reload()",invalidation);
    expect(statusCheck).toBeGreaterThan(-1);
    expect(invalidation).toBeGreaterThan(statusCheck);
    expect(reload).toBeGreaterThan(invalidation);
  });

  it("marks the restore completed only after awaited verification",()=>{
    const verification=restoreService.indexOf("const verification = await verifyRestore");
    const completedWrite=restoreService.indexOf('status: "completed"',verification);
    const completedReturn=restoreService.indexOf('return {status: "completed"',completedWrite);
    expect(verification).toBeGreaterThan(-1);
    expect(completedWrite).toBeGreaterThan(verification);
    expect(completedReturn).toBeGreaterThan(completedWrite);
  });

  it("waits for authentication and replaces cache seeds with Firestore results before dashboard rendering",()=>{
    const loadStart=dashboard.indexOf("async function loadDashboard()");
    const authReady=dashboard.indexOf("const user = await getDashboardUser()",loadStart);
    const firestoreRead=dashboard.indexOf('collection(db, "users", user.uid, "invoices")',authReady);
    const render=dashboard.indexOf('document.getElementById("outstandingTotal").textContent',firestoreRead);
    expect(authReady).toBeGreaterThan(loadStart);
    expect(firestoreRead).toBeGreaterThan(authReady);
    expect(render).toBeGreaterThan(firestoreRead);
  });
});
