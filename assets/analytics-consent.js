export const ANALYTICS_CONSENT_STORAGE_KEY = "simple-books:analytics-consent:v1";
export const ANALYTICS_CONSENT_CHANGE_EVENT = "simple-books:analytics-consent-change";
export const ANALYTICS_CONSENT_ACCEPTED = "accepted";
export const ANALYTICS_CONSENT_ESSENTIAL = "essential";

const VALID_CHOICES = new Set([
  ANALYTICS_CONSENT_ACCEPTED,
  ANALYTICS_CONSENT_ESSENTIAL
]);

function browserStorage(runtime){
  try{
    return runtime?.localStorage || null;
  }catch(_error){
    return null;
  }
}

export function readAnalyticsConsent(storage){
  try{
    const choice = storage?.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    return VALID_CHOICES.has(choice) ? choice : null;
  }catch(_error){
    return null;
  }
}

export function analyticsConsentGranted(runtime = globalThis){
  return readAnalyticsConsent(browserStorage(runtime)) === ANALYTICS_CONSENT_ACCEPTED;
}

export function applyAnalyticsMeasurementPreference(runtime, measurementId, choice){
  if(!runtime || !measurementId) return;
  runtime[`ga-disable-${measurementId}`] = choice !== ANALYTICS_CONSENT_ACCEPTED;
}

export function prepareFirebaseAnalyticsConsent(runtime, measurementId){
  const choice = readAnalyticsConsent(browserStorage(runtime));
  applyAnalyticsMeasurementPreference(runtime, measurementId, choice);
  return choice;
}

export function saveAnalyticsConsent(runtime, choice){
  if(!VALID_CHOICES.has(choice)) return false;

  try{
    browserStorage(runtime)?.setItem(ANALYTICS_CONSENT_STORAGE_KEY, choice);
  }catch(_error){
    // The choice still applies to this page when storage is unavailable.
  }

  const ConsentEvent = runtime?.CustomEvent || globalThis.CustomEvent;
  if(typeof ConsentEvent === "function"){
    runtime?.dispatchEvent?.(new ConsentEvent(ANALYTICS_CONSENT_CHANGE_EVENT, {
      detail: { choice }
    }));
  }
  return true;
}

export function onAnalyticsConsentChange(runtime, listener){
  if(!runtime?.addEventListener || typeof listener !== "function") return () => {};
  const handler = event => listener(event?.detail?.choice || null);
  runtime.addEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, handler);
  return () => runtime.removeEventListener?.(ANALYTICS_CONSENT_CHANGE_EVENT, handler);
}

function addConsentStylesheet(document){
  if(document.getElementById("simple-books-analytics-consent-styles")) return;
  const stylesheet = document.createElement("link");
  stylesheet.id = "simple-books-analytics-consent-styles";
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/assets/analytics-consent.css?v=20260911-consent1";
  document.head.append(stylesheet);
}

function initialiseConsentControl(runtime, document){
  if(document.getElementById("simpleBooksAnalyticsConsent")) return;
  addConsentStylesheet(document);

  const panel = document.createElement("section");
  panel.id = "simpleBooksAnalyticsConsent";
  panel.className = "sb-consent-panel";
  panel.setAttribute("aria-labelledby", "simpleBooksAnalyticsConsentTitle");
  panel.innerHTML = `
    <div class="sb-consent-copy">
      <h2 id="simpleBooksAnalyticsConsentTitle" tabindex="-1">Analytics choices</h2>
      <p>Simple Books uses essential services to keep the site and your account working. With your permission, Firebase Analytics helps us understand limited product usage.</p>
      <a href="/privacy.html#storage">Read the Privacy Policy</a>
    </div>
    <div class="sb-consent-actions">
      <button type="button" data-consent-choice="accepted">Accept analytics</button>
      <button type="button" data-consent-choice="essential">Essential only</button>
    </div>`;

  const choicesButton = document.createElement("button");
  choicesButton.type = "button";
  choicesButton.className = "sb-privacy-choices";
  choicesButton.textContent = "Privacy choices";
  choicesButton.setAttribute("aria-controls", panel.id);
  choicesButton.setAttribute("aria-expanded", "false");

  const footerLinks = document.querySelector("footer .footer-links");
  if(footerLinks){
    footerLinks.append(choicesButton);
  }else{
    choicesButton.classList.add("sb-privacy-choices-fixed");
    document.body.append(choicesButton);
  }
  document.body.append(panel);

  let focusBeforeOpen = null;
  const title = panel.querySelector("h2");

  function openPanel({ focus = true } = {}){
    focusBeforeOpen = document.activeElement;
    panel.hidden = false;
    choicesButton.setAttribute("aria-expanded", "true");
    if(focus) title?.focus();
  }

  function closePanel(){
    panel.hidden = true;
    choicesButton.setAttribute("aria-expanded", "false");
    if(focusBeforeOpen && typeof focusBeforeOpen.focus === "function"){
      focusBeforeOpen.focus();
    }
  }

  choicesButton.addEventListener("click", () => {
    if(panel.hidden) openPanel();
    else closePanel();
  });

  panel.addEventListener("click", event => {
    const choice = event.target.closest?.("[data-consent-choice]")?.dataset?.consentChoice;
    if(!choice) return;
    saveAnalyticsConsent(runtime, choice);
    closePanel();
  });

  panel.addEventListener("keydown", event => {
    if(event.key === "Escape" && readAnalyticsConsent(browserStorage(runtime))){
      event.preventDefault();
      closePanel();
    }
  });

  panel.hidden = true;
  if(!readAnalyticsConsent(browserStorage(runtime))){
    openPanel({ focus: false });
  }
}

export function initialiseAnalyticsConsentControl(
  runtime = typeof window === "undefined" ? null : window,
  document = runtime?.document
){
  if(!runtime || !document) return;
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", () => initialiseConsentControl(runtime, document), {
      once: true
    });
  }else{
    initialiseConsentControl(runtime, document);
  }
}

initialiseAnalyticsConsentControl();
