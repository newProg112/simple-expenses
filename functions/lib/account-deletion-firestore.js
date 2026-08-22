/* eslint-disable max-len, require-jsdoc */

"use strict";

const {AccountDeletionError} = require("./account-deletion-error");

const SECONDARY_UID_QUERIES = Object.freeze([
  {collection: "journals", field: "userId"},
  {collection: "adminActivityEvents", field: "uid"},
  {collection: "demoAnalyticsEvents", field: "uid"},
]);
const SECONDARY_DIRECT_DOCUMENTS = Object.freeze([
  {collection: "adminUserNotes"},
]);
const QUERY_DELETE_PAGE_SIZE = 200;

async function deleteMatchingQuery(firestore, definition, uid) {
  let deleted = 0;
  let documentsRemain = true;
  while (documentsRemain) {
    const snapshot = await firestore.collection(definition.collection)
        .where(definition.field, "==", uid)
        .limit(QUERY_DELETE_PAGE_SIZE)
        .get();
    documentsRemain = !snapshot.empty;
    if (!documentsRemain) break;
    const batch = firestore.batch();
    for (const documentSnapshot of snapshot.docs) batch.delete(documentSnapshot.ref);
    await batch.commit();
    deleted += snapshot.size;
  }
  return deleted;
}

async function queryHasMatch(firestore, definition, uid) {
  const snapshot = await firestore.collection(definition.collection)
      .where(definition.field, "==", uid).limit(1).get();
  return !snapshot.empty;
}

function createFirestoreAccountDeletionService(options = {}) {
  const firestore = options.firestore;
  if (!firestore || typeof firestore.recursiveDelete !== "function") {
    throw new TypeError("Firestore deletion dependencies are incomplete.");
  }

  return async function deleteAccountFirestore(uid) {
    const accountReference = firestore.collection("users").doc(uid);
    const profileReference = firestore.collection("userProfiles").doc(uid);
    try {
      const childCollections = await accountReference.listCollections();
      for (const collection of childCollections) {
        await firestore.recursiveDelete(collection);
      }
      await firestore.recursiveDelete(profileReference);

      let deletedSecondaryDocuments = 0;
      for (const definition of SECONDARY_UID_QUERIES) {
        deletedSecondaryDocuments += await deleteMatchingQuery(firestore, definition, uid);
      }
      for (const definition of SECONDARY_DIRECT_DOCUMENTS) {
        const reference = firestore.collection(definition.collection).doc(uid);
        await firestore.recursiveDelete(reference);
      }

      const remainingChildCollections = await accountReference.listCollections();
      if (remainingChildCollections.length) {
        throw new AccountDeletionError("firestore-user-tree-verification-failed");
      }
      const profileSnapshot = await profileReference.get();
      const profileChildren = await profileReference.listCollections();
      if (profileSnapshot.exists || profileChildren.length) {
        throw new AccountDeletionError("firestore-profile-verification-failed");
      }
      for (const definition of SECONDARY_UID_QUERIES) {
        if (await queryHasMatch(firestore, definition, uid)) {
          throw new AccountDeletionError("firestore-secondary-verification-failed");
        }
      }
      for (const definition of SECONDARY_DIRECT_DOCUMENTS) {
        const reference = firestore.collection(definition.collection).doc(uid);
        const [snapshot, children] = await Promise.all([
          reference.get(),
          reference.listCollections(),
        ]);
        if (snapshot.exists || children.length) {
          throw new AccountDeletionError("firestore-secondary-verification-failed");
        }
      }

      await accountReference.delete();
      if ((await accountReference.get()).exists) {
        throw new AccountDeletionError("firestore-root-verification-failed");
      }
      return {
        deletedUserCollections: childCollections.length,
        deletedSecondaryDocuments,
      };
    } catch (error) {
      if (error instanceof AccountDeletionError) throw error;
      throw new AccountDeletionError("firestore-cleanup-failed");
    }
  };
}

module.exports = {
  QUERY_DELETE_PAGE_SIZE,
  SECONDARY_DIRECT_DOCUMENTS,
  SECONDARY_UID_QUERIES,
  createFirestoreAccountDeletionService,
  deleteMatchingQuery,
  queryHasMatch,
};
