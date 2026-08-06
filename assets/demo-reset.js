export const DEMO_RESET_CONFIRMATION =
  "Reset all shared demo transactions to the canonical example data?";

export function demoResetFailureMessage(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  const stage = error?.details?.stage;

  if(code === "unauthenticated"){
    return "Your demo session has ended. Sign in again before resetting.";
  }
  if(code === "failed-precondition" || code === "permission-denied"){
    return "Reset Demo is available only for the shared demo account.";
  }
  if(stage === "clearing" || stage === "seeding"){
    return "Demo data could not be fully restored. Please try again.";
  }
  return "Demo data could not be reset. Please try again.";
}

export function createDemoResetController({
  isDemo,
  confirmAction,
  execute,
  onState = () => {},
  reload = () => {}
}){
  let activeRequest = null;

  function run(){
    if(activeRequest){
      return activeRequest;
    }
    if(typeof isDemo !== "function" || !isDemo()){
      const result = { status: "denied" };
      onState({
        state: "error",
        message: "Reset Demo is available only for the shared demo account."
      });
      return Promise.resolve(result);
    }
    if(typeof confirmAction !== "function" || !confirmAction(DEMO_RESET_CONFIRMATION)){
      onState({ state: "cancelled", message: "Demo reset cancelled." });
      return Promise.resolve({ status: "cancelled" });
    }

    activeRequest = (async () => {
      onState({ state: "running", message: "Resetting shared demo data…" });
      try{
        const result = await execute();
        onState({
          state: "success",
          message: "Demo data reset successfully. Reloading…",
          result
        });
        reload();
        return { status: "success", result };
      }catch(error){
        const message = demoResetFailureMessage(error);
        onState({ state: "error", message, error });
        return { status: "error", message, error };
      }finally{
        activeRequest = null;
      }
    })();

    return activeRequest;
  }

  return Object.freeze({
    run,
    isRunning: () => Boolean(activeRequest)
  });
}

export async function callCurrentDemoReset(){
  const [{ functions }, { httpsCallable }] = await Promise.all([
    import("/firebase-config.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js")
  ]);
  const resetDemoEnvironment = httpsCallable(
    functions,
    "resetDemoEnvironment",
    { timeout: 300000 }
  );
  const response = await resetDemoEnvironment({});
  return response.data;
}
