/* eslint-disable max-len, require-jsdoc */

"use strict";

const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {access} = require("node:fs/promises");
const {HttpsError} = require("firebase-functions/v2/https");
const {FieldValue} = require("firebase-admin/firestore");
const {referenceRegistryKey} = require("./reference-registry-key");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
} = require("./admin-authorization");
const {privacySafeErrorCode} = require("./admin-metrics-handler");

function requestedTargetUid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  if (Object.keys(data).length !== 1 || typeof data.targetUid !== "string") return "";
  const uid = data.targetUid.trim();
  return uid && uid.length <= 128 && !uid.includes("/") && !/\s/.test(uid) ? uid : "";
}

function safeUidSuffix(uid) {
  const value = String(uid || "");
  return value ? value.slice(-8) : "missing";
}

function createAdminFirestoreServices(firestore) {
  return {
    db: firestore,
    doc: (db, ...segments) => db.doc(segments.join("/")),
    collection: (db, ...segments) => db.collection(segments.join("/")),
    getDoc: (reference) => reference.get(),
    getDocs: (reference) => reference.get(),
    where: (field, operator, value) => ({field, operator, value}),
    query: (reference, constraint) => reference.where(
        constraint.field,
        constraint.operator,
        constraint.value,
    ),
    writeBatch: (db) => db.batch(),
    referenceRegistryKey,
    serverTimestamp: () => FieldValue.serverTimestamp(),
  };
}

async function defaultSeedModuleLoader() {
  const candidates = [
    path.resolve(__dirname, "../../assets"),
    path.resolve(__dirname, "../generated/assets"),
  ];

  for (const directory of candidates) {
    const enginePath = path.join(directory, "demo-seed-engine.js");
    const seedPath = path.join(directory, "demo-seed.js");
    try {
      await Promise.all([access(enginePath), access(seedPath)]);
      const [engine, seedModule] = await Promise.all([
        import(pathToFileURL(enginePath).href),
        import(pathToFileURL(seedPath).href),
      ]);
      return {engine, seedModule};
    } catch (error) {
      if (directory === candidates.at(-1)) throw error;
    }
  }

  throw new Error("Demo seed runtime modules are unavailable.");
}

function moduleCounts(seed, journalCount) {
  return {
    businessProfile: seed && seed.businessProfile ? 1 : 0,
    customers: Array.isArray(seed && seed.customers) ? seed.customers.length : 0,
    projects: Array.isArray(seed && seed.projects) ? seed.projects.length : 0,
    invoices: Array.isArray(seed && seed.invoices) ? seed.invoices.length : 0,
    bills: Array.isArray(seed && seed.bills) ? seed.bills.length : 0,
    expenses: Array.isArray(seed && seed.expenses) ? seed.expenses.length : 0,
    mileage: Array.isArray(seed && seed.mileage) ? seed.mileage.length : 0,
    budgets: Array.isArray(seed && seed.budgets) ? seed.budgets.length : 0,
    journals: Number(journalCount) || 0,
  };
}

function stageError(code, message, stage, details = {}) {
  return new HttpsError(code, message, {stage, ...details});
}

function createAdminDemoSeedHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  const loadSeedModules = source.loadSeedModules || defaultSeedModuleLoader;

  return async (request) => {
    let authorization;
    try {
      authorization = adminAuthorizationDecision(
          request && request.auth,
          source.adminUidConfiguration,
      );
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        log.error("Admin demo seed configuration rejected", {code: error.code});
        throw stageError(
            "failed-precondition",
            "Demo environment administration is not configured.",
            "validation",
        );
      }
      throw error;
    }

    if (authorization === "unauthenticated") {
      throw stageError(
          "unauthenticated",
          "You must be signed in to seed the demo environment.",
          "validation",
      );
    }
    if (authorization !== "allowed") {
      throw stageError(
          "permission-denied",
          "You do not have permission to seed the demo environment.",
          "validation",
      );
    }

    const targetUid = requestedTargetUid(request && request.data);
    if (!targetUid) {
      throw stageError("invalid-argument", "A valid target UID is required.", "validation");
    }

    const targetSuffix = safeUidSuffix(targetUid);
    const targetReference = source.firestore.collection("users").doc(targetUid);
    let targetSnapshot;
    try {
      targetSnapshot = await targetReference.get();
    } catch (error) {
      log.error("Admin demo target lookup failed", {
        targetUidSuffix: targetSuffix,
        code: privacySafeErrorCode(error),
      });
      throw stageError("internal", "The target account could not be checked.", "validation");
    }

    if (!targetSnapshot.exists) {
      throw stageError("not-found", "No users document exists for that UID.", "validation");
    }

    const accountData = targetSnapshot.data() || {};
    if (accountData.demoMode !== true) {
      throw stageError(
          "failed-precondition",
          "The target must have demoMode set to Boolean true.",
          "validation",
      );
    }

    let modules;
    try {
      modules = await loadSeedModules();
      const validation = modules.engine.validateDemoSeed(modules.seedModule.DEMO_SEED);
      if (!validation.valid) {
        throw new Error(`Seed validation returned ${validation.errors.length} errors.`);
      }
    } catch (error) {
      log.error("Admin demo seed validation failed", {
        targetUidSuffix: targetSuffix,
        code: privacySafeErrorCode(error),
      });
      throw stageError("failed-precondition", "The canonical demo seed failed validation.", "validation");
    }

    const services = createAdminFirestoreServices(source.firestore);
    const context = {
      user: {uid: targetUid},
      accountData,
      services,
      seed: modules.seedModule.DEMO_SEED,
    };

    log.info("Admin demo seed started", {
      operatorUidSuffix: safeUidSuffix(request.auth.uid),
      targetUidSuffix: targetSuffix,
    });

    let clearResult;
    try {
      clearResult = await modules.engine.clearDemoBusiness(context);
    } catch (error) {
      log.error("Admin demo clearing failed", {
        targetUidSuffix: targetSuffix,
        code: privacySafeErrorCode(error),
      });
      throw stageError("internal", "Managed demo data could not be cleared.", "clearing");
    }

    let seedResult;
    try {
      seedResult = await modules.engine.seedDemoBusiness(context);
    } catch (error) {
      log.error("Admin demo seeding failed after clearing", {
        targetUidSuffix: targetSuffix,
        clearedDocuments: clearResult.deletedDocuments,
        code: privacySafeErrorCode(error),
      });
      throw stageError(
          "internal",
          "The canonical demo data could not be seeded after clearing.",
          "seeding",
          {clearedDocuments: clearResult.deletedDocuments},
      );
    }

    const journals = modules.engine.buildDemoJournalRecords(
        targetUid,
        modules.seedModule.DEMO_SEED,
    );
    const result = {
      targetUid,
      seedVersion: seedResult.seedVersion,
      clearedDocuments: clearResult.deletedDocuments,
      writtenDocuments: seedResult.writtenDocuments,
      referenceClaims: seedResult.referenceClaims,
      committedBatches: {
        clearing: clearResult.committedBatches,
        seeding: seedResult.committedBatches,
      },
      preservedAccountDocument: clearResult.preservedAccountDocument === true,
      counts: moduleCounts(modules.seedModule.DEMO_SEED, journals.length),
    };

    log.info("Admin demo seed completed", {
      targetUidSuffix: targetSuffix,
      seedVersion: result.seedVersion,
      clearedDocuments: result.clearedDocuments,
      writtenDocuments: result.writtenDocuments,
    });
    return result;
  };
}

module.exports = {
  createAdminDemoSeedHandler,
  createAdminFirestoreServices,
  defaultSeedModuleLoader,
  moduleCounts,
  requestedTargetUid,
  safeUidSuffix,
};
