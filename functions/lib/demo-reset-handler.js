/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  createAdminFirestoreServices,
  defaultSeedModuleLoader,
  moduleCounts,
  safeUidSuffix,
} = require("./admin-demo-seed-handler");
const {privacySafeErrorCode} = require("./admin-metrics-handler");

function resetError(code, message, stage, details = {}) {
  return new HttpsError(code, message, {stage, ...details});
}

function emptyRequestData(data) {
  return data === undefined || data === null ||
    (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
}

function createDemoResetHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  const loadSeedModules = source.loadSeedModules || defaultSeedModuleLoader;

  return async (request) => {
    const uid = request && request.auth && request.auth.uid;
    if (!uid) {
      throw resetError(
          "unauthenticated",
          "You must be signed in to reset the demo account.",
          "validation",
      );
    }
    if (!emptyRequestData(request.data)) {
      throw resetError(
          "invalid-argument",
          "Demo reset does not accept a target account.",
          "validation",
      );
    }

    const uidSuffix = safeUidSuffix(uid);
    let accountSnapshot;
    try {
      accountSnapshot = await source.firestore.collection("users").doc(uid).get();
    } catch (error) {
      log.error("Demo reset account lookup failed", {
        uidSuffix,
        code: privacySafeErrorCode(error),
      });
      throw resetError(
          "internal",
          "The demo account could not be checked.",
          "validation",
      );
    }

    const accountData = accountSnapshot.exists ? accountSnapshot.data() || {} : {};
    if (accountData.demoMode !== true) {
      throw resetError(
          "failed-precondition",
          "Reset Demo is available only for the shared demo account.",
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
      log.error("Demo reset seed validation failed", {
        uidSuffix,
        code: privacySafeErrorCode(error),
      });
      throw resetError(
          "failed-precondition",
          "The canonical demo seed failed validation.",
          "validation",
      );
    }

    const context = {
      user: {uid},
      accountData,
      services: createAdminFirestoreServices(source.firestore),
      seed: modules.seedModule.DEMO_SEED,
    };

    log.info("Demo reset started", {uidSuffix});
    let clearResult;
    try {
      clearResult = await modules.engine.clearDemoBusiness(context);
    } catch (error) {
      log.error("Demo reset clearing failed", {
        uidSuffix,
        code: privacySafeErrorCode(error),
      });
      throw resetError(
          "internal",
          "Managed demo data could not be cleared.",
          "clearing",
      );
    }

    let seedResult;
    try {
      seedResult = await modules.engine.seedDemoBusiness(context);
    } catch (error) {
      log.error("Demo reset seeding failed after clearing", {
        uidSuffix,
        clearedDocuments: clearResult.deletedDocuments,
        code: privacySafeErrorCode(error),
      });
      throw resetError(
          "internal",
          "Canonical demo data could not be restored after clearing.",
          "seeding",
          {clearedDocuments: clearResult.deletedDocuments},
      );
    }

    const journals = modules.engine.buildDemoJournalRecords(
        uid,
        modules.seedModule.DEMO_SEED,
    );
    const result = {
      seedVersion: seedResult.seedVersion,
      clearedDocuments: clearResult.deletedDocuments,
      writtenDocuments: seedResult.writtenDocuments,
      committedBatches: {
        clearing: clearResult.committedBatches,
        seeding: seedResult.committedBatches,
      },
      preservedAccountDocument: clearResult.preservedAccountDocument === true,
      counts: moduleCounts(modules.seedModule.DEMO_SEED, journals.length),
    };

    log.info("Demo reset completed", {
      uidSuffix,
      seedVersion: result.seedVersion,
      clearedDocuments: result.clearedDocuments,
      writtenDocuments: result.writtenDocuments,
    });
    return result;
  };
}

module.exports = {
  createDemoResetHandler,
  emptyRequestData,
};
