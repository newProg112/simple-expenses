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
  await db.doc("users/owner/referenceKeys/key-1").set({state:"active"});
  await db.doc("users/owner/referenceCreateRequests/request-1").set({operation:"create"});
  await db.doc("users/owner/referenceEditRequests/request-1").set({operation:"edit"});

  const ordinaryCreate=await request("users/owner/invoices?documentId=invoice-1","owner",{
    method:"POST",body:JSON.stringify({fields:{invoiceNo:{stringValue:"INV-001"}}})
  });
  assert.equal(ordinaryCreate.status,200,"ordinary owner create must remain allowed");

  for(const collection of ["referenceKeys","referenceCreateRequests","referenceEditRequests"]){
    const ownerRead=await request(`users/owner/${collection}/${collection === "referenceKeys" ? "key-1" : "request-1"}`,"owner");
    assert.equal(ownerRead.status,collection === "referenceKeys" ? 200 : 403,
      `${collection} owner read boundary must be enforced`);
    const otherRead=await request(`users/owner/${collection}/${collection === "referenceKeys" ? "key-1" : "request-1"}`,"other");
    assert.equal(otherRead.status,403,`${collection} cross-user read must be denied`);
    const create=await request(`users/owner/${collection}?documentId=forged`,`owner`,{
      method:"POST",body:JSON.stringify({fields:{state:{stringValue:"active"}}})
    });
    assert.equal(create.status,403,`${collection} client create must be denied`);
    const update=await request(`users/owner/${collection}/${collection === "referenceKeys" ? "key-1" : "request-1"}`,"owner",{
      method:"PATCH",body:JSON.stringify({fields:{state:{stringValue:"forged"}}})
    });
    assert.equal(update.status,403,`${collection} client update must be denied`);
    const remove=await request(`users/owner/${collection}/${collection === "referenceKeys" ? "key-1" : "request-1"}`,"owner",{method:"DELETE"});
    assert.equal(remove.status,403,`${collection} client delete must be denied`);
  }
  console.log("Firestore registry rules checks passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode=1;
});
