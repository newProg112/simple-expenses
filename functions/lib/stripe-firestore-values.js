/* eslint-disable require-jsdoc */

"use strict";

const {Timestamp} = require("firebase-admin/firestore");

function stripeTimestampToFirestore(seconds) {
  const numericSeconds = Number(seconds || 0);

  return numericSeconds ? Timestamp.fromMillis(numericSeconds * 1000) : null;
}

module.exports = {
  stripeTimestampToFirestore,
};
