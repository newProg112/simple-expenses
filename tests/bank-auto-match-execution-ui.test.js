import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

const html = readFileSync(new URL("../resources/tools/banking.html",import.meta.url),"utf8");
const execution = readFileSync(new URL("../resources/js/bank-auto-match-execution.js",import.meta.url),"utf8");

function declarationBetween(start,next){
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(next,startIndex);
  if(startIndex < 0 || endIndex < 0) throw new Error(`Could not extract ${start}`);
  return html.slice(startIndex,endIndex);
}

describe("Banking controlled automatic-match execution UI",() => {
  it("shows a user-initiated action only when derived auto-match proposals exist",() => {
    expect(html).toContain('id="runAutomaticMatchesButton" type="button" hidden disabled');
    expect(html).toContain("automaticMatchProposals(results,transactions)");
    expect(html).toContain("elements.runAutomaticMatches.hidden = proposals.length === 0");
    expect(html).toContain("elements.runAutomaticMatches.disabled = isRunningAutomaticMatches || proposals.length === 0");
  });

  it("opens a zero-write preview with deterministic evidence and requires final confirmation",() => {
    const preview = declarationBetween("function openAutomaticMatchPreview(){","function closeAutomaticMatchPreview");
    const cancel = declarationBetween("function closeAutomaticMatchPreview(force = false){","function setAutomaticMatchLoading");
    expect(preview).toContain("pendingAutomaticMatches = [...automaticMatchProposals(candidateResults(),transactions)]");
    expect(preview).toContain("Exact amount; compatible date; one eligible candidate; exact unique reference");
    expect(preview).toContain("openOverlay(elements.automaticMatchOverlay");
    expect(preview).not.toMatch(/confirmBankMatch|executeAutomaticBankMatches|runTransaction|updateDoc|setDoc/);
    expect(cancel).not.toMatch(/confirmBankMatch|executeAutomaticBankMatches|runTransaction|updateDoc|setDoc/);
    expect(html).toContain('id="cancelAutomaticMatchesButton"');
    expect(html).toContain('id="confirmAutomaticMatchesButton"');
    expect(html).toContain('elements.runAutomaticMatches.addEventListener("click",openAutomaticMatchPreview)');
    expect(html).toContain('elements.confirmAutomaticMatches.addEventListener("click",() => { void runAutomaticMatchBatch(); })');
  });

  it("revalidates each persisted candidate before using trusted confirmation",() => {
    const run = declarationBetween("async function executeAutomaticMatchPreview(){","const runAutomaticMatchBatch");
    expect(run).toContain("executeAutomaticBankMatches({");
    expect(run).toContain("revalidateAutomaticBankMatch({");
    expect(run).toContain("services:{ collection,doc,getDoc,getDocs }");
    expect(run).toContain("confirm:current => confirmBankMatch({");
    expect(run).toContain("automaticExpectedState:{ bankTransaction:current.transaction,source:current.source }");
    expect(run.indexOf("revalidate:proposal")).toBeLessThan(run.indexOf("confirm:current"));
    expect(execution).toContain('const AUTOMATIC_RECORD_COLLECTIONS = Object.freeze({ invoice:"invoices",bill:"bills" })');
  });

  it("prevents repeated execution and refreshes all Banking state after completion",() => {
    expect(html).toContain("const runAutomaticMatchBatch = createSingleFlightAutomaticMatches(executeAutomaticMatchPreview)");
    expect(html).toContain("if(isRunningAutomaticMatches || !currentUser || !pendingAutomaticMatches.length) return");
    expect(html).toMatch(/executeAutomaticBankMatches[\s\S]*?await loadTransactions\(currentUser,false\)[\s\S]*?await loadMatchSources\(currentUser\)[\s\S]*?await loadReconciliationData\(currentUser\)/);
    expect(html).toContain("skipped — details changed; review required");
  });

  it("does not persist candidate or automatic-origin metadata",() => {
    expect(execution).not.toMatch(/updateDoc|setDoc|runTransaction|serverTimestamp|matchMethod/);
    expect(html).not.toContain('matchMethod:"automatic"');
    expect(html).not.toContain("candidateClassification:");
  });

  it("leaves the existing manual Review and Confirm controls in place",() => {
    expect(html).toContain('review.textContent = "Review match"');
    expect(html).toContain('confirm.textContent = confirm.disabled ? "Confirming..." : "Confirm match"');
    expect(html).toContain("async function confirmSuggestedMatch(button)");
    expect(html).toContain("async function unmatchTransaction(button)");
  });
});
