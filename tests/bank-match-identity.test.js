import { describe,expect,it } from "vitest";
import {
  descriptionContainsDocumentReference,
  isSafeDocumentReference,
  normaliseDocumentReference,
  normaliseIdentityText,
  normalisePartyName,
  partyNameCorrespondence
} from "../resources/js/bank-match-identity.js";

describe("bank-match identity normalization",() => {
  it("normalizes Unicode NFKC, case, punctuation, and whitespace deterministically",() => {
    expect(normaliseIdentityText("  ＩＮＶ－００２  ")).toBe("inv 002");
    expect(normaliseDocumentReference(" INV / 002 ")).toBe("inv002");
    expect(normaliseDocumentReference(" AB&C123 ")).toBe("abc123");
  });

  it.each(["INV-002","inv 002","INV/002","inv.002","INV002"])(
    "finds the complete reference through the safe formatting variant %s",
    value => expect(descriptionContainsDocumentReference(`Payment ${value} received`,"INV-002")).toBe(true)
  );

  it("does not match a reference inside a longer alphanumeric token",() => {
    expect(descriptionContainsDocumentReference("PAYMENT XINV002Y","INV-002")).toBe(false);
    expect(descriptionContainsDocumentReference("PAYMENTINV002","INV-002")).toBe(false);
  });

  it.each(["","002","123456","ABC","AB-12","A-1234"])(
    "rejects unsafe automatic reference %s",
    reference => expect(isSafeDocumentReference(reference)).toBe(false)
  );

  it("accepts mixed alphanumeric references with a canonical length of at least six",() => {
    expect(isSafeDocumentReference("INV-002")).toBe(true);
    expect(isSafeDocumentReference("A-12345")).toBe(true);
  });

  it("normalizes ampersands and conservative terminal company suffixes",() => {
    expect(normalisePartyName(" Smith & Co. LTD ")).toBe("smith and co limited");
    expect(normalisePartyName("smith and co limited")).toBe("smith and co limited");
    expect(partyNameCorrespondence("SMITH AND CO LIMITED","Smith & Co Ltd")).toEqual({ match:true,strong:true });
  });

  it("reports short names as correspondence without treating them as strong",() => {
    expect(partyNameCorrespondence("ABC LIMITED","ABC Ltd")).toEqual({ match:true,strong:false });
  });

  it("does not use arbitrary party-name substring matching",() => {
    expect(partyNameCorrespondence("PAYMENT FROM XABCY","ABC")).toEqual({ match:false,strong:false });
    expect(partyNameCorrespondence("PROCESSOR PAYMENT ACME LTD","ACME Ltd").match).toBe(false);
  });
});
