import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  connectAuthEmulator,
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  connectFirestoreEmulator,
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  connectFunctionsEmulator,
  getFunctions
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import {
  connectStorageEmulator,
  getStorage
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import {
  getAnalytics
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

import { isLocalFirebaseHost } from "./resources/js/firebase-runtime.js";

const firebaseConfig = {
  apiKey: "AIzaSyCnQPQiBGOK3FCyU_Xl3j3d9qmjWWGxuo4",
  authDomain: "simple-books-office.firebaseapp.com",
  projectId: "simple-books-office",
  storageBucket: "simple-books-office.firebasestorage.app",
  messagingSenderId: "612547283593",
  appId: "1:612547283593:web:eb4e326540978e8f671458",
  measurementId: "G-KREFVH0K70"
};

const app = initializeApp(firebaseConfig);
const analyticsHostIsLocal = typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
let analytics = null;
if(typeof window !== "undefined" && !analyticsHostIsLocal){
  try{
    analytics = getAnalytics(app);
  }catch(_error){
    analytics = null;
  }
}

const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
const storage = getStorage(app);

function shouldUseFirebaseEmulators(){
  return typeof window !== "undefined" && isLocalFirebaseHost(window);
}

if(shouldUseFirebaseEmulators()){
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  console.log("Firebase emulators enabled for this local browser session");
}

// Developer-only feature flag. Supported values: "preview" or "ai".
const businessAssistantMode = "ai";

console.log("Firebase SDK loaded");

export {
  analytics,
  app,
  auth,
  businessAssistantMode,
  db,
  functions,
  storage
};
