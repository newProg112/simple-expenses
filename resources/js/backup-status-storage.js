export const LEGACY_BACKUP_STATUS_KEYS = Object.freeze([
  "simpleBooksLastBackupDownloadedAt",
  "simpleBooksBackupDownloaded"
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

export function clearLegacyBackupStatus(storage){
  const target=requiredStorage(storage);
  LEGACY_BACKUP_STATUS_KEYS.forEach(key => target.removeItem(key));
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
