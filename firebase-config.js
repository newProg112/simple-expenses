import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getFunctions
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyCnQPQiBGOK3FCyU_Xl3j3d9qmjWWGxuo4",
  authDomain: "simple-books-office.firebaseapp.com",
  projectId: "simple-books-office",
  storageBucket: "simple-books-office.firebasestorage.app",
  messagingSenderId: "612547283593",
  appId: "1:612547283593:web:eb4e326540978e8f671458"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");

console.log("Firebase SDK loaded");

export { app, auth, db, functions };
