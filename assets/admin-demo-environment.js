export const DEMO_COUNT_ORDER = Object.freeze([
  "businessProfile",
  "customers",
  "projects",
  "invoices",
  "bills",
  "expenses",
  "mileage",
  "budgets",
  "journals"
]);

export const DEMO_COUNT_LABELS = Object.freeze({
  businessProfile: "Business profile",
  customers: "Customers",
  projects: "Projects",
  invoices: "Invoices",
  bills: "Bills",
  expenses: "Expenses",
  mileage: "Mileage claims",
  budgets: "Budgets",
  journals: "Derived journals"
});

export function validateDemoTargetUid(value){
  const targetUid = typeof value === "string" ? value.trim() : "";
  const valid = Boolean(targetUid) &&
    targetUid.length <= 128 &&
    !targetUid.includes("/") &&
    !/\s/.test(targetUid);

  return {
    valid,
    targetUid: valid ? targetUid : "",
    message: valid ? "" : "Enter the Firebase UID for the official demo account."
  };
}

export function demoSeedFailureState(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  const stage = ["validation", "clearing", "seeding"].includes(error?.details?.stage)
    ? error.details.stage
    : "validation";

  if(code === "unauthenticated"){
    return { kind: "unauthenticated", stage, message: "Your admin session has ended. Sign in again before retrying." };
  }
  if(code === "permission-denied"){
    return { kind: "permission-denied", stage, message: "This account is not authorised to manage the demo environment." };
  }
  if(code === "not-found"){
    return { kind: "error", stage: "validation", message: "No users document exists for that UID." };
  }
  if(code === "failed-precondition"){
    return {
      kind: "error",
      stage,
      message: error?.message || "The target must have demoMode set to Boolean true before it can be seeded."
    };
  }
  if(stage === "clearing"){
    return {
      kind: "error",
      stage,
      message: "Clearing failed. Some managed demo records may already have been removed; inspect the account before retrying."
    };
  }
  if(stage === "seeding"){
    return {
      kind: "error",
      stage,
      message: "Clearing completed, but seeding failed. The demo account may be empty or partially populated."
    };
  }
  return { kind: "error", stage, message: "The demo environment operation failed before completion." };
}

export function demoSeedConfirmationMessage(targetUid){
  return `Replace all managed business data for demo account ${targetUid}? This cannot be undone from the Admin Dashboard.`;
}

export function createDemoEnvironmentController({
  isAdmin,
  confirmAction,
  execute,
  onState = () => {}
}){
  let activeRequest = null;

  function run(rawTargetUid){
    if(activeRequest){
      return activeRequest;
    }

    if(typeof isAdmin !== "function" || !isAdmin()){
      const result = { status: "denied" };
      onState({
        state: "error",
        stage: "validation",
        message: "This control is available only to an authorised admin."
      });
      return Promise.resolve(result);
    }

    const validation = validateDemoTargetUid(rawTargetUid);
    if(!validation.valid){
      onState({ state: "error", stage: "validation", message: validation.message });
      return Promise.resolve({ status: "rejected", stage: "validation" });
    }

    const confirmed = typeof confirmAction === "function" && confirmAction(
      demoSeedConfirmationMessage(validation.targetUid)
    );
    if(!confirmed){
      onState({ state: "cancelled", message: "Cancelled. No demo data was changed." });
      return Promise.resolve({ status: "cancelled" });
    }

    activeRequest = (async () => {
      onState({
        state: "running",
        stage: "clearing",
        targetUid: validation.targetUid,
        message: "Clearing managed demo data, then applying the canonical seed…"
      });

      try{
        const result = await execute({ targetUid: validation.targetUid });
        onState({
          state: "success",
          targetUid: validation.targetUid,
          message: "Demo environment seeded successfully.",
          result
        });
        return { status: "success", result };
      }catch(error){
        const failure = demoSeedFailureState(error);
        onState({ state: "error", ...failure, error });
        return { status: "error", error, stage: failure.stage };
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
