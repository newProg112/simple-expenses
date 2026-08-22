export const ACCOUNT_DELETION_POLL_INTERVAL_MS = 3000;

export const ACCOUNT_DELETION_PHASE_MESSAGES = Object.freeze({
  starting: "Starting secure account deletion...",
  cancelling_subscription: "Cancelling your Simple Books subscription...",
  removing_files: "Removing uploaded files...",
  removing_account_data: "Removing your Simple Books account data...",
  finalising: "Finalising account deletion..."
});

const SIMPLE_BOOKS_ACCOUNT_CACHE_KEYS = Object.freeze([
  "simpleBooksAccount",
  "simpleBooksAccountUid",
  "simpleBooksInvoices",
  "simpleBooksBills",
  "simpleBooksClients",
  "simpleBooksExpenses",
  "simpleBooksCustomers",
  "simpleBooksLastInvoiceNumber",
  "simpleBooksBackupDownloaded",
  "simpleBooksLastBackupDownloadedAt",
  "simpleBooksLastAccountantPackGeneratedAt"
]);

function errorCode(error){
  return String(error?.code || "").replace(/^functions\//, "functions/");
}

export function supportsPasswordReauthentication(user){
  return Boolean(
    user?.email &&
    Array.isArray(user.providerData) &&
    user.providerData.some(provider => provider?.providerId === "password")
  );
}

export function normaliseAccountDeletionStatus(value){
  const data = value?.data || value || {};
  if(["not_requested", "processing", "needs_attention", "completed"].includes(data.status)){
    return {
      status: data.status,
      phase: typeof data.phase === "string" ? data.phase : ""
    };
  }
  if(data.accepted === true && data.status === "active"){
    return { status: "processing", phase: "starting" };
  }
  if(data.accepted === true && data.status === "needs_attention"){
    return { status: "needs_attention", phase: "" };
  }
  if(data.accepted === true && data.status === "completed"){
    return { status: "completed", phase: "" };
  }
  return { status: "unknown", phase: "" };
}

export function accountDeletionErrorMessage(error, context = "request"){
  const code = errorCode(error);
  const reason = String(error?.details?.reason || "");
  if(code === "auth/wrong-password" || code === "auth/invalid-credential"){
    return "That password was not accepted. Check it and try again.";
  }
  if(code === "auth/too-many-requests"){
    return "Too many sign-in attempts. Wait a little before trying again.";
  }
  if(code === "auth/user-mismatch" || code === "auth/user-not-found"){
    return "Your signed-in account could not be reauthenticated. Sign in again and retry.";
  }
  if(code === "functions/permission-denied" || reason === "protected-account"){
    return "This protected account cannot be deleted from the Account page.";
  }
  if(code === "functions/failed-precondition" &&
    reason === "recent-authentication-required"){
    return "Your sign-in could not be refreshed. Enter your password again and retry.";
  }
  if(code === "functions/unauthenticated"){
    return "Your session has ended. Sign in again to continue.";
  }
  if(code === "functions/unavailable" || code === "functions/internal" ||
    code === "unavailable" || code === "internal"){
    return context === "status"
      ? "Deletion is still processing. We will keep checking automatically."
      : "Your request may have been saved, but processing could not be confirmed. Retry safely.";
  }
  return context === "reauthentication"
    ? "We could not verify your password. Please try again."
    : "We could not start account deletion. Please try again.";
}

export function clearSimpleBooksAccountCaches(local, session, uid){
  for(const key of SIMPLE_BOOKS_ACCOUNT_CACHE_KEYS){
    try{ local?.removeItem(key); }catch(_error){ /* Browser storage unavailable. */ }
  }
  if(uid){
    try{ local?.removeItem(`simpleBooksAccount:${uid}`); }catch(_error){ /* Browser storage unavailable. */ }
  }
  try{
    for(let index = (session?.length || 0) - 1; index >= 0; index -= 1){
      const key = session.key(index);
      if(key?.startsWith(`simple-books:demo-analytics:page-view:v1:${uid}:`)){
        session.removeItem(key);
      }
    }
  }catch(_error){
    // Session storage can be unavailable in privacy-focused browsers.
  }
}

function focusableElements(container){
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(element => !element.hidden && element.getClientRects().length > 0);
}

export function createAccountDeletionController({
  elements,
  services,
  runtime = globalThis,
  createRequestId
}){
  let state = "idle";
  let requestId = "";
  let pollTimer = null;
  let pollFailures = 0;
  let irreversible = false;
  let completing = false;
  let opener = null;
  let deletionUid = "";

  function setStatus(message, isError = false){
    elements.status.textContent = message;
    elements.status.classList.toggle("error", isError);
  }

  function updateSubmitState(){
    elements.submit.disabled = state !== "confirming" ||
      elements.confirmation.value !== "DELETE" ||
      elements.password.value.length === 0;
  }

  function setModalOpen(open){
    const wasHidden = elements.modal.hidden;
    elements.modal.hidden = !open;
    runtime.document?.body?.classList.toggle("account-deletion-modal-open", open);
    for(const background of elements.background || []){
      if(open) background.setAttribute("inert", "");
      else background.removeAttribute("inert");
    }
    if(open && wasHidden){
      runtime.setTimeout(() => {
        const target = state === "confirming" ? elements.confirmation : elements.processingPanel;
        target?.focus();
      }, 0);
    }
  }

  function showConfirmation(){
    state = "confirming";
    irreversible = false;
    elements.confirmationPanel.hidden = false;
    elements.processingPanel.hidden = true;
    elements.close.hidden = false;
    elements.close.disabled = false;
    elements.confirmation.value = "";
    elements.password.value = "";
    setStatus("");
    updateSubmitState();
  }

  function open(){
    if(state !== "idle") return;
    opener = runtime.document?.activeElement || elements.open;
    requestId = createRequestId();
    showConfirmation();
    setModalOpen(true);
  }

  function close(){
    if(irreversible || state === "submitting") return;
    setModalOpen(false);
    showConfirmation();
    state = "idle";
    requestId = "";
    opener?.focus?.();
  }

  function stopPolling(){
    if(pollTimer !== null){
      runtime.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function deletionMessage(phase){
    return ACCOUNT_DELETION_PHASE_MESSAGES[phase] ||
      "Deleting your Simple Books account...";
  }

  function showProcessing(phase = "starting"){
    deletionUid = deletionUid || services.getCurrentUser()?.uid || "";
    irreversible = true;
    state = "processing";
    elements.confirmationPanel.hidden = true;
    elements.processingPanel.hidden = false;
    elements.close.hidden = true;
    elements.support.hidden = true;
    elements.processingTitle.textContent = "Deleting your account...";
    setStatus(deletionMessage(phase));
    setModalOpen(true);
  }

  function showNeedsAttention(){
    deletionUid = deletionUid || services.getCurrentUser()?.uid || "";
    irreversible = true;
    state = "needs_attention";
    stopPolling();
    elements.confirmationPanel.hidden = true;
    elements.processingPanel.hidden = false;
    elements.close.hidden = true;
    elements.support.hidden = false;
    elements.processingTitle.textContent = "We need to finish this securely";
    setStatus(
      "We couldn't finish deleting your account automatically. Your account remains locked while we resolve this.",
      true
    );
    setModalOpen(true);
  }

  async function complete(){
    if(completing) return;
    completing = true;
    state = "completed";
    stopPolling();
    const uid = deletionUid || services.getCurrentUser()?.uid || "";
    clearSimpleBooksAccountCaches(runtime.localStorage, runtime.sessionStorage, uid);
    try{ await services.signOut(); }catch(_error){ /* Auth may already be deleted. */ }
    runtime.location.assign("/?account=deleted");
  }

  async function applyStatus(status){
    if(status.status === "completed"){
      await complete();
      return true;
    }
    if(status.status === "needs_attention"){
      showNeedsAttention();
      return true;
    }
    if(status.status === "processing"){
      showProcessing(status.phase);
      return true;
    }
    return false;
  }

  function schedulePoll(delay = ACCOUNT_DELETION_POLL_INTERVAL_MS){
    stopPolling();
    if(state !== "processing") return;
    pollTimer = runtime.setTimeout(poll, delay);
  }

  async function poll(){
    pollTimer = null;
    if(state !== "processing") return;
    try{
      const status = normaliseAccountDeletionStatus(await services.getStatus());
      pollFailures = 0;
      if(await applyStatus(status)){
        if(status.status === "processing") schedulePoll();
        return;
      }
      setStatus("Your deletion request is being confirmed. We will keep checking.");
    }catch(error){
      if(!services.getCurrentUser()){
        await complete();
        return;
      }
      if(await services.authUserIsMissing?.()){
        await complete();
        return;
      }
      pollFailures += 1;
      if(pollFailures >= 3){
        setStatus(accountDeletionErrorMessage(error, "status"));
      }
    }
    schedulePoll(pollFailures ? 5000 : ACCOUNT_DELETION_POLL_INTERVAL_MS);
  }

  async function recoverRequestStatus(error){
    try{
      const status = normaliseAccountDeletionStatus(await services.getStatus());
      if(await applyStatus(status)){
        if(status.status === "processing") schedulePoll();
        return true;
      }
    }catch(_statusError){
      // The original safe request ID remains available for a deliberate retry.
    }
    state = "confirming";
    setStatus(accountDeletionErrorMessage(error, "request"), true);
    updateSubmitState();
    return false;
  }

  async function submit(event){
    event?.preventDefault?.();
    if(state !== "confirming" || elements.submit.disabled) return;
    const user = services.getCurrentUser();
    if(!user){
      setStatus("Your session has ended. Sign in again to continue.", true);
      return;
    }
    if(!supportsPasswordReauthentication(user)){
      setStatus("This account does not use email and password sign-in. Contact Simple Books support for help.", true);
      return;
    }
    deletionUid = user.uid;

    state = "submitting";
    elements.submit.disabled = true;
    elements.close.disabled = true;
    setStatus("Verifying your password...");
    const password = elements.password.value;
    try{
      await services.reauthenticate(user.email, password);
    }catch(error){
      state = "confirming";
      elements.close.disabled = false;
      setStatus(accountDeletionErrorMessage(error, "reauthentication"), true);
      updateSubmitState();
      return;
    }finally{
      elements.password.value = "";
    }

    setStatus("Starting secure account deletion...");
    try{
      const result = normaliseAccountDeletionStatus(await services.requestDeletion({
        confirmation: "DELETE",
        requestId
      }));
      if(await applyStatus(result)){
        if(result.status === "processing") schedulePoll();
        return;
      }
      state = "confirming";
      elements.close.disabled = false;
      setStatus("Deletion could not be confirmed. Retry safely.", true);
      updateSubmitState();
    }catch(error){
      elements.close.disabled = false;
      await recoverRequestStatus(error);
    }
  }

  async function resumeIfNeeded(){
    if(!services.getCurrentUser()) return false;
    try{
      const status = normaliseAccountDeletionStatus(await services.getStatus());
      const resumed = await applyStatus(status);
      if(resumed && status.status === "processing") schedulePoll();
      return resumed;
    }catch(_error){
      return false;
    }
  }

  function handleAuthState(user){
    if(irreversible && !user) void complete();
  }

  function renderAvailability({signedIn, demo, loading = false}){
    elements.section.hidden = !signedIn || demo || loading;
    elements.open.disabled = !signedIn || demo || loading;
  }

  function handleKeydown(event){
    if(elements.modal.hidden) return;
    if(event.key === "Escape"){
      if(!irreversible && state !== "submitting"){
        event.preventDefault();
        close();
      }
      return;
    }
    if(event.key !== "Tab") return;
    const focusable = focusableElements(elements.modal);
    if(!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if(event.shiftKey && runtime.document.activeElement === first){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey && runtime.document.activeElement === last){
      event.preventDefault();
      first.focus();
    }
  }

  elements.open.addEventListener("click", open);
  elements.close.addEventListener("click", close);
  elements.form.addEventListener("submit", submit);
  elements.confirmation.addEventListener("input", updateSubmitState);
  elements.password.addEventListener("input", updateSubmitState);
  elements.modal.addEventListener("click", event => {
    if(event.target === elements.modal) close();
  });
  runtime.document.addEventListener("keydown", handleKeydown);
  runtime.addEventListener?.("pagehide", stopPolling);

  return Object.freeze({
    close,
    destroy: () => {
      stopPolling();
      runtime.document.removeEventListener("keydown", handleKeydown);
    },
    handleAuthState,
    open,
    renderAvailability,
    resumeIfNeeded,
    submit
  });
}
