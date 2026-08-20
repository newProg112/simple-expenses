"use strict";

const {createHash} = require("node:crypto");
const {referenceRegistryKey, sourceReference} = require("../../functions/lib/reference-registry-key");
const {
  billGroupHash,
  billSourceHash,
  collisionManifestHash,
} = require("./bill-collision-audit-binding.cjs");
const {
  BILL_COLLISION_LIMITS,
  BILL_DETAIL_FIELDS,
} = require("./bill-collision-diagnostic-config.cjs");

const STATUS = Object.freeze({Paid: "paid", Unpaid: "unpaid"});

function timestampIso(value) {
  if (!value || typeof value.toDate !== "function") return null;
  const date = value.toDate();
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function canonicalPath(path) {
  const segments = String(path || "").split("/");
  if (segments.length !== 4 || segments[0] !== "users" || segments[2] !== "bills" ||
      !segments[1] || !segments[3]) return null;
  return {uid: segments[1], sourceId: segments[3]};
}

function textToken(value, {required = false} = {}) {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
  return {complete: !required || Boolean(text), value: text};
}

function moneyToken(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? {complete: true, value: Math.round(number * 100)} :
    {complete: false, value: null};
}

function rateToken(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? {complete: true, value: Math.round(number * 1000000)} :
    {complete: false, value: null};
}

function dateToken(value, {required = false} = {}) {
  const text = String(value || "").trim();
  if (!text && !required) return {complete: true, value: ""};
  let iso = text;
  const uk = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (uk) iso = `${uk[3]}-${uk[2]}-${uk[1]}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return {complete: false, value: null};
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    return {complete: false, value: null};
  }
  return {complete: true, value: iso};
}

function statusValue(value) {
  return STATUS[String(value || "").trim()] || "other-or-missing";
}

function bankSettled(data) {
  const marker = data?.bankSettlement;
  return Boolean(marker && Number(marker.version) === 1 &&
    String(marker.transactionId || "").trim() && String(marker.journalId || "").trim());
}

function attachmentExists(data) {
  return [data?.attachmentPath, data?.attachmentUrl, data?.attachmentName]
    .some((value) => Boolean(String(value || "").trim()));
}

function attachmentIdentityToken(data) {
  const values = [data?.attachmentPath, data?.attachmentUrl, data?.attachmentName]
    .map((value) => String(value || "").trim()).filter(Boolean);
  return {complete: true, value: values.join("\0")};
}

function bankSettlementIdentityToken(data) {
  if (!bankSettled(data)) return {complete: true, value: ""};
  const marker = data.bankSettlement;
  return {complete: true, value: `${Number(marker.version)}\0${String(marker.transactionId).trim()}\0${String(marker.journalId).trim()}`};
}

function relation(tokens) {
  if (tokens.some((token) => !token.complete)) return "incomplete";
  return new Set(tokens.map((token) => JSON.stringify(token.value))).size === 1 ? "same" : "different";
}

function booleanRelation(values) {
  return new Set(values.map(Boolean)).size === 1 ? "same" : "different";
}

function timeSpread(values) {
  const times = values.map((value) => Date.parse(value));
  if (times.some((value) => !Number.isFinite(value))) return "incomplete";
  const spread = Math.max(...times) - Math.min(...times);
  if (spread === 0) return "same-instant";
  if (spread <= 60000) return "within-one-minute";
  if (spread <= 86400000) return "within-one-day";
  return "over-one-day";
}

function dateSpread(tokens) {
  if (tokens.some((token) => !token.complete || !token.value)) return "incomplete";
  const times = tokens.map((token) => Date.parse(`${token.value}T00:00:00.000Z`));
  const spread = Math.max(...times) - Math.min(...times);
  if (spread === 0) return "same-day";
  if (spread <= 7 * 86400000) return "within-seven-days";
  if (spread <= 31 * 86400000) return "within-thirty-one-days";
  return "over-thirty-one-days";
}

function billJournalId(uid, sourceId) {
  return `bill_${encodeURIComponent(uid)}_${encodeURIComponent(sourceId)}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value),"utf8").digest("hex");
}

