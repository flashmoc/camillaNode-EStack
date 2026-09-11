"use strict";

// One process-wide ordering point for snapshot/restore workflows, including
// their timeout and recovery operations. Existing workflow guards still run.
let tail = Promise.resolve();
module.exports = (operation) => {
  const next = tail.then(operation, operation);
  tail = next.catch(() => {});
  return next;
};
