import { auth } from "/firebase-config.js";
import { adminAccessDecision } from "./admin-access.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const stateIds = ["checkingState", "signedOutState", "deniedState", "errorState"];
const adminContent = document.getElementById("adminContent");

function showState(stateId){
  for(const id of stateIds){
    document.getElementById(id).hidden = id !== stateId;
  }

  adminContent.hidden = true;
  window.SimpleBooksAppShell?.setVisible(false);
}

function showAdminDashboard(){
  for(const id of stateIds){
    document.getElementById(id).hidden = true;
  }

  adminContent.hidden = false;
  window.SimpleBooksAppShell?.setVisible(true);
}

onAuthStateChanged(
  auth,
  user => {
    const decision = adminAccessDecision(user);

    if(decision === "signed-out"){
      showState("signedOutState");
      window.location.replace("/login.html");
      return;
    }

    if(decision === "denied"){
      showState("deniedState");
      return;
    }

    // Phase 2 cross-user data must also be authorised server-side. A client-side
    // UID allow-list is only appropriate while this page contains no private data.
    showAdminDashboard();
  },
  error => {
    console.error("Admin authentication check failed", error);
    showState("errorState");
  }
);
