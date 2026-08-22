/* eslint-disable max-len, require-jsdoc */

"use strict";

const {AccountDeletionError} = require("./account-deletion-error");

const STORAGE_REFERENCE_FIELDS = new Set([
  "attachmentPath",
  "companyLogoPath",
  "logoPath",
]);

function canonicalStoragePrefix(uid) {
  return `users/${uid}/`;
}

function addReferencedPaths(value, paths) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) addReferencedPaths(entry, paths);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (STORAGE_REFERENCE_FIELDS.has(key) && typeof entry === "string") {
      const path = entry.trim().replace(/^\/+/, "");
      if (path && !path.includes("\0")) paths.add(path);
    } else if (entry && typeof entry === "object") {
      addReferencedPaths(entry, paths);
    }
  }
}

async function visitDocumentTree(reference, paths) {
  const snapshot = await reference.get();
  if (snapshot.exists) addReferencedPaths(snapshot.data() || {}, paths);
  const collections = await reference.listCollections();
  for (const collection of collections) {
    const stream = collection.stream();
    for await (const documentSnapshot of stream) {
      addReferencedPaths(documentSnapshot.data() || {}, paths);
      await visitDocumentTree(documentSnapshot.ref, paths);
    }
  }
}

async function discoverProvenLegacyPaths(firestore, uid) {
  const paths = new Set();
  await visitDocumentTree(firestore.collection("users").doc(uid), paths);
  const canonicalPrefix = canonicalStoragePrefix(uid);
  return [...paths].filter((path) =>
    !path.startsWith(canonicalPrefix) && !path.startsWith("users/"));
}

function isMissingStorageError(error) {
  return error && (error.code === 404 || error.code === "404" ||
    error.code === "storage/object-not-found");
}

async function deleteExactFile(bucket, path) {
  try {
    await bucket.file(path).delete({ignoreNotFound: true});
  } catch (error) {
    if (!isMissingStorageError(error)) throw error;
  }
}

async function canonicalPage(bucket, prefix) {
  const response = await bucket.getFiles({
    autoPaginate: false,
    maxResults: 100,
    prefix,
  });
  return Array.isArray(response && response[0]) ? response[0] : [];
}

function createStorageAccountDeletionService(options = {}) {
  if (!options.bucket || !options.firestore) {
    throw new TypeError("Storage deletion dependencies are incomplete.");
  }
  const bucket = options.bucket;
  const firestore = options.firestore;

  return async function deleteAccountStorage(uid) {
    const prefix = canonicalStoragePrefix(uid);
    try {
      const legacyPaths = await discoverProvenLegacyPaths(firestore, uid);
      let deletedCanonicalObjects = 0;
      let canonicalObjectsRemain = true;
      while (canonicalObjectsRemain) {
        const files = await canonicalPage(bucket, prefix);
        canonicalObjectsRemain = files.length > 0;
        if (!canonicalObjectsRemain) break;
        await Promise.all(files.map(async (file) => {
          await deleteExactFile(bucket, file.name);
          deletedCanonicalObjects += 1;
        }));
      }
      for (const path of legacyPaths) await deleteExactFile(bucket, path);

      const remaining = await canonicalPage(bucket, prefix);
      if (remaining.length) {
        throw new AccountDeletionError("storage-verification-failed");
      }
      for (const path of legacyPaths) {
        try {
          await bucket.file(path).getMetadata();
          throw new AccountDeletionError("storage-verification-failed");
        } catch (error) {
          if (!isMissingStorageError(error)) throw error;
        }
      }
      return {deletedCanonicalObjects, deletedLegacyObjects: legacyPaths.length};
    } catch (error) {
      if (error instanceof AccountDeletionError) throw error;
      throw new AccountDeletionError("storage-cleanup-failed");
    }
  };
}

module.exports = {
  STORAGE_REFERENCE_FIELDS,
  addReferencedPaths,
  canonicalStoragePrefix,
  createStorageAccountDeletionService,
  discoverProvenLegacyPaths,
  isMissingStorageError,
};
