import { auth } from "/firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

document.documentElement.style.visibility = "hidden";

onAuthStateChanged(auth, (user) => {
  if(!user){
    window.location.replace("/login.html");
    return;
  }

  document.documentElement.style.visibility = "";
});
