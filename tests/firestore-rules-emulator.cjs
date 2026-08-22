"use strict";

const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");

const projectId = "demo-simple-books";
const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const base = `http://${host}/v1/projects/${projectId}/databases/(default)/documents`;

function unsignedToken(uid) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({alg:"none",typ:"JWT"})}.${encode({sub:uid,user_id:uid,aud:projectId,iss:`https://securetoken.google.com/${projectId}`,iat:1,exp:4102444800})}.`;
}

async function request(path,uid,options={}) {
  return fetch(`${base}/${path}`,{
    ...options,
    headers:{
      Authorization:`Bearer ${unsignedToken(uid)}`,
      "Content-Type":"application/json",
      ...(options.headers || {})
    }
  });
}

async function main() {
  if (!admin.apps.length) admin.initializeApp({projectId});
  const db=admin.firestore();
  await db.doc("users/owner").set({uid:"owner",demoMode:false});
  await db.doc("users/other").set({uid:"other",demoMode:false});
  await db.doc("users/owner/referenceKeys/key-1").set({state:"active"});
  await db.doc("users/owner/referenceCreateRequests/request-1").set({operation:"create"});
  await db.doc("users/owner/referenceEditRequests/request-1").set({operation:"edit"});
  await db.doc("users/owner/referenceDeleteRequests/request-1").set({operation:"delete"});
  await db.doc("users/owner/referenceBackfillMigrations/migration-1").set({status:"complete"});
  await db.doc("users/owner/invoices/invoice-1").set({invoiceNo:"INV-001",invoiceNumber:"INV-001",status:"Unpaid",amount:100,updatedAt:"old"});
  await db.doc("users/owner/bills/bill-1").set({billNumber:"BILL-001",invoiceNumber:"BILL-001",status:"Unpaid",total:120,updatedAt:"old",attachmentName:""});

  for(const collection of ["invoices","bills"]){
    const directCreate=await request(`users/owner/${collection}?documentId=forged-source`,"owner",{
      method:"POST",body:JSON.stringify({fields:{status:{stringValue:"Unpaid"}}})
    });
    assert.equal(directCreate.status,403,`${collection} direct create must be denied`);
    const sourceId=collection === "invoices" ? "invoice-1" : "bill-1";
    const directDelete=await request(`users/owner/${collection}/${sourceId}`,"owner",{method:"DELETE"});
    assert.equal(directDelete.status,403,`${collection} direct delete must be denied`);
    const referenceField=collection === "invoices" ? "invoiceNo" : "billNumber";
    const directReferenceChange=await request(`users/owner/${collection}/${sourceId}?updateMask.fieldPaths=${referenceField}`,"owner",{
      method:"PATCH",body:JSON.stringify({fields:{[referenceField]:{stringValue:"FORGED"}}})
    });
    assert.equal(directReferenceChange.status,403,`${collection} direct reference update must be denied`);
    const legacyReferenceChange=await request(`users/owner/${collection}/${sourceId}?updateMask.fieldPaths=invoiceNumber`,"owner",{
      method:"PATCH",body:JSON.stringify({fields:{invoiceNumber:{stringValue:"FORGED-LEGACY"}}})
    });
    assert.equal(legacyReferenceChange.status,403,`${collection} legacy reference update must be denied`);
  }

  const invoiceStatus=await request("users/owner/invoices/invoice-1?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt","owner",{
    method:"PATCH",body:JSON.stringify({fields:{status:{stringValue:"Paid"},updatedAt:{stringValue:"new"}}})
  });
  assert.equal(invoiceStatus.status,200,"Invoice status/payment metadata update must remain allowed");
  const invoiceSettlement=await request("users/owner/invoices/invoice-1?updateMask.fieldPaths=bankSettlement&updateMask.fieldPaths=updatedAt","owner",{
    method:"PATCH",body:JSON.stringify({fields:{bankSettlement:{mapValue:{fields:{transactionId:{stringValue:"bank-1"}}}},updatedAt:{stringValue:"newer"}}})
  });
  assert.equal(invoiceSettlement.status,200,"Invoice Banking settlement update must remain allowed");
  const invoiceUnmatch=await request("users/owner/invoices/invoice-1?updateMask.fieldPaths=bankSettlement&updateMask.fieldPaths=updatedAt","owner",{
    method:"PATCH",body:JSON.stringify({fields:{updatedAt:{stringValue:"unmatched"}}})
  });
  assert.equal(invoiceUnmatch.status,200,"Invoice Banking unmatch must remain allowed");
  const invoiceAmount=await request("users/owner/invoices/invoice-1?updateMask.fieldPaths=amount","owner",{
    method:"PATCH",body:JSON.stringify({fields:{amount:{integerValue:"999"}}})
  });
  assert.equal(invoiceAmount.status,403,"Invoice accounting fields must remain server-owned");

  const billPayment=await request("users/owner/bills/bill-1?updateMask.fieldPaths=status&updateMask.fieldPaths=paidAt&updateMask.fieldPaths=updatedAt","owner",{
    method:"PATCH",body:JSON.stringify({fields:{status:{stringValue:"Paid"},paidAt:{stringValue:"2026-08-21"},updatedAt:{stringValue:"new"}}})
  });
  assert.equal(billPayment.status,200,"Bill payment metadata update must remain allowed");
  const billSettlement=await request("users/owner/bills/bill-1?updateMask.fieldPaths=bankSettlement&updateMask.fieldPaths=updatedAt","owner",{
    method:"PATCH",body:JSON.stringify({fields:{bankSettlement:{mapValue:{fields:{transactionId:{stringValue:"bank-1"}}}},updatedAt:{stringValue:"newer"}}})
  });
  assert.equal(billSettlement.status,200,"Bill Banking settlement update must remain allowed");
  const billUnmatch=await request("users/owner/bills/bill-1?updateMask.fieldPaths=bankSettlement&updateMask.fieldPaths=paidAt&updateMask.fieldPaths=updatedAt","owner",{
    method:"PATCH",body:JSON.stringify({fields:{updatedAt:{stringValue:"unmatched"}}})
  });
  assert.equal(billUnmatch.status,200,"Bill Banking unmatch must remain allowed");
  const billAttachment=await request("users/owner/bills/bill-1?updateMask.fieldPaths=attachmentName&updateMask.fieldPaths=attachmentPath","owner",{
    method:"PATCH",body:JSON.stringify({fields:{attachmentName:{stringValue:"receipt.pdf"},attachmentPath:{stringValue:"users/owner/attachments/bills/bill-1/receipt.pdf"}}})
  });
  assert.equal(billAttachment.status,200,"Bill attachment metadata update must remain allowed");
  const billTotal=await request("users/owner/bills/bill-1?updateMask.fieldPaths=total","owner",{
    method:"PATCH",body:JSON.stringify({fields:{total:{integerValue:"999"}}})
  });
  assert.equal(billTotal.status,403,"Bill accounting fields must remain server-owned");

  for(const collection of ["referenceKeys","referenceCreateRequests","referenceEditRequests","referenceDeleteRequests","referenceBackfillMigrations"]){
    const documentId=collection === "referenceKeys" ? "key-1" : collection === "referenceBackfillMigrations" ? "migration-1" : "request-1";
    const ownerRead=await request(`users/owner/${collection}/${documentId}`,"owner");
    assert.equal(ownerRead.status,collection === "referenceKeys" ? 200 : 403,
      `${collection} owner read boundary must be enforced`);
    const otherRead=await request(`users/owner/${collection}/${documentId}`,"other");
    assert.equal(otherRead.status,403,`${collection} cross-user read must be denied`);
    const create=await request(`users/owner/${collection}?documentId=forged`,`owner`,{
      method:"POST",body:JSON.stringify({fields:{state:{stringValue:"active"}}})
    });
    assert.equal(create.status,403,`${collection} client create must be denied`);
    const update=await request(`users/owner/${collection}/${documentId}`,"owner",{
      method:"PATCH",body:JSON.stringify({fields:{state:{stringValue:"forged"}}})
    });
    assert.equal(update.status,403,`${collection} client update must be denied`);
    const remove=await request(`users/owner/${collection}/${documentId}`,"owner",{method:"DELETE"});
    assert.equal(remove.status,403,`${collection} client delete must be denied`);
  }

  const clientJobCreate=await request("accountDeletionJobs?documentId=owner","owner",{
    method:"POST",body:JSON.stringify({fields:{status:{stringValue:"active"}}})
  });
  assert.equal(clientJobCreate.status,403,"Deletion jobs must remain server-owned");
  const clientMarker=await request("users/owner?updateMask.fieldPaths=deletionInProgress","owner",{
    method:"PATCH",body:JSON.stringify({fields:{deletionInProgress:{booleanValue:true}}})
  });
  assert.equal(clientMarker.status,403,"Deletion barrier fields must remain server-owned");

  const activeExpense=await request("users/owner/expenses?documentId=expense-1","owner",{
    method:"POST",body:JSON.stringify({fields:{description:{stringValue:"Before deletion"}}})
  });
  assert.equal(activeExpense.status,200,"An active account can write its own data");
  const otherExpense=await request("users/other/expenses?documentId=expense-1","other",{
    method:"POST",body:JSON.stringify({fields:{description:{stringValue:"Independent user"}}})
  });
  assert.equal(otherExpense.status,200,"User B remains independently writable");

  await db.doc("accountDeletionJobs/owner").set({
    schemaVersion:1,uid:"owner",status:"active",stage:"requested"
  });
  await db.doc("users/owner").set({
    deletionInProgress:true,accountDeletionState:"requested"
  },{merge:true});

  const deletingRead=await request("users/owner/expenses/expense-1","owner");
  assert.equal(deletingRead.status,200,"A deleting account retains read/export access");
  const deletingCreate=await request("users/owner/expenses?documentId=expense-2","owner",{
    method:"POST",body:JSON.stringify({fields:{description:{stringValue:"Blocked"}}})
  });
  assert.equal(deletingCreate.status,403,"Deleting account creates must be denied");
  const deletingUpdate=await request("users/owner/expenses/expense-1?updateMask.fieldPaths=description","owner",{
    method:"PATCH",body:JSON.stringify({fields:{description:{stringValue:"Blocked"}}})
  });
  assert.equal(deletingUpdate.status,403,"Deleting account updates must be denied");
  const deletingDelete=await request("users/owner/expenses/expense-1","owner",{method:"DELETE"});
  assert.equal(deletingDelete.status,403,"Deleting account deletes must be denied");
  const deletingInvoiceUpdate=await request("users/owner/invoices/invoice-1?updateMask.fieldPaths=status","owner",{
    method:"PATCH",body:JSON.stringify({fields:{status:{stringValue:"Unpaid"}}})
  });
  assert.equal(deletingInvoiceUpdate.status,403,"Deleting account invoice updates must be denied");
  const deletingJournalCreate=await request("journals?documentId=journal-after-delete","owner",{
    method:"POST",body:JSON.stringify({fields:{userId:{stringValue:"owner"}}})
  });
  assert.equal(deletingJournalCreate.status,403,"Deleting account journal creates must be denied");
  const unaffectedUser=await request("users/other/expenses/expense-1?updateMask.fieldPaths=description","other",{
    method:"PATCH",body:JSON.stringify({fields:{description:{stringValue:"Still active"}}})
  });
  assert.equal(unaffectedUser.status,200,"User B must not be blocked by User A deletion");

  console.log("Firestore registry and account-deletion rules checks passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode=1;
});
