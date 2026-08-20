import {
  isSafeDocumentReference,
  normaliseDocumentReference
} from "./bank-match-identity.js";

const SOURCE_CONFIG = Object.freeze({
  invoice:Object.freeze({ primaryField:"invoiceNo",legacyField:"invoiceNumber" }),
  bill:Object.freeze({ primaryField:"billNumber",legacyField:"invoiceNumber" })
});

function compareText(left,right){
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasOwn(record,field){
  return Boolean(record && Object.prototype.hasOwnProperty.call(record,field));
}

function storedReference(record,config){
  return record?.[config.primaryField] || record?.[config.legacyField] || "";
}

function canonicalField(record,field){
  return normaliseDocumentReference(record?.[field]);
}

function recordAudit(record,config){
  const visibleReference = String(storedReference(record,config));
  const canonicalReference = normaliseDocumentReference(visibleReference);
  const primaryCanonical = canonicalField(record,config.primaryField);
  const legacyCanonical = canonicalField(record,config.legacyField);
  const hasPrimaryField = hasOwn(record,config.primaryField);
  const hasLegacyField = hasOwn(record,config.legacyField);

  return Object.freeze({
    documentId:String(record?.id || ""),
    visibleReference,
    canonicalReference,
    blank:canonicalReference === "",
    safe:isSafeDocumentReference(visibleReference),
    legacyFallback:Boolean(!record?.[config.primaryField] && record?.[config.legacyField]),
    bothReferenceFields:hasPrimaryField && hasLegacyField,
    conflictingReferenceFields:Boolean(primaryCanonical && legacyCanonical && primaryCanonical !== legacyCanonical)
  });
}

function collisionGroup(sourceType,canonicalReference,records){
  return Object.freeze({
    sourceType,
    canonicalReference,
    visibleReferences:Object.freeze([...new Set(records.map(record => record.visibleReference))].sort(compareText)),
    documentIds:Object.freeze(records.map(record => record.documentId).sort(compareText)),
    count:records.length
  });
}

function auditSource(sourceType,records){
  const config = SOURCE_CONFIG[sourceType];
  const audited = (Array.isArray(records) ? records : []).map(record => recordAudit(record,config));
  const canonicalGroups = new Map();

  audited.filter(record => !record.blank).forEach(record => {
    const group = canonicalGroups.get(record.canonicalReference) || [];
    group.push(record);
    canonicalGroups.set(record.canonicalReference,group);
  });

  const collisionGroups = [...canonicalGroups.entries()]
    .filter(([,group]) => group.length > 1)
    .map(([canonicalReference,group]) => collisionGroup(sourceType,canonicalReference,group))
    .sort((left,right) => compareText(left.canonicalReference,right.canonicalReference));

  return Object.freeze({
    sourceType,
    totalRecords:audited.length,
    blankReferences:audited.filter(record => record.blank).length,
    uniqueCanonicalReferences:[...canonicalGroups.values()].filter(group => group.length === 1).length,
    canonicalCollisionGroups:collisionGroups.length,
    recordsInCanonicalCollisions:collisionGroups.reduce((total,group) => total + group.count,0),
    unsafeReferences:audited.filter(record => !record.safe).length,
    legacyFallbackRecords:audited.filter(record => record.legacyFallback).length,
    bothReferenceFieldsRecords:audited.filter(record => record.bothReferenceFields).length,
    conflictingReferenceFieldsRecords:audited.filter(record => record.conflictingReferenceFields).length,
    collisionGroups:Object.freeze(collisionGroups)
  });
}

export function auditReferenceIntegrity(sources = {}){
  return Object.freeze({
    invoices:auditSource("invoice",sources.invoices),
    bills:auditSource("bill",sources.bills)
  });
}
