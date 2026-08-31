export const LEGACY_BACKUP_STATUS_KEYS = Object.freeze([
  "simpleBooksLastBackupDownloadedAt",
  "simpleBooksBackupDownloaded"
]);

export const LEGACY_EXPORT_STATUS_KEYS = Object.freeze([
  ...LEGACY_BACKUP_STATUS_KEYS,
  "simpleBooksLastAccountantPackGeneratedAt",
  "simpleBooksLastRestoreCompletedAt"
]);

function requiredUid(uid){
  const value=String(uid || "").trim();
  if(!value) throw new TypeError("An authenticated user ID is required.");
  return value;
}

function requiredStorage(storage){
  if(!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function"){
    throw new TypeError("A browser storage implementation is required.");
  }
  return storage;
}

export function backupStatusStorageKeys(uid){
  const owner=encodeURIComponent(requiredUid(uid));
  return Object.freeze({
    downloadedAt:`simpleBooksLastBackupDownloadedAt:${owner}`,
    downloaded:`simpleBooksBackupDownloaded:${owner}`
  });
}

export function exportStatusStorageKeys(uid){
  const owner=encodeURIComponent(requiredUid(uid));
  return Object.freeze({
    accountantPackGeneratedAt:`simpleBooksLastAccountantPackGeneratedAt:${owner}`,
    restoreCompletedAt:`simpleBooksLastRestoreCompletedAt:${owner}`
  });
}

export function clearLegacyBackupStatus(storage){
  const target=requiredStorage(storage);
  LEGACY_BACKUP_STATUS_KEYS.forEach(key => target.removeItem(key));
}

export function clearLegacyExportStatus(storage){
  const target=requiredStorage(storage);
  LEGACY_EXPORT_STATUS_KEYS.forEach(key => target.removeItem(key));
}

function writeScopedTimestamp(storage,key,timestamp){
  const target=requiredStorage(storage);
  const value=String(timestamp || "");
  if(!value || Number.isNaN(Date.parse(value))) throw new TypeError("A valid status timestamp is required.");
  target.setItem(key,value);
  clearLegacyExportStatus(target);
  return value;
}

function readScopedTimestamp(storage,key){
  const value=requiredStorage(storage).getItem(key);
  return value && !Number.isNaN(Date.parse(value)) ? value : "";
}

export function writeLastBackupDownloadedAt(storage,uid,timestamp){
  const target=requiredStorage(storage);
  const value=String(timestamp || "");
  if(!value || Number.isNaN(Date.parse(value))) throw new TypeError("A valid backup timestamp is required.");
  target.setItem(backupStatusStorageKeys(uid).downloadedAt,value);
  clearLegacyBackupStatus(target);
  return value;
}

export function readLastBackupDownloadedAt(storage,uid){
  const value=requiredStorage(storage).getItem(backupStatusStorageKeys(uid).downloadedAt);
  return value && !Number.isNaN(Date.parse(value)) ? value : "";
}

export function markBackupDownloaded(storage,uid){
  const target=requiredStorage(storage);
  target.setItem(backupStatusStorageKeys(uid).downloaded,"true");
  clearLegacyBackupStatus(target);
}

export function wasBackupDownloaded(storage,uid){
  return requiredStorage(storage).getItem(backupStatusStorageKeys(uid).downloaded) === "true";
}

export function writeLastAccountantPackGeneratedAt(storage,uid,timestamp){
  return writeScopedTimestamp(storage,exportStatusStorageKeys(uid).accountantPackGeneratedAt,timestamp);
}

export function readLastAccountantPackGeneratedAt(storage,uid){
  return readScopedTimestamp(storage,exportStatusStorageKeys(uid).accountantPackGeneratedAt);
}

export function writeLastRestoreCompletedAt(storage,uid,timestamp){
  return writeScopedTimestamp(storage,exportStatusStorageKeys(uid).restoreCompletedAt,timestamp);
}

export function readLastRestoreCompletedAt(storage,uid){
  return readScopedTimestamp(storage,exportStatusStorageKeys(uid).restoreCompletedAt);
}
