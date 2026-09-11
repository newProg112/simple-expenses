export const LOCAL_FIREBASE_HOSTS = Object.freeze([
  "localhost",
  "127.0.0.1",
  "[::1]"
]);
export const FIREBASE_EMULATOR_SESSION_KEY = "simpleBooksUseFirebaseEmulators";

export function isLocalFirebaseHost(runtime = globalThis){
  const hostname = String(runtime?.location?.hostname || "").toLowerCase();
  return LOCAL_FIREBASE_HOSTS.includes(hostname);
}

export function firebaseEmulatorsRequested(runtime = globalThis){
  if(!isLocalFirebaseHost(runtime)) return false;
  try{
    return runtime?.sessionStorage?.getItem(FIREBASE_EMULATOR_SESSION_KEY) === "true";
  }catch(_error){
    return false;
  }
}

export function firebaseFunctionUrl(functionName,runtime = globalThis){
  const name = String(functionName || "").trim();
  if(!/^[A-Za-z][A-Za-z0-9]+$/.test(name)){
    throw new Error("A valid Firebase Function name is required.");
  }

  return firebaseEmulatorsRequested(runtime)
    ? `http://127.0.0.1:5001/simple-books-office/us-central1/${name}`
    : `https://us-central1-simple-books-office.cloudfunctions.net/${name}`;
}
