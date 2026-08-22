/* eslint-disable max-len, require-jsdoc */

"use strict";

const crypto = require("node:crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {
  ACCOUNT_DELETION_SCHEMA_VERSION,
  ACCOUNT_DELETION_STAGE,
  ACCOUNT_DELETION_STATUS,
  assertAccountMayBeDeleted,
  protectedConfiguration,
  validExistingJob,
} = require("./account-deletion-handler");
const {
  ACCOUNT_DELETION_JOBS_COLLECTION,
  snapshotExists,
} = require("./account-deletion-guard");
const {AccountDeletionError, deletionErrorCode} = require("./account-deletion-error");

const ACCOUNT_DELETION_MAX_FAILURES = 8;
const ACCOUNT_DELETION_LEASE_MS = 35 * 60 * 1000;
const ACCOUNT_DELETION_TOMBSTONE_RETENTION_MS = 48 * 60 * 60 * 1000;

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return new Date(value || 0).getTime();
}

function taskUid(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    Object.keys(data).sort().join(",") !== "uid" || typeof data.uid !== "string" ||
    !data.uid || data.uid.length > 128 || data.uid.includes("/")) {
    throw new AccountDeletionError("account-deletion-task-invalid");
  }
  return data.uid;
}

function authUserMissing(error) {
  return String(error && error.code || "") === "auth/user-not-found";
}

function deletionJobHash(uid) {
  return crypto.createHash("sha256").update(uid).digest("hex").slice(0, 12);
}

function validWorkerJob(job, uid) {
  if (job && job.status === ACCOUNT_DELETION_STATUS.COMPLETED &&
    job.stage === ACCOUNT_DELETION_STAGE.COMPLETED) {
    return job.schemaVersion === ACCOUNT_DELETION_SCHEMA_VERSION && job.uid === uid;
  }
  return validExistingJob(job, uid);
}

