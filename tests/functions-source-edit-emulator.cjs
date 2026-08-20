"use strict";

const assert=require("node:assert/strict");
process.env.FIRESTORE_EMULATOR_HOST||="127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST||="127.0.0.1:9099";
const admin=require("../functions/node_modules/firebase-admin");
const {referenceRegistryKey}=require("../functions/lib/reference-registry-key");
const {editStateProjection}=require("../functions/lib/source-edit-state");

const projectId="simple-books-office";
const authBase=`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const functionsBase="http://127.0.0.1:5001/simple-books-office/us-central1";
const stamp=Date.now();
const email=`source-edit-${stamp}@example.test`;
const password="Emulator-test-123!";
if(!admin.apps.length)admin.initializeApp({projectId});
const firestore=admin.firestore();

async function request(url,options){
  const response=await fetch(url,options);const body=await response.json().catch(()=>({}));return {response,body};
}
async function authUser(){
  const {response,body}=await request(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-test-key`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})
  });
  assert.equal(response.ok,true,JSON.stringify(body));return {uid:body.localId,idToken:body.idToken};
}
async function callable(name,idToken,data,{expectError=false}={}){
  const result=await request(`${functionsBase}/${name}`,{method:"POST",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},body:JSON.stringify({data})});
  if(expectError){assert.equal(result.response.ok,false,"Callable unexpectedly succeeded.");return result.body.error;}
  assert.equal(result.response.ok,true,JSON.stringify(result.body));if(result.body.error)throw new Error(JSON.stringify(result.body.error));return result.body.result;
}
function invoice(reference){return {
  invoiceNo:reference,client:"Edited Customer",clientEmail:"customer@example.test",clientAddress:"1 Emulator Road",
  paymentTerms:"14 days",dueDate:"2026-09-10",amount:100,vat:20,total:120,
  items:[{description:"Bookkeeping services",amount:100}],status:"Unpaid",date:"20/08/2026",
  recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",
  projectId:"",projectName:"",projectReference:""
};}
function invoiceEdit(source,reference){const {status:_status,createdAt:_createdAt,updatedAt:_updatedAt,...payload}=source;return {
  ...payload,invoiceNo:reference,amount:125,vat:25,total:150,items:[{description:"Edited services",amount:125}],
  businessName:"",businessEmail:"",businessWebsite:"",businessVat:""
};}
function bill(id,reference){return {
  id,supplier:"Edited Supplier",billNumber:reference,billDate:"2026-08-20",dueDate:"2026-09-10",
  category:"Utilities",net:100,vatRate:0.2,vat:20,total:120,status:"Unpaid",notes:"",
  projectId:"",projectName:"",projectReference:"",attachmentName:"",attachmentUrl:"",
  attachmentPath:"",attachmentSize:0,attachmentType:""
};}
function billEdit(source,reference){const {id:_id,createdAt:_createdAt,updatedAt:_updatedAt,...payload}=source;return {...payload,billNumber:reference,category:"Professional fees",net:125,vat:25,total:150};}

