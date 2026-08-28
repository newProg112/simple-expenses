export const LEGACY_BUSINESS_CACHE_KEYS = Object.freeze([
  "simpleBooksInvoices",
  "simpleBooksBills",
  "simpleBooksClients",
  "simpleBooksCustomers",
  "simpleBooksExpenses"
]);

export function clearLegacyBusinessCachesAfterRestore(storage){
  if(!storage || typeof storage.removeItem !== "function"){
    throw new TypeError("A browser storage implementation is required.");
  }
  LEGACY_BUSINESS_CACHE_KEYS.forEach(key => storage.removeItem(key));
}
