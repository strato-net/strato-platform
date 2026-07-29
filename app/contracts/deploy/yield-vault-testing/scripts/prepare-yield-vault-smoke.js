#!/usr/bin/env node
"use strict";

const { run } = require("./runbook-smoke-operations");

if (require.main === module) {
  run("prepare", process.argv.slice(2), __filename).catch((error) => {
    console.error(`YIELD_VAULT_PREPARE_FAILED reason=${JSON.stringify(error.message)}`);
    process.exitCode = 1;
  });
}