function safeGroupEvidence(group, details, demoSnapshot, journals) {
  const records = group.sources.map((source) => {
    const detail = details.get(`users/${source.uid}/bills/${source.sourceId}`);
    const data = detail.data;
    const fields = {
      rawReference: textToken(source.rawReference, {required: true}),
      supplier: textToken(data.supplier, {required: true}),
      billDate: dateToken(data.billDate, {required: true}),
      dueDate: dateToken(data.dueDate),
      category: textToken(data.category),
      net: moneyToken(data.net),
      vatRate: rateToken(data.vatRate),
      vat: moneyToken(data.vat),
      total: moneyToken(data.total),
      status: {complete: statusValue(data.status) !== "other-or-missing", value: statusValue(data.status)},
      projectIdentity: textToken(data.projectId),
      attachment: {complete: true, value: attachmentExists(data)},
      attachmentIdentity: attachmentIdentityToken(data),
      bankSettlement: {complete: true, value: bankSettled(data)},
      bankSettlementIdentity: bankSettlementIdentityToken(data),
    };
    return {
      sourceHash: source.sourceHash,
      status: fields.status.value,
      bankSettled: fields.bankSettlement.value,
      hasAttachment: fields.attachment.value,
      hasProjectAllocation: Boolean(fields.projectIdentity.value),
      accountingJournalExists: Boolean(journals.get(billJournalId(source.uid, source.sourceId))),
      createTime: detail.createTime,
      updateTime: detail.updateTime,
      fields,
    };
  });
  const fieldRelation = (name) => relation(records.map((record) => record.fields[name]));
  const relationships = {
    rawReferenceText: fieldRelation("rawReference"),
    supplierIdentity: fieldRelation("supplier"),
    grossAmount: fieldRelation("total"),
    netAmount: fieldRelation("net"),
    vatAmount: fieldRelation("vat"),
    vatRate: fieldRelation("vatRate"),
    billDate: fieldRelation("billDate"),
    billDateSpread: dateSpread(records.map((record) => record.fields.billDate)),
    dueDate: fieldRelation("dueDate"),
    category: fieldRelation("category"),
    status: fieldRelation("status"),
    projectAllocation: fieldRelation("projectIdentity"),
    attachmentPresence: fieldRelation("attachment"),
    attachmentIdentity: fieldRelation("attachmentIdentity"),
    bankSettlementState: fieldRelation("bankSettlement"),
    bankSettlementIdentity: fieldRelation("bankSettlementIdentity"),
    accountingJournalState: booleanRelation(records.map((record) => record.accountingJournalExists)),
    creationTimeSpread: timeSpread(records.map((record) => record.createTime)),
    updateTime: records.every((record) => record.updateTime) ?
      (new Set(records.map((record) => record.updateTime)).size === 1 ? "same" : "different") : "incomplete",
  };
  const comparisonNames = [
    "supplier", "billDate", "dueDate", "category", "net", "vatRate", "vat", "total",
    "status", "projectIdentity", "attachment", "attachmentIdentity", "bankSettlement", "bankSettlementIdentity",
  ];
  const comparisonDataComplete = records.every((record) =>
    ["supplier", "billDate", "net", "vatRate", "vat", "total", "status"]
      .every((name) => record.fields[name].complete));
  const allComparisonFieldsEquivalent = comparisonNames.every((name) => fieldRelation(name) === "same");
  let classification = "ambiguous";
  if (comparisonDataComplete && allComparisonFieldsEquivalent) classification = "likely-exact-duplicate";
  else if (comparisonDataComplete && relationships.supplierIdentity === "same" &&
      [relationships.grossAmount, relationships.netAmount, relationships.vatAmount, relationships.billDate]
        .includes("different")) {
    classification = "likely-legitimate-same-reference-separate-bills";
  }
  const demoContext = !demoSnapshot || !demoSnapshot.exists ? "unknown" :
    (demoSnapshot.data.demoMode === true ? "demo-account" : "non-demo-account");
  return Object.freeze({
    groupHash: group.groupHash,
    recordCount: records.length,
    demoContext,
    classification,
    classificationIsAdvisory: true,
    comparisonDataComplete,
    members: Object.freeze(records.map((record) => Object.freeze({
      sourceHash: record.sourceHash,
      status: record.status,
      bankSettled: record.bankSettled,
      hasAttachment: record.hasAttachment,
      hasProjectAllocation: record.hasProjectAllocation,
      accountingJournalExists: record.accountingJournalExists,
    })).sort((left, right) => left.sourceHash.localeCompare(right.sourceHash))),
    relationships: Object.freeze({...relationships, allComparisonFieldsEquivalent}),
  });
}

