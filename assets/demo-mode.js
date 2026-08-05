export const DEMO_RESET_PLACEHOLDER_MESSAGE =
  "Demo reset will be added in a later phase.";

let currentUser = null;
let currentAccountData = null;

export function isDemoMode(
  user = currentUser,
  accountData = currentAccountData
){
  try{
    return Boolean(user && accountData && accountData.demoMode === true);
  }catch(_error){
    return false;
  }
}

export function shouldShowDemoBanner(user, accountData){
  return isDemoMode(user, accountData);
}

function updateDemoModeContext(user, accountData){
  currentUser = user || null;
  currentAccountData = accountData || null;
}

function notifySafely(listener, value, user = null, accountData = null){
  try{
    listener(Boolean(value), user, accountData);
  }catch(_error){
    // A page-level rendering error must not affect authentication or account loading.
  }
}

async function defaultFirebaseServices(){
  const [{ auth, db }, authSdk, firestoreSdk] = await Promise.all([
    import("/firebase-config.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
  ]);

  return {
    auth,
    db,
    onAuthStateChanged: authSdk.onAuthStateChanged,
    doc: firestoreSdk.doc,
    getDoc: firestoreSdk.getDoc
  };
}

export async function watchDemoMode(listener, services){
  if(typeof listener !== "function"){
    return () => {};
  }

  let requestVersion = 0;

  try{
    const firebase = services || await defaultFirebaseServices();
    const unsubscribe = firebase.onAuthStateChanged(
      firebase.auth,
      async user => {
        const activeRequest = ++requestVersion;
        updateDemoModeContext(user, null);
        notifySafely(listener, false);

        if(!user){
          return;
        }

        try{
          const snapshot = await firebase.getDoc(
            firebase.doc(firebase.db, "users", user.uid)
          );

          if(activeRequest !== requestVersion){
            return;
          }

          const accountData = snapshot.exists() ? snapshot.data() : null;
          updateDemoModeContext(user, accountData);
          notifySafely(listener, isDemoMode(), user, accountData);
        }catch(_error){
          if(activeRequest !== requestVersion){
            return;
          }

          updateDemoModeContext(user, null);
          notifySafely(listener, false);
        }
      },
      () => {
        requestVersion += 1;
        updateDemoModeContext(null, null);
        notifySafely(listener, false);
      }
    );

    return () => {
      requestVersion += 1;
      updateDemoModeContext(null, null);
      unsubscribe();
    };
  }catch(_error){
    updateDemoModeContext(null, null);
    notifySafely(listener, false);
    return () => {};
  }
}

export function showDemoResetPlaceholder(notify){
  const showMessage = typeof notify === "function"
    ? notify
    : message => {
        if(typeof window !== "undefined" && typeof window.alert === "function"){
          window.alert(message);
        }
      };

  showMessage(DEMO_RESET_PLACEHOLDER_MESSAGE);
  return DEMO_RESET_PLACEHOLDER_MESSAGE;
}

export function handleDemoResetClick(event, notify){
  event?.preventDefault?.();
  return showDemoResetPlaceholder(notify);
}
