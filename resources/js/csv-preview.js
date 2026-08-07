export const CSV_PREVIEW_LIMIT = 20;

function isBlankRecord(record){
  return record.every(value => value === "");
}

export function parseCsvPreview(source, limit = CSV_PREVIEW_LIMIT){
  const text = String(source ?? "").replace(/^\uFEFF/, "");
  const records = [];
  let record = [];
  let value = "";
  let quoted = false;

  for(let index = 0; index < text.length; index += 1){
    const character = text[index];
    if(character === '"'){
      if(quoted && text[index + 1] === '"'){
        value += '"';
        index += 1;
      }else if(quoted){
        quoted = false;
      }else if(value === ""){
        quoted = true;
      }else{
        value += character;
      }
      continue;
    }
    if(character === "," && !quoted){
      record.push(value);
      value = "";
      continue;
    }
    if((character === "\n" || character === "\r") && !quoted){
      if(character === "\r" && text[index + 1] === "\n") index += 1;
      record.push(value);
      records.push(record);
      record = [];
      value = "";
      continue;
    }
    value += character;
  }

  if(quoted) throw new Error("This CSV contains an unclosed quoted value.");
  record.push(value);
  records.push(record);
  while(records.length && isBlankRecord(records[records.length - 1])) records.pop();
  if(!records.length) throw new Error("This CSV does not contain any rows.");
  const safeLimit = Math.max(0, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : CSV_PREVIEW_LIMIT);
  return Object.freeze({
    rowCount:records.length,
    columnCount:records.reduce((maximum, current) => Math.max(maximum, current.length), 0),
    rows:Object.freeze(records.slice(0, safeLimit).map(current => Object.freeze(current.slice())))
  });
}

export function formatFileSize(bytes){
  const size = Math.max(0, Number(bytes) || 0);
  if(size < 1024) return `${size} B`;
  if(size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