function createAccountDeletionWorker(options = {}) {
  const source = options;
  if (!source.firestore || !source.auth || !source.fieldValue ||
    !source.timestampFactory || !source.stripeCleanup ||
    !source.storageCleanup || !source.firestoreCleanup) {
    throw new TypeError("Account deletion worker dependencies are incomplete.");
  }
  const now = () => new Date(source.now ? source.now() : new Date());
  const logger = source.logger || console;
  const log = (level, event, uid, details = {}) => {
    if (typeof logger[level] === "function") {
      logger[level]("account deletion worker", {
        event,
        jobHash: deletionJobHash(uid),
        ...details,
      });
    }
  };
  const configuration = () => protectedConfiguration(source);
  const jobReference = (uid) => source.firestore
      .collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc(uid);

  async function assertStillUnprotected(uid) {
    const [accountSnapshot, authResult] = await Promise.all([
      source.firestore.collection("users").doc(uid).get(),
      source.auth.getUser(uid).then(
          (user) => ({user}),
          (error) => authUserMissing(error) ? ({user: {uid}}) : Promise.reject(error),
      ),
    ]);
    const account = snapshotExists(accountSnapshot) ? accountSnapshot.data() || {} : {};
    try {
      assertAccountMayBeDeleted({
        uid,
        authUser: authResult.user,
        account,
        configuration: configuration(),
      });
    } catch (error) {
      if (error instanceof HttpsError) {
        throw new AccountDeletionError(
            error.details && error.details.reason === "protected-account" ?
              "protected-account" : "protected-account-configuration-invalid",
        );
      }
      throw error;
    }
  }

  async function acquireLease(uid, leaseToken) {
    const reference = jobReference(uid);
    return source.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshotExists(snapshot)) return {state: "missing"};
      const job = snapshot.data() || {};
      if (!validWorkerJob(job, uid)) {
        throw new AccountDeletionError("account-deletion-job-invalid");
      }
      if (job.status === ACCOUNT_DELETION_STATUS.COMPLETED) return {state: "completed"};
      if (job.status === ACCOUNT_DELETION_STATUS.NEEDS_ATTENTION) return {state: "needs_attention"};
      if (job.leaseToken && timestampMillis(job.leaseExpiresAt) > now().getTime()) {
        return {state: "leased"};
      }
      const currentTime = now();
      transaction.update(reference, {
        leaseToken,
        leaseAcquiredAt: source.fieldValue.serverTimestamp(),
        leaseExpiresAt: source.timestampFactory.fromDate(
            new Date(currentTime.getTime() + ACCOUNT_DELETION_LEASE_MS),
        ),
        updatedAt: source.fieldValue.serverTimestamp(),
      });
      return {state: "acquired", stage: job.stage};
    });
  }

  async function checkpoint(uid, leaseToken, expectedStage, nextStage) {
    const reference = jobReference(uid);
    return source.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const job = snapshotExists(snapshot) ? snapshot.data() || {} : {};
      if (!validWorkerJob(job, uid) || job.status !== ACCOUNT_DELETION_STATUS.ACTIVE ||
        job.leaseToken !== leaseToken || job.stage !== expectedStage) {
        throw new AccountDeletionError("account-deletion-checkpoint-conflict");
      }
      transaction.update(reference, {
        stage: nextStage,
        lastErrorCode: "",
        leaseExpiresAt: source.timestampFactory.fromDate(
            new Date(now().getTime() + ACCOUNT_DELETION_LEASE_MS),
        ),
        updatedAt: source.fieldValue.serverTimestamp(),
      });
    });
  }

  async function recordFailure(uid, leaseToken, error) {
    const reference = jobReference(uid);
    return source.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshotExists(snapshot)) return {recorded: false};
      const job = snapshot.data() || {};
      if (!validWorkerJob(job, uid) || job.leaseToken !== leaseToken ||
        job.status !== ACCOUNT_DELETION_STATUS.ACTIVE) return {recorded: false};
      const retryCount = Number(job.retryCount || 0) + 1;
      const needsAttention = retryCount >= ACCOUNT_DELETION_MAX_FAILURES;
      transaction.update(reference, {
        retryCount,
        status: needsAttention ? ACCOUNT_DELETION_STATUS.NEEDS_ATTENTION : ACCOUNT_DELETION_STATUS.ACTIVE,
        lastErrorCode: deletionErrorCode(error),
        leaseToken: source.fieldValue.delete(),
        leaseAcquiredAt: source.fieldValue.delete(),
        leaseExpiresAt: source.fieldValue.delete(),
        updatedAt: source.fieldValue.serverTimestamp(),
      });
      return {recorded: true, needsAttention};
    });
  }

  async function deleteAuthUser(uid) {
    try {
      await source.auth.deleteUser(uid);
    } catch (error) {
      if (!authUserMissing(error)) throw new AccountDeletionError("auth-cleanup-failed");
    }
    try {
      await source.auth.getUser(uid);
      throw new AccountDeletionError("auth-verification-failed");
    } catch (error) {
      if (authUserMissing(error)) return;
      if (error instanceof AccountDeletionError) throw error;
      throw new AccountDeletionError("auth-verification-failed");
    }
  }

  async function complete(uid, leaseToken) {
    const reference = jobReference(uid);
    await source.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const job = snapshotExists(snapshot) ? snapshot.data() || {} : {};
      if (!validWorkerJob(job, uid) || job.status !== ACCOUNT_DELETION_STATUS.ACTIVE ||
        job.leaseToken !== leaseToken || job.stage !== ACCOUNT_DELETION_STAGE.AUTH) {
        throw new AccountDeletionError("account-deletion-checkpoint-conflict");
      }
      const completedAt = now();
      transaction.set(reference, {
        schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
        uid,
        stage: ACCOUNT_DELETION_STAGE.COMPLETED,
        status: ACCOUNT_DELETION_STATUS.COMPLETED,
        completedAt: source.fieldValue.serverTimestamp(),
        tombstoneExpiresAt: source.timestampFactory.fromDate(
            new Date(completedAt.getTime() + ACCOUNT_DELETION_TOMBSTONE_RETENTION_MS),
        ),
        updatedAt: source.fieldValue.serverTimestamp(),
      });
    });
  }

  return async function processAccountDeletion(request) {
    const uid = taskUid(request && request.data);
    const leaseToken = crypto.randomUUID();
    const lease = await acquireLease(uid, leaseToken);
    if (["missing", "completed", "needs_attention"].includes(lease.state)) {
      log("info", "task-noop", uid, {state: lease.state});
      return {processed: false, state: lease.state};
    }
    if (lease.state === "leased") {
      log("info", "lease-held", uid);
      throw new AccountDeletionError("account-deletion-lease-held");
    }
    let stage = lease.stage;
    try {
      while (stage !== ACCOUNT_DELETION_STAGE.COMPLETED) {
        log("info", "stage-started", uid, {stage});
        await assertStillUnprotected(uid);
        if (stage === ACCOUNT_DELETION_STAGE.REQUESTED) {
          await checkpoint(uid, leaseToken, stage, ACCOUNT_DELETION_STAGE.STRIPE);
          stage = ACCOUNT_DELETION_STAGE.STRIPE;
          continue;
        }
        if (stage === ACCOUNT_DELETION_STAGE.STRIPE) {
          await source.stripeCleanup(uid);
          await checkpoint(uid, leaseToken, stage, ACCOUNT_DELETION_STAGE.STORAGE);
          stage = ACCOUNT_DELETION_STAGE.STORAGE;
          continue;
        }
        if (stage === ACCOUNT_DELETION_STAGE.STORAGE) {
          await source.storageCleanup(uid);
          await checkpoint(uid, leaseToken, stage, ACCOUNT_DELETION_STAGE.FIRESTORE);
          stage = ACCOUNT_DELETION_STAGE.FIRESTORE;
          continue;
        }
        if (stage === ACCOUNT_DELETION_STAGE.FIRESTORE) {
          await source.firestoreCleanup(uid);
          await checkpoint(uid, leaseToken, stage, ACCOUNT_DELETION_STAGE.AUTH);
          stage = ACCOUNT_DELETION_STAGE.AUTH;
          continue;
        }
        if (stage === ACCOUNT_DELETION_STAGE.AUTH) {
          await deleteAuthUser(uid);
          await complete(uid, leaseToken);
          stage = ACCOUNT_DELETION_STAGE.COMPLETED;
          continue;
        }
        throw new AccountDeletionError("account-deletion-stage-invalid");
      }
      log("info", "completed", uid);
      return {processed: true, state: ACCOUNT_DELETION_STATUS.COMPLETED};
    } catch (error) {
      const failure = await recordFailure(uid, leaseToken, error);
      log("warn", "stage-failed", uid, {
        stage,
        errorCode: deletionErrorCode(error),
        needsAttention: Boolean(failure.needsAttention),
      });
      if (failure.needsAttention) {
        return {processed: false, state: ACCOUNT_DELETION_STATUS.NEEDS_ATTENTION};
      }
      throw error;
    }
  };
}

module.exports = {
  ACCOUNT_DELETION_LEASE_MS,
  ACCOUNT_DELETION_MAX_FAILURES,
  ACCOUNT_DELETION_TOMBSTONE_RETENTION_MS,
  authUserMissing,
  createAccountDeletionWorker,
  deletionJobHash,
  taskUid,
  timestampMillis,
  validWorkerJob,
};
