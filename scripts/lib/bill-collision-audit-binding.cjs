"use strict";

const {sha256} = require("./production-reference-audit.cjs");
const {
  BILL_COLLISION_DIAGNOSTIC_TARGET,
  BILL_COLLISION_PRODUCTION_STATE,
} = require("./bill-collision-diagnostic-config.cjs");

const HASH_PATTERN = /^[a-f\d]{64}$/;

function hashValue(value, label) {
  const text = String(value || "").trim();
  if (!HASH_PATTERN.test(text)) throw new TypeError(`${label} must be 64 lowercase hexadecimal characters.`);
  return text;
}

function identifier(value, label) {
  const text = String(value || "").trim();
  if (!text || text.includes("/") || /\s/.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function billGroupHash(uid, canonicalReferenceHash) {
  return sha256(`bill-collision-group:v1\0${uid}\0${canonicalReferenceHash}`);
}

function billSourceHash(uid, sourceId) {
  return sha256(`bill-collision-source:v1\0users/${uid}/bills/${sourceId}`);
}

function collisionManifestHash(groups) {
  return sha256(groups.map((group) => ({
    groupHash: group.groupHash,
    sourceHashes: [...group.sources].map((source) => source.sourceHash).sort(),
  })).sort((left, right) => left.groupHash.localeCompare(right.groupHash)));
}

function recomputeAuditHash(report) {
  const stateWarnings = (Array.isArray(report.warnings) ? report.warnings : []).map((warning) =>
    warning?.code === "unexpected-census-document-path" ? {
      code: warning.code,
      collectionName: warning.collectionName,
      pathHash: warning.pathHash,
    } : warning);
  return sha256({
    schemaVersion: report.schemaVersion,
    auditVersion: report.auditVersion,
    projectId: report.projectId,
    databaseId: report.databaseId,
    censusHash: report?.hashes?.censusHash,
    perUid: (Array.isArray(report.perUid) ? report.perUid : []).map((entry) => ({
      uid: entry.uid,
      combinedAuditHash: entry?.hashes?.combinedAuditHash,
    })),
    totals: report.globalTotals,
    expectedBackfillWrites: report.expectedBackfillWrites,
    blockers: report.blockers,
    warnings: stateWarnings,
  });
}

function collisionGroupsFromAudit(report) {
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const collisions = blockers.filter((entry) =>
    entry?.code === "canonical-collision-group" && entry?.recordType === "bill");
  const groups = collisions.map((entry) => {
    const uid = identifier(entry.uid, "Collision UID");
    const canonicalReferenceHash = hashValue(entry.canonicalReferenceHash, "Canonical reference hash");
    const ids = Array.isArray(entry.sourceIds) ? entry.sourceIds.map((id) => identifier(id, "Bill source ID")) : [];
    if (ids.length < 2 || new Set(ids).size !== ids.length || Number(entry.count) !== ids.length) {
      throw new TypeError("Prior audit contains an invalid Bill collision group.");
    }
    const groupHash = billGroupHash(uid, canonicalReferenceHash);
    return Object.freeze({
      uid,
      canonicalReferenceHash,
      groupHash,
      sources: Object.freeze(ids.sort().map((sourceId) => Object.freeze({
        uid,
        sourceId,
        sourceHash: billSourceHash(uid, sourceId),
      }))),
    });
  }).sort((left, right) => left.groupHash.localeCompare(right.groupHash));
  if (new Set(groups.map((group) => group.groupHash)).size !== groups.length) {
    throw new TypeError("Prior audit contains duplicate Bill collision groups.");
  }
  return Object.freeze(groups);
}

function buildCollisionAuditBinding(report, input = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new TypeError("Prior audit artifact is invalid.");
  const projectId = identifier(input.projectId || report.projectId, "Project ID");
  const databaseId = identifier(input.databaseId || report.databaseId, "Database ID");
  if (report.projectId !== projectId || report.databaseId !== databaseId) {
    throw new TypeError("Prior audit project/database does not match the requested target.");
  }
  if (report?.scan?.complete !== true || report?.census?.complete !== true ||
      report?.census?.mode !== "complete-census" || report?.census?.approvalScopeComplete !== true) {
    throw new TypeError("Prior audit must be a complete approval-scope census.");
  }
  const artifactAuditHash = hashValue(report?.hashes?.overallAuditHash, "Prior audit hash");
  const expectedAuditHash = hashValue(input.expectedAuditHash, "Expected audit hash");
  if (artifactAuditHash !== expectedAuditHash) throw new TypeError("Prior audit hash does not match the explicitly expected hash.");
  if (recomputeAuditHash(report) !== artifactAuditHash) throw new TypeError("Prior audit artifact integrity verification failed.");

  const groups = collisionGroupsFromAudit(report);
  const collisionRecords = groups.reduce((total, group) => total + group.sources.length, 0);
  const totalBills = Number(report?.globalTotals?.bills?.totalCount);
  const binding = {
    projectId,
    databaseId,
    priorAuditHash: artifactAuditHash,
    totalBills,
    collisionGroups: groups.length,
    collisionRecords,
    collisionGroupSizes: groups.map((group) => group.sources.length).sort((left, right) => left - right),
    groups,
  };
  binding.collisionManifestHash = collisionManifestHash(groups);

  if (input.production) {
    if (projectId !== BILL_COLLISION_DIAGNOSTIC_TARGET.projectId || databaseId !== BILL_COLLISION_DIAGNOSTIC_TARGET.databaseId) {
      throw new TypeError("Production collision binding target is not approved.");
    }
    const expected = BILL_COLLISION_PRODUCTION_STATE;
    if (binding.totalBills !== expected.totalBills || binding.collisionGroups !== expected.collisionGroups ||
        binding.collisionRecords !== expected.collisionRecords ||
        JSON.stringify(binding.collisionGroupSizes) !== JSON.stringify(expected.collisionGroupSizes)) {
      throw new TypeError("Prior audit does not match the frozen production Bill collision state.");
    }
  }
  if (input.expectedManifestHash) {
    const manifest = hashValue(input.expectedManifestHash, "Expected collision manifest hash");
    if (manifest !== binding.collisionManifestHash) {
      throw new TypeError("Collision manifest hash does not match the prior audit.");
    }
  }
  return Object.freeze(binding);
}

module.exports = Object.freeze({
  billGroupHash,
  billSourceHash,
  buildCollisionAuditBinding,
  collisionManifestHash,
  recomputeAuditHash,
});
