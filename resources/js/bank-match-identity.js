import {
  isSafeDocumentReference,
  normaliseDocumentReference
} from "../../functions/lib/reference-canonicalization.mjs";

export { isSafeDocumentReference,normaliseDocumentReference };

function unicodeText(value){
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

function identityTokens(value){
  return unicodeText(value)
    .replace(/&/g," and ")
    .match(/[\p{L}\p{N}]+/gu) || [];
}

export function normaliseIdentityText(value){
  return identityTokens(value).join(" ");
}

function escapeRegularExpression(value){
  return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}

export function descriptionContainsDocumentReference(description,reference){
  if(!isSafeDocumentReference(reference)) return false;
  const canonical = normaliseDocumentReference(reference);
  const separatedCharacters = [...canonical]
    .map(escapeRegularExpression)
    .join("[\\s\\p{P}_]*");
  const boundedReference = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${separatedCharacters}(?=$|[^\\p{L}\\p{N}])`,
    "u"
  );
  return boundedReference.test(unicodeText(description));
}

export function normalisePartyName(value){
  const tokens = identityTokens(value);
  if(tokens.at(-1) === "ltd" || tokens.at(-1) === "limited") tokens[tokens.length - 1] = "limited";
  return tokens.join(" ");
}

export function partyNameCorrespondence(description,partyName){
  const party = normalisePartyName(partyName);
  if(!party) return Object.freeze({ match:false,strong:false });
  const descriptionName = normalisePartyName(description);
  const match = descriptionName === party;
  const coreTokens = party.split(" ").filter(token => token !== "limited" && token !== "and");
  const strong = match && (
    coreTokens.length >= 2 && coreTokens.join("").length >= 6 ||
    coreTokens.length === 1 && coreTokens[0].length >= 8
  );
  return Object.freeze({ match,strong });
}
