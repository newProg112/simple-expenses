"use strict";

const assert = require("node:assert/strict");
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
const admin = require("../functions/node_modules/firebase-admin");
const {referenceRegistryKey} = require("../functions/lib/reference-registry-key");

const projectId="simple-books-office";
const authBase=`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const functionsBase="http://127.0.0.1:5001/simple-books-office/us-central1";
const password="Emulator-test-123!";
const omissions=["storage-binaries","authentication","billing-profile","operational-markers","account-internals","admin-analytics"];
const names=["invoices","bills","expenses","mileage","clients","customers","projects","budgets","bankAccounts","bankTransactions","bankIncome","bankReconciliations","bankTransfers","bankTransferLinks","bankExceptionResolutions","journals","referenceKeys"];
if(!admin.apps.length)admin.initializeApp({projectId});
const firestore=admin.firestore();

async function jsonRequest(url,options){const response=await fetch(url,options);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`${response.status} ${JSON.stringify(body)}`);return body;}
async function createUser(){return jsonRequest(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-test-key`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:`json-restore-${Date.now()}@example.test`,password,returnSecureToken:true})});}
function stamp(seconds){return {__simpleBooksV2Value:{version:1,type:"timestamp",seconds,nanoseconds:123}};}
function backup(){
  const collections=Object.fromEntries(names.map(name=>[name,[]]));
  collections.clients=[{id:"client-1",data:{name:"Client",attachmentName:"contract.pdf",attachmentUrl:"https://source.invalid/contract",attachmentPath:"users/source/contract",attachmentSize:99}}];
  collections.customers=[{id:"customer-1",data:{name:"Customer"}}];
  collections.projects=[{id:"project-1",data:{name:"Project",customerId:"client-1"}}];
  collections.budgets=[{id:"budget-1",data:{projectId:"project-1",amount:500}}];
  collections.invoices=[{id:"invoice-1",data:{invoiceNo:"INV-EMU-1",client:"Client",clientEmail:"client@example.test",clientAddress:"1 Road",paymentTerms:"14 days",dueDate:"2026-09-11",amount:100,vat:20,total:120,items:[{description:"Services",amount:100}],status:"Unpaid",date:"28/08/2026",recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",projectId:"project-1",createdAt:stamp(100),userId:"source-user"}}];
  collections.bills=[{id:"bill-1",data:{id:"business-bill-id",supplier:"Supplier",billNumber:"BILL-EMU-1",billDate:"2026-08-28",dueDate:"2026-09-11",category:"Utilities",net:50,vatRate:.2,vat:10,total:60,status:"Unpaid",notes:"",projectId:"project-1",attachmentName:"bill.pdf",attachmentUrl:"https://source.invalid/bill",attachmentPath:"users/source/bill",attachmentSize:50,attachmentType:"application/pdf",createdAt:stamp(101)}}];
  collections.expenses=[{id:"expense-1",data:{type:"expense",projectId:"project-1",amount:12,attachmentUrl:"https://source.invalid/receipt",attachmentPath:"users/source/receipt"}}];
  collections.mileage=[{id:"mileage-1",data:{type:"mileage",projectId:"project-1",miles:10,amount:4.5}}];
  collections.bankAccounts=[{id:"bank-1",data:{name:"Current account",userId:"source-user"}},{id:"bank-2",data:{name:"Savings",userId:"source-user"}}];
  collections.bankTransactions=[
    {id:"tx-income",data:{bankAccountId:"bank-1",status:"matched",matchedRecordType:"bankIncome",matchedRecordId:"income-1",userId:"source-user"}},
    {id:"tx-exception",data:{bankAccountId:"bank-1",status:"matched",matchedRecordType:"bankException",matchedRecordId:"exception-1",userId:"source-user"}},
    {id:"tx-transfer-a",data:{bankAccountId:"bank-1",status:"matched",matchedRecordType:"bankTransfer",matchedRecordId:"transfer-1",userId:"source-user"}},
    {id:"tx-transfer-b",data:{bankAccountId:"bank-2",status:"matched",matchedRecordType:"bankTransfer",matchedRecordId:"transfer-1",userId:"source-user"}}
  ];
  collections.bankIncome=[{id:"income-1",data:{bankAccountId:"bank-1",bankTransactionId:"tx-income",gross:25,userId:"source-user"}}];
  collections.bankReconciliations=[{id:"recon-1",data:{bankAccountId:"bank-1",userId:"source-user"}}];
  collections.bankTransfers=[{id:"transfer-1",data:{sourceBankAccountId:"bank-1",destinationBankAccountId:"bank-2",amount:10,userId:"source-user"}}];
  collections.bankTransferLinks=[{id:"link-1",data:{transferId:"transfer-1",sourceBankAccountId:"bank-1",destinationBankAccountId:"bank-2",sourceTransactionId:"tx-transfer-a",destinationTransactionId:"tx-transfer-b",userId:"source-user"}}];
  collections.bankExceptionResolutions=[{id:"exception-1",data:{bankAccountId:"bank-1",bankTransactionId:"tx-exception",userId:"source-user"}}];
  collections.journals=[{id:"bank-income_source-user_income-1",data:{userId:"source-user",journalId:"bank-income_source-user_income-1",date:"2026-08-28",sourceType:"bankIncome",sourceId:"income-1",description:"Income",createdAt:stamp(102),updatedAt:stamp(102),lines:[{accountCode:"1000",description:"Income",debit:25,credit:0,bankAccountId:"bank-1"},{accountCode:"4200",description:"Income",debit:0,credit:25}]}}];
  const collectionCounts=Object.fromEntries(names.map(name=>[name,collections[name].length]));
  return {app:"Simple Books",schemaVersion:2,exportedAt:"2026-08-28T12:00:00.000Z",manifest:{codecVersion:1,collectionCounts,accountFields:["businessName","paymentTermsDefault"],storageBinariesIncluded:false,omissions},account:{businessName:"Emulator Books",paymentTermsDefault:"14 days"},collections};
}
async function invoke(idToken,payload){const body=await jsonRequest(`${functionsBase}/restoreJsonBackupV2`,{method:"POST",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},body:JSON.stringify({data:payload})});if(body.error)throw new Error(JSON.stringify(body.error));return body.result;}

async function main(){
  let uid="";const jobId="123e4567-e89b-42d3-a456-426614174000";
  try{
    const user=await createUser();uid=user.localId;
    const result=await invoke(user.idToken,{jobId,backup:backup()});
    assert.equal(result.status,"completed");assert.equal(result.verified,true);
    const userRef=firestore.doc(`users/${uid}`);
    const [account,invoice,bill,client,transactions,journals,claims]=await Promise.all([
      userRef.get(),userRef.collection("invoices").doc("invoice-1").get(),userRef.collection("bills").doc("bill-1").get(),
      userRef.collection("clients").doc("client-1").get(),userRef.collection("bankTransactions").get(),
      firestore.collection("journals").where("userId","==",uid).get(),userRef.collection("referenceKeys").get()
    ]);
    assert.equal(account.data().businessName,"Emulator Books");assert.equal(invoice.exists,true);assert.equal(bill.data().id,"business-bill-id");
    assert.equal(typeof invoice.data().createdAt.toDate,"function");assert.equal(client.data().attachmentPath,"");
    assert.equal(transactions.size,4);assert.ok(transactions.docs.every(doc=>doc.data().userId===uid));assert.equal(journals.size,3);assert.ok(journals.docs.every(doc=>doc.data().userId===uid));assert.equal(claims.size,2);
    const invoiceKey=await referenceRegistryKey("invoice","INV-EMU-1");assert.equal(claims.docs.find(doc=>doc.id===invoiceKey.registryDocumentId).data().sourceId,"invoice-1");
    const replay=await invoke(user.idToken,{jobId,backup:backup()});assert.equal(replay.replayed,true);
    console.log("Functions Emulator JSON Backup V2 round-trip passed.");
  }finally{
    if(uid){
      const journals=await firestore.collection("journals").where("userId","==",uid).get();
      await Promise.all([firestore.recursiveDelete(firestore.doc(`users/${uid}`)),...journals.docs.map(doc=>doc.ref.delete()),firestore.doc(`jsonRestoreJobs/${uid}_123e4567-e89b-42d3-a456-426614174000`).delete(),firestore.doc(`userProfiles/${uid}`).delete(),admin.auth().deleteUser(uid)]);
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
