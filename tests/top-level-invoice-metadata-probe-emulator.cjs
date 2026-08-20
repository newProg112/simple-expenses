"use strict";

const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const {createRequire} = require("node:module");
const {resolve} = require("node:path");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
const functionsRequire = createRequire(resolve(__dirname, "../functions/package.json"));
const admin = functionsRequire("firebase-admin");
const {FieldPath} = functionsRequire("firebase-admin/firestore");
const {
  createTopLevelInvoiceMetadataAdapter,
} = require("../scripts/lib/top-level-invoice-metadata-adapter.cjs");
const {
  createTopLevelInvoiceMetadataProbe,
} = require("../scripts/lib/top-level-invoice-metadata-probe.cjs");

const projectId = "demo-simple-books";
const prefix = `invoice-metadata-probe-${Date.now()}`;
const topPaths = [`invoices/${prefix}-a`, `invoices/${prefix}-b`];
const canonicalPath = `users/${prefix}-user/invoices/${prefix}-canonical`;
const nestedPath = `private-root/${prefix}-parent/invoices/${prefix}-nested`;
const secretValues = ["PRIVATE-INVOICE-001", "Private Customer Limited", "customer@example.test", "99999"];
const sha256 = (value) => createHash("sha256").update(value,"utf8").digest("hex");

if (!admin.apps.length) admin.initializeApp({projectId});
const firestore = admin.firestore();
const adapter = createTopLevelInvoiceMetadataAdapter(firestore,FieldPath);

function fixtureData(suffix) {
  return {
    invoiceNo:`${secretValues[0]}-${suffix}`,client:secretValues[1],email:secretValues[2],
    total:Number(secretValues[3]),items:[{description:"Secret line item"}]
  };
}

async function snapshot(paths) {
  const result={};
  for(const path of paths){
    const document=await firestore.doc(path).get();
    result[path]={
      exists:document.exists,
      data:document.exists?document.data():null,
      updateTime:document.exists?document.updateTime.toDate().toISOString():null
    };
  }
  return result;
}

async function probe(expectedPathHash) {
  return createTopLevelInvoiceMetadataProbe(adapter,{
    projectId,databaseId:"(default)",expectedPathHash
  });
}

async function main() {
  const allPaths=[...topPaths,canonicalPath,nestedPath];
  try{
    await firestore.doc(canonicalPath).set(fixtureData("canonical"));
    await firestore.doc(nestedPath).set(fixtureData("nested"));

    const zero=await probe(sha256(topPaths[0]));
    assert.equal(zero.result.documentsObserved,0,"Canonical or nested invoices leaked into top-level scope.");
    assert.equal(zero.result.cardinalityStatus,"zero");

    await firestore.doc(topPaths[0]).set(fixtureData("top-a"));
    const beforeOne=await snapshot(allPaths);
    const one=await probe(sha256(topPaths[0]));
    const afterOne=await snapshot(allPaths);
    assert.deepEqual(afterOne,beforeOne,"The one-document metadata probe changed emulator fixtures.");
    assert.deepEqual(one.result,{
      documentsObserved:1,expectedHashMatches:1,unexpectedHashMatches:0,
      cardinalityStatus:"exactly-one",cardinalityComplete:true,
      provenanceInterpretation:"timestamp-comparison-only"
    });
    assert.equal(one.documents[0].pathHash,sha256(topPaths[0]));
    assert.equal(one.documents[0].matchesExpectedPathHash,true);
    assert.match(one.documents[0].createTime,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.match(one.documents[0].updateTime,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(one.documents[0].createdWithinHistoricalWriterWindow,false);

    const mismatch=await probe(sha256("invoices/different-known-path"));
    assert.equal(mismatch.result.expectedHashMatches,0);
    assert.equal(mismatch.result.unexpectedHashMatches,1);
    assert.equal(mismatch.documents[0].matchesExpectedPathHash,false);

    await firestore.doc(topPaths[1]).set(fixtureData("top-b"));
    const beforeTwo=await snapshot(allPaths);
    const two=await probe(sha256(topPaths[0]));
    const afterTwo=await snapshot(allPaths);
    assert.deepEqual(afterTwo,beforeTwo,"The two-document metadata probe changed emulator fixtures.");
    assert.equal(two.result.documentsObserved,2);
    assert.equal(two.result.cardinalityStatus,"multiple-observed-at-cap");
    assert.equal(two.result.cardinalityComplete,false);
    assert.equal(two.result.provenanceInterpretation,"refused-multiple-documents");

    for(const report of [zero,one,mismatch,two]){
      const serialized=JSON.stringify(report);
      for(const secret of [...secretValues,"Secret line item",...allPaths]){
        assert.equal(serialized.includes(secret),false,`Private fixture value leaked: ${secret}`);
      }
      assert.deepEqual(Object.keys(report.documents[0]||{}).sort(),report.documents.length?[
        "createTime","createdOn2026May20","createdWithinHistoricalWriterWindow","matchesExpectedPathHash","pathHash","updateTime"
      ]:[]);
    }

    console.log("Top-level invoice metadata probe emulator integration passed.");
  }finally{
    await Promise.all(allPaths.map((path)=>firestore.doc(path).delete()));
  }
}

main().catch((error)=>{
  console.error(error);
  process.exitCode=1;
});
