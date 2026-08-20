"use strict";

function snapshotDocument(snapshot) {
  return Object.freeze({
    id: String(snapshot.id),
    path: String(snapshot.ref.path),
    updateTime: snapshot.updateTime || null,
    data: snapshot.data(),
  });
}

function createReadOnlyFirestoreAdapter(firestore, FieldPath) {
  if (!firestore || typeof firestore.collection !== "function" || typeof firestore.collectionGroup !== "function") {
    throw new TypeError("A Firestore read client is required.");
  }
  if (!FieldPath || typeof FieldPath.documentId !== "function") throw new TypeError("Firestore FieldPath is required.");

  async function page(query, pageSize, cursor) {
    let ordered = query.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) ordered = ordered.startAfter(cursor);
    const snapshot = await ordered.get();
    return Object.freeze({
      documents: Object.freeze(snapshot.docs.map(snapshotDocument)),
      nextCursor: snapshot.docs.length === pageSize ? snapshot.docs.at(-1) : null,
    });
  }

  return Object.freeze({
    readCollectionGroupPage(collectionName, pageSize, cursor) {
      return page(firestore.collectionGroup(collectionName), pageSize, cursor);
    },
    readUserCollectionPage(uid, collectionName, pageSize, cursor) {
      return page(firestore.collection(`users/${uid}/${collectionName}`), pageSize, cursor);
    },
  });
}

module.exports = {createReadOnlyFirestoreAdapter};
