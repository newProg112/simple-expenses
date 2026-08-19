import { classifyBankMatchCandidates } from "./bank-auto-match-candidates.js";

const AUTO_MATCH_ELIGIBLE = "autoMatchEligible";
const AUTOMATIC_RECORD_COLLECTIONS = Object.freeze({ invoice:"invoices",bill:"bills" });

function snapshotExists(snapshot){
  return typeof snapshot?.exists === "function" ? snapshot.exists() : Boolean(snapshot?.exists);
}

function snapshotRecords(snapshot){
  return Array.isArray(snapshot?.docs)
    ? snapshot.docs.map(document => ({ ...document.data(),id:String(document.id || "") }))
    : [];
}

function replaceRecord(records,record){
  const id = String(record?.id || "");
  const filtered = records.filter(item => String(item?.id || "") !== id);
  return [...filtered,record];
}

function skipped(proposal,reason){
  return Object.freeze({ eligible:false,proposal,reason:String(reason || "details-changed") });
}

export function automaticMatchProposals(candidateResults = [],transactions = []){
  const transactionById = new Map((Array.isArray(transactions) ? transactions : [])
    .map(transaction => [String(transaction?.id || ""),transaction]));
  return Object.freeze((Array.isArray(candidateResults) ? candidateResults : [])
    .filter(result => result?.classification === AUTO_MATCH_ELIGIBLE &&
      ["invoice","bill"].includes(result?.candidateType) && result?.candidateId)
    .map(result => {
      const candidate = result.candidates?.find(item => item.candidateId === result.candidateId);
      const transaction = transactionById.get(String(result.transactionId || ""));
      if(!candidate || !transaction) return null;
      return Object.freeze({
        transactionId:String(result.transactionId),
        candidateType:result.candidateType,
        candidateId:String(result.candidateId),
        transactionDescription:String(transaction.description || "").trim(),
        transactionDate:String(transaction.transactionDate || "").trim(),
        amountCents:Number(candidate.amountCents),
        candidateLabel:String(candidate.label || "").trim(),
        documentReference:String(candidate.documentReference || "").trim()
      });
    })
    .filter(Boolean));
}

export async function revalidateAutomaticBankMatch(options = {}){
  const { db,services = {},proposal = {} } = options;
  const userId = String(options.userId || "").trim();
  const transactionId = String(proposal.transactionId || "").trim();
  const candidateType = String(proposal.candidateType || "").trim();
  const candidateId = String(proposal.candidateId || "").trim();
  const sourceCollection = AUTOMATIC_RECORD_COLLECTIONS[candidateType];
  if(!userId || !transactionId || !candidateId || !sourceCollection){
    return skipped(proposal,"automatic-match-proposal-invalid");
  }
  for(const helper of ["collection","doc","getDoc","getDocs"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }

  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);
  const sourceRef = services.doc(db,"users",userId,sourceCollection,candidateId);
  const transactionCollection = services.collection(db,"users",userId,"bankTransactions");
  const sourceCollectionRef = services.collection(db,"users",userId,sourceCollection);
  const [transactionSnapshot,sourceSnapshot,transactionCollectionSnapshot,sourceCollectionSnapshot] = await Promise.all([
    services.getDoc(transactionRef),services.getDoc(sourceRef),
    services.getDocs(transactionCollection),services.getDocs(sourceCollectionRef)
  ]);
  if(!snapshotExists(transactionSnapshot)) return skipped(proposal,"bank-transaction-missing");
  if(!snapshotExists(sourceSnapshot)) return skipped(proposal,"source-record-missing");

  const transaction = { ...transactionSnapshot.data(),id:transactionId };
  const source = { ...sourceSnapshot.data(),id:candidateId };
  const allTransactions = replaceRecord(snapshotRecords(transactionCollectionSnapshot),transaction);
  const sourceRecords = replaceRecord(snapshotRecords(sourceCollectionSnapshot),source);
  const sources = candidateType === "invoice" ? { invoices:sourceRecords } : { bills:sourceRecords };
  const result = classifyBankMatchCandidates(transaction,sources,{ transactions:allTransactions });
  if(result.classification !== AUTO_MATCH_ELIGIBLE || result.candidateType !== candidateType ||
    String(result.candidateId || "") !== candidateId){
    return skipped(proposal,"details-changed-review-required");
  }
  return Object.freeze({
    eligible:true,
    proposal:Object.freeze({ ...proposal }),
    transaction:Object.freeze(transaction),
    source:Object.freeze(source),
    evidence:result.evidence
  });
}

export async function executeAutomaticBankMatches(options = {}){
  const proposals = Array.isArray(options.proposals) ? options.proposals : [];
  if(typeof options.revalidate !== "function") throw new Error("Automatic match revalidation is required.");
  if(typeof options.confirm !== "function") throw new Error("Trusted match confirmation is required.");
  const completed = [];
  const skippedItems = [];

  for(const proposal of proposals){
    try{
      const current = await options.revalidate(proposal);
      if(!current?.eligible){
        skippedItems.push(Object.freeze({ proposal,reason:current?.reason || "details-changed-review-required" }));
        continue;
      }
      const result = await options.confirm(current);
      if(result?.status === "confirmed") completed.push(Object.freeze({ proposal,result }));
      else skippedItems.push(Object.freeze({ proposal,reason:"already-settled-or-changed" }));
    }catch(error){
      skippedItems.push(Object.freeze({
        proposal,reason:String(error?.message || "details-changed-review-required")
      }));
    }
  }
  return Object.freeze({
    processedCount:proposals.length,
    completedCount:completed.length,
    skippedCount:skippedItems.length,
    completed:Object.freeze(completed),
    skipped:Object.freeze(skippedItems)
  });
}

export function createSingleFlightAutomaticMatches(execute){
  if(typeof execute !== "function") throw new Error("Automatic match execution is required.");
  let active = null;
  return (...args) => {
    if(active) return active;
    active = Promise.resolve().then(() => execute(...args)).finally(() => { active = null; });
    return active;
  };
}