function createBillCollisionReadOnlyAdapter(firestore, FieldPath) {
  if (!firestore || typeof firestore.collectionGroup !== "function" ||
      typeof firestore.doc !== "function" || typeof firestore.getAll !== "function") {
    throw new TypeError("A Firestore read client with bounded batch-get support is required.");
  }
  if (!FieldPath || typeof FieldPath.documentId !== "function") throw new TypeError("Firestore FieldPath is required.");

  return Object.freeze({
    async readCollisionEvidence(binding) {
      if (!binding || !Array.isArray(binding.groups) || binding.totalBills >= BILL_COLLISION_LIMITS.referenceCensusDocuments) {
        throw new TypeError("A bounded prior-audit collision binding is required.");
      }
      const censusSnapshot = await firestore.collectionGroup("bills")
        .select("billNumber", "invoiceNumber")
        .orderBy(FieldPath.documentId())
        .limit(BILL_COLLISION_LIMITS.referenceCensusDocuments)
        .get();
      const metrics = {
        documentsRead: censusSnapshot.docs.length,
        readOperations: 1,
        queryPages: 1,
        referenceCensusDocuments: censusSnapshot.docs.length,
        collisionDetailDocuments: 0,
        demoAccountDocuments: 0,
        accountingJournalDocuments: 0,
      };
      const incomplete = (reason, observed = {}) => Object.freeze({complete: false, reason, observed, metrics});
      if (censusSnapshot.docs.length >= BILL_COLLISION_LIMITS.referenceCensusDocuments) {
        return incomplete("bill-reference-census-cap-reached", {billCountAtCap: censusSnapshot.docs.length});
      }

      const entries = [];
      for (const snapshot of censusSnapshot.docs) {
        const identity = canonicalPath(snapshot.ref.path);
        if (!identity) return incomplete("unexpected-bill-document-path", {billCount: censusSnapshot.docs.length});
        const data = snapshot.data();
        const rawReference = sourceReference("bill", data);
        const key = await referenceRegistryKey("bill", rawReference);
        entries.push({
          ...identity,
          path: snapshot.ref.path,
          sourceHash: billSourceHash(identity.uid, identity.sourceId),
          rawReference: String(rawReference ?? ""),
          canonicalReferenceHash: key.canonicalReference ?
            sha256(key.canonicalReference) : "",
          updateTime: timestampIso(snapshot.updateTime),
        });
      }
      const grouped = new Map();
      for (const entry of entries.filter((item) => item.canonicalReferenceHash)) {
        const groupHash = billGroupHash(entry.uid, entry.canonicalReferenceHash);
        const group = grouped.get(groupHash) || {groupHash,uid:entry.uid,canonicalReferenceHash:entry.canonicalReferenceHash,sources:[]};
        group.sources.push(entry);
        grouped.set(groupHash,group);
      }
      const collisions = [...grouped.values()].filter((group) => group.sources.length > 1)
        .sort((left,right)=>left.groupHash.localeCompare(right.groupHash));
      for (const group of collisions) group.sources.sort((left,right)=>left.sourceHash.localeCompare(right.sourceHash));
      const observedManifestHash = collisionManifestHash(collisions);
      const observed = {
        billCount: entries.length,
        collisionGroups: collisions.length,
        collisionRecords: collisions.reduce((total,group)=>total+group.sources.length,0),
        collisionGroupSizes: collisions.map((group)=>group.sources.length).sort((a,b)=>a-b),
        collisionManifestHash: observedManifestHash,
      };
      if (observed.billCount !== binding.totalBills || observedManifestHash !== binding.collisionManifestHash ||
          observed.collisionGroups !== binding.collisionGroups || observed.collisionRecords !== binding.collisionRecords) {
        return incomplete("collision-membership-drift", observed);
      }
      if (observed.collisionRecords > BILL_COLLISION_LIMITS.collisionDetailDocuments ||
          new Set(collisions.map((group)=>group.uid)).size > BILL_COLLISION_LIMITS.demoAccountDocuments) {
        return incomplete("collision-detail-cap-exceeded", observed);
      }

      const collisionSources = collisions.flatMap((group)=>group.sources);
      const detailReferences = collisionSources.map((source)=>firestore.doc(source.path));
      const detailSnapshots = await firestore.getAll(...detailReferences,{fieldMask:[...BILL_DETAIL_FIELDS]});
      metrics.readOperations += 1;
      metrics.documentsRead += detailSnapshots.length;
      metrics.collisionDetailDocuments = detailSnapshots.length;
      if (detailSnapshots.length !== collisionSources.length) {
        return incomplete("collision-detail-partial-read", observed);
      }
      const details = new Map();
      for (const snapshot of detailSnapshots) {
        if (!snapshot.exists) return incomplete("collision-detail-partial-read", observed);
        const identity = canonicalPath(snapshot.ref.path);
        const census = collisionSources.find((source)=>source.uid===identity?.uid && source.sourceId===identity?.sourceId);
        if (!census || timestampIso(snapshot.updateTime) !== census.updateTime) {
          return incomplete("collision-source-changed-during-read", observed);
        }
        const data = snapshot.data();
        const key = await referenceRegistryKey("bill",sourceReference("bill",data));
        const currentGroupHash = key.canonicalReference ?
          billGroupHash(identity.uid,sha256(key.canonicalReference)) : "";
        if (!collisions.some((group)=>group.groupHash===currentGroupHash &&
            group.sources.some((source)=>source.sourceHash===billSourceHash(identity.uid,identity.sourceId)))) {
          return incomplete("collision-source-changed-during-read", observed);
        }
        details.set(snapshot.ref.path,{
          data,createTime:timestampIso(snapshot.createTime),updateTime:timestampIso(snapshot.updateTime)
        });
      }

      const collisionUids = [...new Set(collisions.map((group)=>group.uid))].sort();
      const demoSnapshots = await firestore.getAll(...collisionUids.map((uid)=>firestore.doc(`users/${uid}`)),{fieldMask:["demoMode"]});
      metrics.readOperations += 1;
      metrics.documentsRead += demoSnapshots.length;
      metrics.demoAccountDocuments = demoSnapshots.length;
      if (demoSnapshots.length !== collisionUids.length) return incomplete("demo-context-partial-read", observed);
      const demos = new Map(demoSnapshots.map((snapshot)=>{
        const uid=String(snapshot.ref.path).split("/")[1];
        return [uid,{exists:snapshot.exists,data:snapshot.exists?snapshot.data():{}}];
      }));

      const journalIds = collisionSources.map((source)=>billJournalId(source.uid,source.sourceId));
      const journalSnapshots = await firestore.getAll(...journalIds.map((id)=>firestore.doc(`journals/${id}`)),{fieldMask:[]});
      metrics.readOperations += 1;
      metrics.documentsRead += journalSnapshots.length;
      metrics.accountingJournalDocuments = journalSnapshots.length;
      if (journalSnapshots.length !== journalIds.length) return incomplete("accounting-journal-partial-read", observed);
      const journals = new Map(journalIds.map((id,index)=>[id,Boolean(journalSnapshots[index]?.exists)]));
      if (metrics.documentsRead > BILL_COLLISION_LIMITS.totalDocuments ||
          metrics.readOperations > BILL_COLLISION_LIMITS.readOperations) {
        return incomplete("diagnostic-read-cap-exceeded", observed);
      }

      const groups = collisions.map((group)=>safeGroupEvidence(group,details,demos.get(group.uid),journals));
      return Object.freeze({complete:true,reason:null,observed,groups:Object.freeze(groups),metrics:Object.freeze(metrics)});
    },
  });
}

module.exports = Object.freeze({
  billJournalId,
  createBillCollisionReadOnlyAdapter,
});