async function exercise(user,type){
  const isInvoice=type==="invoice";const sourceId=isInvoice?`emulator-edit-invoice-${stamp}`:String(stamp);
  const oldReference=`EMU-${isInvoice?"INV":"BILL"}-${stamp}-A`;const newReference=`EMU-${isInvoice?"INV":"BILL"}-${stamp}-B`;
  const createName=isInvoice?"createInvoiceWithReference":"createBillWithReference";
  const editName=isInvoice?"updateInvoiceWithReference":"updateBillWithReference";
  const collection=isInvoice?"invoices":"bills";const journalId=`${isInvoice?"invoice":"bill"}_${encodeURIComponent(user.uid)}_${encodeURIComponent(sourceId)}`;
  const createPayload=isInvoice?invoice(oldReference):bill(Number(sourceId),oldReference);
  await callable(createName,user.idToken,{sourceId,requestId:isInvoice?"123e4567-e89b-42d3-a456-426614174000":"223e4567-e89b-42d3-a456-426614174001",payload:createPayload});
  const sourceRef=firestore.doc(`users/${user.uid}/${collection}/${sourceId}`);const opened=(await sourceRef.get()).data();
  const editPayload=isInvoice?invoiceEdit(opened,newReference):billEdit(opened,newReference);
  const data={sourceId,requestId:isInvoice?"323e4567-e89b-42d3-a456-426614174002":"423e4567-e89b-42d3-a456-426614174003",expectedState:editStateProjection(type,opened),payload:editPayload};
  const first=await callable(editName,user.idToken,data);assert.equal(first.status,"updated");
  const oldKey=await referenceRegistryKey(type,oldReference);const newKey=await referenceRegistryKey(type,newReference);
  const [source,oldClaim,newClaim,journal,sources,journals,editRequests]=await Promise.all([
    sourceRef.get(),firestore.doc(`users/${user.uid}/referenceKeys/${oldKey.registryDocumentId}`).get(),
    firestore.doc(`users/${user.uid}/referenceKeys/${newKey.registryDocumentId}`).get(),firestore.doc(`journals/${journalId}`).get(),
    firestore.collection(`users/${user.uid}/${collection}`).get(),firestore.collection("journals").where("userId","==",user.uid).get(),
    firestore.collection(`users/${user.uid}/referenceEditRequests`).get()
  ]);
  assert.equal(source.data()[isInvoice?"invoiceNo":"billNumber"],newReference);
  if(!isInvoice)assert.equal(source.data().id,Number(sourceId));
  assert.equal(source.data().total,150);assert.equal(oldClaim.data().state,"retired");assert.equal(newClaim.data().state,"active");
  assert.equal(journal.data().sourceNumber,newReference);assert.equal(isInvoice?journal.data().lines[0].debit:journal.data().lines.at(-1).credit,150);
  assert.equal(sources.size,1);assert.equal(journals.size,isInvoice?1:2);assert.equal(editRequests.size,isInvoice?1:2);
  const retry=await callable(editName,user.idToken,data);assert.equal(retry.status,"already-updated");
  assert.equal((await firestore.collection(`users/${user.uid}/${collection}`).get()).size,1);
  const conflictData={...data,requestId:isInvoice?"523e4567-e89b-42d3-a456-426614174004":"623e4567-e89b-42d3-a456-426614174005",expectedState:editStateProjection(type,source.data()),payload:isInvoice?invoiceEdit(source.data(),oldReference):billEdit(source.data(),oldReference)};
  const error=await callable(editName,user.idToken,conflictData,{expectError:true});assert.equal(error.details.reason,"retired-reference");
  return journalId;
}

async function main(){let uid="";const journalIds=[];try{
  const stale=await firestore.collection("journals").get();
  await Promise.all(stale.docs.filter(doc=>String(doc.data().sourceId||"").startsWith("emulator-edit-")).map(doc=>doc.ref.delete()));
  const user=await authUser();uid=user.uid;journalIds.push(await exercise(user,"invoice"));journalIds.push(await exercise(user,"bill"));
  console.log("Functions Emulator atomic Invoice and Bill edit callables passed.");
}finally{if(uid){const ownedJournals=await firestore.collection("journals").where("userId","==",uid).get();const cleanup=await Promise.allSettled([
  firestore.recursiveDelete(firestore.doc(`users/${uid}`)),firestore.doc(`userProfiles/${uid}`).delete(),
  ...ownedJournals.docs.map(doc=>doc.ref.delete()),...journalIds.map(id=>firestore.doc(`journals/${id}`).delete()),admin.auth().deleteUser(uid)
]);const failures=cleanup.filter(result=>result.status==="rejected");if(failures.length)throw new AggregateError(failures.map(result=>result.reason),"Emulator edit-test cleanup failed.");}}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
