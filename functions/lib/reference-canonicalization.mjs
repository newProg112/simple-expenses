function unicodeText(value){
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

export function normaliseDocumentReference(value){
  return (unicodeText(value).match(/[\p{L}\p{N}]+/gu) || []).join("");
}

export function isSafeDocumentReference(value){
  const reference = normaliseDocumentReference(value);
  return [...reference].length >= 6 && /\p{L}/u.test(reference) && /\p{N}/u.test(reference);
}

