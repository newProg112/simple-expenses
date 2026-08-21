const IMPORTABLE_STATUSES = new Set(["Unpaid", "Paid"]);

function invoiceReference(invoice){
  return String(invoice?.invoiceNo || "").trim().toLowerCase();
}

function duplicateCreateError(error){
  return error?.code === "functions/already-exists";
}

export function invoiceCreatePayloadFromBackup(invoice = {}){
  const status = invoice.status || "Unpaid";
  if(!IMPORTABLE_STATUSES.has(status)){
    throw new TypeError("The backup Invoice status is invalid.");
  }

  return {
    invoiceNo: typeof invoice.invoiceNo === "string" ? invoice.invoiceNo : "",
    client: typeof invoice.client === "string" ? invoice.client : "",
    clientEmail: typeof invoice.clientEmail === "string" ? invoice.clientEmail : "",
    clientAddress: typeof invoice.clientAddress === "string" ? invoice.clientAddress : "",
    paymentTerms: typeof invoice.paymentTerms === "string" ? invoice.paymentTerms : "",
    dueDate: typeof invoice.dueDate === "string" ? invoice.dueDate : "",
    amount: invoice.amount,
    vat: invoice.vat,
    total: invoice.total,
    items: Array.isArray(invoice.items)
      ? invoice.items.map(item => ({ description: item?.description, amount: item?.amount }))
      : [],
    status: "Unpaid",
    date: typeof invoice.date === "string" ? invoice.date : "",
    recurringInvoice: typeof invoice.recurringInvoice === "string"
      ? invoice.recurringInvoice
      : "No",
    recurringFrequency: typeof invoice.recurringFrequency === "string"
      ? invoice.recurringFrequency
      : "",
    nextInvoiceDate: typeof invoice.nextInvoiceDate === "string"
      ? invoice.nextInvoiceDate
      : "",
    reminderDate: typeof invoice.reminderDate === "string" ? invoice.reminderDate : "",
    projectId: typeof invoice.projectId === "string" ? invoice.projectId : "",
    projectName: typeof invoice.projectName === "string" ? invoice.projectName : "",
    projectReference: typeof invoice.projectReference === "string"
      ? invoice.projectReference
      : ""
  };
}

export async function importInvoicesWithProtectedCreate(options = {}){
  if(!Array.isArray(options.invoices)){
    throw new TypeError("Invoice backup records are required.");
  }
  if(typeof options.createInvoice !== "function"){
    throw new TypeError("A protected Invoice create operation is required.");
  }
  if(typeof options.updateStatus !== "function"){
    throw new TypeError("An Invoice status update operation is required.");
  }

  const existingReferences = new Set(
    (options.existingInvoices || []).map(invoiceReference).filter(Boolean)
  );
  const result = {
    importedCount: 0,
    skippedDuplicateCount: 0,
    failedCount: 0,
    statusRestoreFailedCount: 0,
    failures: []
  };

  for(const invoice of options.invoices){
    const reference = invoiceReference(invoice);
    if(reference && existingReferences.has(reference)){
      result.skippedDuplicateCount += 1;
      continue;
    }

    let payload;
    let sourceId;
    try{
      payload = invoiceCreatePayloadFromBackup(invoice);
      sourceId = await options.createInvoice(payload);
    }catch(error){
      if(duplicateCreateError(error)){
        result.skippedDuplicateCount += 1;
        continue;
      }
      result.failedCount += 1;
      result.failures.push({ reference: String(invoice?.invoiceNo || ""), error });
      continue;
    }

    result.importedCount += 1;
    if(reference) existingReferences.add(reference);

    if(invoice.status === "Paid"){
      try{
        await options.updateStatus(sourceId, "Paid");
      }catch(error){
        result.statusRestoreFailedCount += 1;
        result.failures.push({ reference: String(invoice?.invoiceNo || ""), error });
      }
    }
  }

  return result;
}
