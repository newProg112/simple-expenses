import { functions } from "/firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const callLogActivityEvent = httpsCallable(functions, "logActivityEvent");

export function createActivityIdempotencyKey(){
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll("-", "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(12, "0");
}

export async function logActivityEvent(eventType, idempotencyKey){
  try{
    const data = { eventType };
    if(idempotencyKey) data.idempotencyKey = idempotencyKey;
    await callLogActivityEvent(data);
    return true;
  }catch(_error){
    return false;
  }
}
