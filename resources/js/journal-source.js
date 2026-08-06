import { validateJournal } from "./ledger-engine.js";
import {
  journalFromFirestoreData,
  requireJournalOwnerId
} from "./trial-balance-view.js";

export function ownedJournalQuery(db, userId, firestoreApi){
  const ownerId = requireJournalOwnerId(userId);
  return firestoreApi.query(
    firestoreApi.collection(db, "journals"),
    firestoreApi.where("userId", "==", ownerId)
  );
}

export function normaliseJournalSnapshot(snapshot){
  const journals = [];
  let skippedCount = 0;

  for(const documentSnapshot of snapshot?.docs || []){
    const journal = journalFromFirestoreData(
      documentSnapshot.id,
      documentSnapshot.data()
    );
    const validation = validateJournal(journal);
    if(validation.valid){
      journals.push(journal);
    }else{
      skippedCount += 1;
    }
  }

  return { journals, skippedCount };
}

export async function loadOwnedJournals(db, userId, firestoreApi){
  const snapshot = await firestoreApi.getDocs(
    ownedJournalQuery(db, userId, firestoreApi)
  );
  return normaliseJournalSnapshot(snapshot);
}

export function partialJournalDataMessage(failures = [], notices = []){
  const messages = [];
  if(failures.length){
    messages.push(`Some records could not be loaded (${failures.join(", ")}). Available sections are shown without those records.`);
  }
  if(notices.length){
    messages.push(`${notices.join("; ")}. Valid records are still included.`);
  }
  return messages.join(" ");
}
