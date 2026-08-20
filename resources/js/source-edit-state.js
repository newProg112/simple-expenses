const STATE_FIELDS = Object.freeze({
  invoice:Object.freeze([
    "invoiceNo","client","clientEmail","clientAddress","paymentTerms","dueDate",
    "amount","vat","total","items","status","date","recurringInvoice",
    "recurringFrequency","nextInvoiceDate","reminderDate","projectId","projectName",
    "projectReference","businessName","businessEmail","businessWebsite","businessVat",
    "invoiceNumber","createdAt","updatedAt","paidAt","bankSettlement"
  ]),
  bill:Object.freeze([
    "id","supplier","billNumber","billDate","dueDate","category","net","vatRate","vat",
    "total","status","notes","projectId","projectName","projectReference",
    "attachmentName","attachmentUrl","attachmentPath","attachmentSize","attachmentType",
    "invoiceNumber","createdAt","updatedAt","paidAt","bankSettlement"
  ])
});

function cloneValue(value){
  if(Array.isArray(value)) return value.map(cloneValue);
  if(value && typeof value === "object"){
    return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,cloneValue(item)]));
  }
  return value;
}

export function sourceEditExpectedState(recordType,source){
  const fields=STATE_FIELDS[recordType];
  if(!fields || !source || typeof source !== "object" || Array.isArray(source)){
    throw new TypeError("A supported source record is required.");
  }
  const state={};
  fields.forEach(field => {
    if(Object.prototype.hasOwnProperty.call(source,field)) state[field]=cloneValue(source[field]);
  });
  return state;
}
