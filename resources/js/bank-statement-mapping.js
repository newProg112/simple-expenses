export const MAPPING_FIELDS = Object.freeze(["transactionDate","description","moneyIn","moneyOut","balance"]);
export const MAPPED_PREVIEW_LIMIT = 20;

const HEADER_SYNONYMS = Object.freeze({
  transactionDate:Object.freeze(["date","transaction date","booking date","posting date"]),
  description:Object.freeze(["description","details","narrative","transaction","reference","merchant"]),
  moneyIn:Object.freeze(["money in","paid in","credit","credits","deposit","deposits"]),
  moneyOut:Object.freeze(["money out","paid out","debit","debits","withdrawal","withdrawals"]),
  balance:Object.freeze(["balance","running balance","account balance"])
});

function cleanHeader(value){
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g," ");
}

function validColumnIndex(value, columnCount){
  if(value === "" || value === null || value === undefined) return null;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < columnCount ? index : null;
}

export function statementMappingData(parsedCsv = {}){
  const records = Array.isArray(parsedCsv.records) ? parsedCsv.records : [];
  return Object.freeze({
    headers:Object.freeze((records[0] || []).map(value => String(value ?? "").trim())),
    rows:Object.freeze(records.slice(1).map(row => Object.freeze(row.slice())))
  });
}

export function suggestColumnMappings(headers = []){
  const cleaned = headers.map(cleanHeader);
  const suggestions = {};
  MAPPING_FIELDS.forEach(field => {
    const matches = cleaned.flatMap((header,index) => HEADER_SYNONYMS[field].includes(header) ? [index] : []);
    suggestions[field] = matches.length === 1 ? matches[0] : null;
  });
  return Object.freeze(suggestions);
}

export function validateColumnMappings(mapping = {}, columnCount = 0){
  const value = Object.fromEntries(MAPPING_FIELDS.map(field => [field,validColumnIndex(mapping[field],columnCount)]));
  const errors = {};
  if(value.transactionDate === null) errors.transactionDate = "Select the transaction date column.";
  if(value.description === null) errors.description = "Select the description column.";
  if(value.moneyIn === null && value.moneyOut === null) errors.amount = "Select at least one Money in or Money out column.";

  const used = new Map();
  MAPPING_FIELDS.forEach(field => {
    const index = value[field];
    if(index === null) return;
    if(used.has(index)){
      errors[field] = "Each banking field must use a different CSV column.";
      errors[used.get(index)] = "Each banking field must use a different CSV column.";
    }else{
      used.set(index,field);
    }
  });
  return Object.freeze({ valid:Object.keys(errors).length === 0, errors:Object.freeze(errors), value:Object.freeze(value) });
}

export function parseMoneyValue(source){
  const raw = String(source ?? "").trim();
  if(raw === "") return Object.freeze({ value:null, error:null });
  const compact = raw;
  if(!/^-?£?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(compact)){
    return Object.freeze({ value:null, error:"Invalid monetary value" });
  }
  const value = Number(compact.replace("£","").replace(/,/g,""));
  if(!Number.isFinite(value)) return Object.freeze({ value:null, error:"Invalid monetary value" });
  return Object.freeze({ value, error:null });
}

export function normaliseStatementRows(rows = [], mapping = {}, limit = MAPPED_PREVIEW_LIMIT){
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeLimit = Math.max(0,Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : MAPPED_PREVIEW_LIMIT);
  const normalised = safeRows.map(row => {
    const transactionDate = String(row?.[mapping.transactionDate] ?? "").trim();
    const description = String(row?.[mapping.description] ?? "").trim();
    const moneyIn = mapping.moneyIn === null ? { value:null,error:null } : parseMoneyValue(row?.[mapping.moneyIn]);
    const moneyOut = mapping.moneyOut === null ? { value:null,error:null } : parseMoneyValue(row?.[mapping.moneyOut]);
    const balance = mapping.balance === null ? { value:null,error:null } : parseMoneyValue(row?.[mapping.balance]);
    const errors = [];
    if(!transactionDate) errors.push("Missing date");
    if(!description) errors.push("Missing description");
    if(moneyIn.error) errors.push("Invalid money in");
    if(moneyOut.error) errors.push("Invalid money out");
    if(balance.error) errors.push("Invalid balance");
    if(!moneyIn.error && !moneyOut.error && moneyIn.value === null && moneyOut.value === null) errors.push("Missing amount");
    return Object.freeze({
      transactionDate,
      description,
      moneyIn:moneyIn.value,
      moneyOut:moneyOut.value,
      balance:balance.value,
      status:errors.length ? "Needs attention" : "Ready",
      errors:Object.freeze(errors)
    });
  });
  const readyCount = normalised.filter(row => row.status === "Ready").length;
  return Object.freeze({
    transactionCount:normalised.length,
    readyCount,
    attentionCount:normalised.length - readyCount,
    rows:Object.freeze(normalised.slice(0,safeLimit)),
    allRows:Object.freeze(normalised)
  });
}
