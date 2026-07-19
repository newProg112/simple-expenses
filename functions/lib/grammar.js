/* eslint-disable require-jsdoc */

"use strict";

const PLURALS = Object.freeze({
  invoice: "invoices",
  bill: "bills",
  customer: "customers",
  project: "projects",
  budget: "budgets",
  warning: "warnings",
  record: "records",
  day: "days",
});

function pluralize(count, singular, plural) {
  const number = Number(count);
  if (number === 1) return singular;
  return plural || PLURALS[singular] || `${singular}s`;
}

function countNoun(count, singular, plural, formatter) {
  const number = Number(count);
  const formatted = formatter ? formatter(number) : String(number);
  return `${formatted} ${pluralize(number, singular, plural)}`;
}

function verbForCount(count, singular, plural) {
  return Number(count) === 1 ? singular : plural;
}

module.exports = {countNoun, pluralize, verbForCount};
