import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  firebaseFunctionUrl,
  isLocalFirebaseHost
} from "../resources/js/firebase-runtime.js";

const read = path => readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const config=read("firebase-config.js");
const account=read("account.html");
const insights=read("assets/business-insights.js");
const assistant=read("resources/tools/ai-assistant.html");
const login=read("login.html");
const legacyExpenses=read("expenses/webapp/index.html");

describe("local Firebase runtime routing",() => {
  it.each(["localhost","127.0.0.1","[::1]"])("recognises %s without a storage flag",hostname => {
    expect(isLocalFirebaseHost({location:{hostname}})).toBe(true);
  });

  it.each(["simple-books.co.uk","simple-books-office.web.app","example.com",""])("does not treat production host %s as local",hostname => {
    expect(isLocalFirebaseHost({location:{hostname}})).toBe(false);
  });

  it("connects Auth, Firestore, regional Functions and Storage to the requested local ports",() => {
    expect(config).toContain('connectAuthEmulator(auth, "http://127.0.0.1:9099"');
    expect(config).toContain('connectFirestoreEmulator(db, "127.0.0.1", 8080)');
    expect(config).toContain('const functions = getFunctions(app, "us-central1")');
    expect(config).toContain('connectFunctionsEmulator(functions, "127.0.0.1", 5001)');
    expect(config).toContain('connectStorageEmulator(storage, "127.0.0.1", 9199)');
    expect(config).toMatch(/storage\s*\r?\n};/);
    expect(config).not.toContain("sessionStorage");
  });

  it.each(["localhost","127.0.0.1","[::1]"])("routes HTTP Functions locally for %s",hostname => {
    expect(firebaseFunctionUrl("getMonthlyUsage",{location:{hostname}}))
      .toBe("http://127.0.0.1:5001/simple-books-office/us-central1/getMonthlyUsage");
  });

  it("preserves the exact production Functions URL",() => {
    expect(firebaseFunctionUrl("getMonthlyUsage",{location:{hostname:"simple-books.co.uk"}}))
      .toBe("https://us-central1-simple-books-office.cloudfunctions.net/getMonthlyUsage");
  });

  it("routes only the identified main-app HTTP calls through the local-aware resolver",() => {
    for(const [source,names] of [
      [account,["createCheckoutSession","createBillingPortalSession","ensureUserProfile","getMonthlyUsage"]],
      [insights,["createCheckoutSession"]],
      [assistant,["getMonthlyUsage"]]
    ]){
      for(const name of names) expect(source).toContain(`firebaseFunctionUrl("${name}")`);
      expect(source).not.toContain("https://us-central1-simple-books-office.cloudfunctions.net/");
    }
  });

  it("keeps Try Demo on the shared Auth instance with no production fallback",() => {
    expect(login).toContain('import { auth } from "./firebase-config.js"');
    expect(login).toContain('signInWithEmailAndPassword(\n          auth,');
    expect(login).not.toContain("initializeApp(");
    expect(login).not.toContain("firebaseapp.com");
  });

  it("documents the unchanged legacy Expenses app as a separate, non-emulated Firebase app",() => {
    expect(legacyExpenses).toContain('projectId: "simple-expenses-8ab54"');
    expect(legacyExpenses).toContain("initializeApp(firebaseConfig)");
    expect(legacyExpenses).not.toContain("connectAuthEmulator");
    expect(legacyExpenses).not.toContain("connectFirestoreEmulator");
    expect(legacyExpenses).not.toContain("connectStorageEmulator");
  });
});
