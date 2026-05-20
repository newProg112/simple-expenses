import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyCnQPQiBGOK3FCyU_Xl3j3d9qmjWWGxuo4",
  authDomain: "simple-books-office.firebaseapp.com",
  projectId: "simple-books-office",
  storageBucket: "simple-books-office.firebasestorage.app",
  messagingSenderId: "612547283593",
  appId: "1:612547283593:web:eb4e326540978e8f671458"
};

const app = initializeApp(firebaseConfig);

console.log("Firebase SDK loaded");

export { app };