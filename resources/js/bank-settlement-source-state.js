export const BANK_SETTLEMENT_STATUS_MESSAGE =
  "This record is matched to a bank transaction. Unmatch it in Banking before changing its payment status.";

export function isBankingSettledSource(record){
  const marker = record?.bankSettlement;
  return Boolean(
    marker &&
    Number(marker.version) === 1 &&
    String(marker.transactionId || "").trim() &&
    String(marker.journalId || "").trim()
  );
}

export function sourceStatusForSave(record,requestedStatus){
  return isBankingSettledSource(record)
    ? String(record?.status || "Paid")
    : String(requestedStatus || "");
}
