import { describe,expect,it } from "vitest";
import {
  bankAccountOpeningBalanceLocked,
  createBankAccountWithOpeningBalance,
  postLegacyBankOpeningBalance,
  updateBankAccountWithOpeningBalance
} from "../resources/js/bank-opening-balance.js";
import { validateBankAccountInput } from "../resources/js/bank-account-view.js";
import { generalLedgerViewFromJournals } from "../resources/js/general-ledger-view.js";
import { buildBalanceSheetReport } from "../resources/js/balance-sheet-view.js";
import { buildProfitLossReport } from "../resources/js/profit-loss-view.js";
import { buildTrialBalance } from "../resources/js/ledger-engine.js";
import { bankOpeningBalanceJournalDocumentId } from "../resources/js/ledger-firestore.js";

const userId = "user-1";
const timestamp = Object.freeze({ serverTimestamp:true });

function accountPath(accountId){
  return `users/${userId}/bankAccounts/${accountId}`;
}

function journalPath(accountId){
  return `journals/${bankOpeningBalanceJournalDocumentId(userId,accountId)}`;
}

function firestoreFixture(seed = []){
  const documents = new Map(seed.map(([path,data]) => [path,structuredClone(data)]));
  const writes = [];
  let queue = Promise.resolve();
  const reference = path => ({ path });
  const services = {
    collection:(_db,...segments) => reference(segments.join("/")),
    doc:(_db,...segments) => reference(segments.join("/")),
    where:(field,operator,value) => ({ field,operator,value }),
    query:(collectionReference,constraint) => ({ collectionReference,constraint }),
    getDocs:async request => {
      const docs = [...documents.entries()]
        .filter(([path,data]) => path.startsWith(`${request.collectionReference.path}/`) &&
          data[request.constraint.field] === request.constraint.value)
        .map(([path,data]) => ({ id:path.split("/").at(-1),data:() => structuredClone(data) }));
      return { docs,empty:docs.length === 0 };
    },
    serverTimestamp:() => timestamp,
    runTransaction:(_db,callback) => {
      const operation = queue.then(async () => {
        const staged = [];
        const transaction = {
          get:async documentReference => ({
            exists:() => documents.has(documentReference.path),
            data:() => structuredClone(documents.get(documentReference.path))
          }),
          set:(documentReference,data) => staged.push({ type:"set",path:documentReference.path,data:structuredClone(data) }),
          update:(documentReference,data) => staged.push({ type:"update",path:documentReference.path,data:structuredClone(data) }),
          delete:documentReference => staged.push({ type:"delete",path:documentReference.path })
        };
        const result = await callback(transaction);
        staged.forEach(write => {
          writes.push({ type:write.type,path:write.path });
          if(write.type === "delete") documents.delete(write.path);
          else if(write.type === "set") documents.set(write.path,write.data);
          else documents.set(write.path,{ ...documents.get(write.path),...write.data });
        });
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
  return { documents,writes,services };
}

function createOptions(fixture,overrides = {}){
  const accountId = overrides.bankAccountId || "account-1";
  return {
    db:{},userId,bankAccountId:accountId,
    input:{
      accountName:`Current ${accountId}`,
      bankName:"Example Bank",
      openingBalance:100,
      openingBalanceDate:"2026-04-01",
      ...(overrides.input || {})
    },
    services:fixture.services
  };
}

function postedJournals(fixture){
  return [...fixture.documents.entries()]
    .filter(([path]) => path.startsWith("journals/"))
    .map(([,data]) => data);
}

describe("bank opening-balance journal accounting",() => {
  it.each([
    [125.5,[
      { accountCode:"1000",debit:125.5,credit:0 },
      { accountCode:"3100",debit:0,credit:125.5 }
    ]],
    [-80,[
      { accountCode:"3100",debit:80,credit:0 },
      { accountCode:"1000",debit:0,credit:80 }
    ]]
  ])("posts a signed opening balance of %s correctly",async (openingBalance,expectedLines) => {
    const fixture = firestoreFixture();
    await createBankAccountWithOpeningBalance(createOptions(fixture,{ input:{ openingBalance } }));
    const account = fixture.documents.get(accountPath("account-1"));
    const journal = fixture.documents.get(journalPath("account-1"));
    expect(account.openingBalanceAccounting).toMatchObject({
      version:1,bankAccountId:"account-1",openingBalance,state:"posted",
      journalId:bankOpeningBalanceJournalDocumentId(userId,"account-1")
    });
    expect(journal).toMatchObject({
      userId,sourceType:"bankOpeningBalance",sourceId:"account-1",bankAccountId:"account-1",
      openingBalanceVersion:1,openingBalanceAmount:openingBalance,openingBalanceDate:"2026-04-01"
    });
    expect(journal.lines).toEqual(expectedLines.map(line => expect.objectContaining(line)));

    const journals = postedJournals(fixture);
    const trialBalance = buildTrialBalance(journals);
    const profitLoss = buildProfitLossReport(journals);
    const balanceSheet = buildBalanceSheetReport(journals);
    expect(trialBalance).toMatchObject({ balanced:true,totalDebits:Math.abs(openingBalance),totalCredits:Math.abs(openingBalance) });
    expect(profitLoss).toMatchObject({ totalIncome:0,totalExpenses:0,netResult:0 });
    expect(balanceSheet).toMatchObject({ totalAssets:openingBalance,totalEquity:openingBalance,difference:0 });
    expect(balanceSheet.equityRows).toEqual([expect.objectContaining({ accountCode:"3100",accountName:"Opening Balance Equity",amount:openingBalance })]);
    expect(generalLedgerViewFromJournals(journals,{ accountCode:"1000" }))
      .toMatchObject({ state:"loaded",entriesCount:1,closingBalance:openingBalance });
  });

  it("records a confirmed zero opening balance without a misleading journal",async () => {
    const fixture = firestoreFixture();
    await createBankAccountWithOpeningBalance(createOptions(fixture,{ input:{ openingBalance:0 } }));
    expect(fixture.documents.get(accountPath("account-1")).openingBalanceAccounting)
      .toMatchObject({ version:1,state:"not-required",openingBalance:0,journalId:"" });
    expect(fixture.documents.has(journalPath("account-1"))).toBe(false);
    expect(postedJournals(fixture)).toEqual([]);
  });

  it("requires a real calendar effective date",async () => {
    for(const date of ["","01/04/2026","2026-02-30","anything"]){
      expect(validateBankAccountInput({ accountName:"Current",bankName:"Bank",openingBalance:10,openingBalanceDate:date }))
        .toMatchObject({ valid:false,errors:{ openingBalanceDate:"Enter a valid opening balance effective date." } });
      const fixture = firestoreFixture();
      await expect(createBankAccountWithOpeningBalance(createOptions(fixture,{ input:{ openingBalanceDate:date } })))
        .rejects.toThrow(/effective date|bank account details/i);
      expect(fixture.documents.size).toBe(0);
    }
  });

  it("uses one deterministic journal ID and is idempotent for retries and serialised two-tab requests",async () => {
    expect(bankOpeningBalanceJournalDocumentId(userId,"account/1"))
      .toBe("bank-opening-balance_user-1_account%2F1");
    const fixture = firestoreFixture();
    const options = createOptions(fixture);
    const results = await Promise.all([
      createBankAccountWithOpeningBalance(options),
      createBankAccountWithOpeningBalance(options)
    ]);
    expect(results.map(result => result.status).sort()).toEqual(["already-created","created"]);
    expect(postedJournals(fixture)).toHaveLength(1);
    expect(fixture.writes).toHaveLength(2);
    await expect(createBankAccountWithOpeningBalance(options)).resolves.toMatchObject({ status:"already-created" });
    expect(fixture.writes).toHaveLength(2);
  });

  it("rejects deterministic collisions and altered ownership",async () => {
    const collision = firestoreFixture([[journalPath("account-1"),{ userId:"user-2" }]]);
    await expect(createBankAccountWithOpeningBalance(createOptions(collision))).rejects.toThrow(/already exists/i);
    expect(collision.documents.has(accountPath("account-1"))).toBe(false);

    const fixture = firestoreFixture();
    const options = createOptions(fixture);
    await createBankAccountWithOpeningBalance(options);
    fixture.documents.get(journalPath("account-1")).userId = "user-2";
    await expect(createBankAccountWithOpeningBalance(options)).rejects.toThrow(/another user/i);
    expect(fixture.writes).toHaveLength(2);
  });
});

describe("legacy opt-in, correction, and locking",() => {
  const legacyAccount = Object.freeze({
    accountName:"Legacy Current",bankName:"Old Bank",openingBalance:250,status:"Active",
    createdAt:"2025-01-01T00:00:00.000Z"
  });

  it("does not silently backfill a legacy account while editing it",async () => {
    const fixture = firestoreFixture([[accountPath("legacy"),legacyAccount]]);
    await expect(updateBankAccountWithOpeningBalance(createOptions(fixture,{
      bankAccountId:"legacy",input:{ accountName:"Renamed",openingBalance:275,openingBalanceDate:"2026-04-01" }
    }))).resolves.toMatchObject({ status:"updated-legacy-unposted" });
    expect(fixture.documents.get(accountPath("legacy"))).not.toHaveProperty("openingBalanceAccounting");
    expect(fixture.documents.has(journalPath("legacy"))).toBe(false);
  });

  it("posts a legacy balance only after an explicit dated request and remains idempotent",async () => {
    const fixture = firestoreFixture([[accountPath("legacy"),legacyAccount]]);
    const request = {
      db:{},userId,bankAccountId:"legacy",openingBalanceDate:"2025-01-01",services:fixture.services
    };
    await expect(postLegacyBankOpeningBalance(request)).resolves.toMatchObject({ status:"posted" });
    await expect(postLegacyBankOpeningBalance(request)).resolves.toMatchObject({ status:"already-posted" });
    expect(fixture.documents.get(accountPath("legacy")).openingBalanceAccounting)
      .toMatchObject({ version:1,state:"posted",openingBalanceDate:"2025-01-01" });
    expect(postedJournals(fixture)).toHaveLength(1);
  });

  it("safely replaces the deterministic accounting effect before Banking activity",async () => {
    const fixture = firestoreFixture();
    await createBankAccountWithOpeningBalance(createOptions(fixture));
    await expect(updateBankAccountWithOpeningBalance(createOptions(fixture,{
      input:{ openingBalance:-40,openingBalanceDate:"2026-03-31",accountName:"Corrected" }
    }))).resolves.toMatchObject({ status:"opening-balance-corrected" });
    expect(postedJournals(fixture)).toHaveLength(1);
    expect(fixture.documents.get(journalPath("account-1"))).toMatchObject({ openingBalanceAmount:-40,date:"2026-03-31" });
    expect(fixture.documents.get(journalPath("account-1")).lines).toEqual([
      expect.objectContaining({ accountCode:"3100",debit:40,credit:0 }),
      expect.objectContaining({ accountCode:"1000",debit:0,credit:40 })
    ]);

    await updateBankAccountWithOpeningBalance(createOptions(fixture,{ input:{ openingBalance:0,openingBalanceDate:"2026-03-30" } }));
    expect(fixture.documents.has(journalPath("account-1"))).toBe(false);
    expect(fixture.documents.get(accountPath("account-1")).openingBalanceAccounting.state).toBe("not-required");
  });

  it("locks accounting fields after imported activity while still allowing display-field edits",async () => {
    const fixture = firestoreFixture();
    await createBankAccountWithOpeningBalance(createOptions(fixture));
    fixture.documents.set(`users/${userId}/bankTransactions/transaction-1`,{
      bankAccountId:"account-1",status:"unmatched"
    });
    expect(bankAccountOpeningBalanceLocked({ id:"account-1" },[{ bankAccountId:"account-1" }])).toBe(true);
    await expect(updateBankAccountWithOpeningBalance(createOptions(fixture,{ input:{ openingBalance:101 } })))
      .rejects.toThrow(/locked/i);
    await expect(updateBankAccountWithOpeningBalance(createOptions(fixture,{ input:{ accountName:"Renamed only" } })))
      .resolves.toMatchObject({ status:"updated",locked:true });
    expect(fixture.documents.get(accountPath("account-1"))).toMatchObject({ accountName:"Renamed only",openingBalance:100 });

    const legacy = firestoreFixture([
      [accountPath("legacy"),{ ...legacyAccount,bankingActivity:{ version:1,type:"importedTransaction" } }]
    ]);
    await expect(postLegacyBankOpeningBalance({
      db:{},userId,bankAccountId:"legacy",openingBalanceDate:"2025-01-01",services:legacy.services
    })).resolves.toMatchObject({ status:"posted" });
    expect(legacy.documents.get(accountPath("legacy")).openingBalance).toBe(250);
    expect(legacy.documents.get(accountPath("legacy")).openingBalanceAccounting)
      .toMatchObject({ state:"posted",openingBalance:250,openingBalanceDate:"2025-01-01" });
  });

  it("keeps an archived account's journal and supports independent multiple accounts",async () => {
    const fixture = firestoreFixture();
    await createBankAccountWithOpeningBalance(createOptions(fixture,{ bankAccountId:"account-1",input:{ openingBalance:100 } }));
    await createBankAccountWithOpeningBalance(createOptions(fixture,{ bankAccountId:"account-2",input:{ openingBalance:50 } }));
    fixture.documents.get(accountPath("account-1")).status = "Archived";
    expect(fixture.documents.has(journalPath("account-1"))).toBe(true);
    expect(fixture.documents.has(journalPath("account-2"))).toBe(true);
    expect(postedJournals(fixture).map(journal => journal.bankAccountId).sort()).toEqual(["account-1","account-2"]);
    expect(buildBalanceSheetReport(postedJournals(fixture))).toMatchObject({ totalAssets:150,totalEquity:150,difference:0 });
  });
});
