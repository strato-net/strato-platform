#!/usr/bin/env node
"use strict";

const { run } = require("./runbook-smoke-operations");

if (require.main === module) {
  run("smoke", process.argv.slice(2), __filename).catch((error) => {
    console.error(`YIELD_VAULT_SMOKE_FAILED reason=${JSON.stringify(error.message)}`);
    process.exitCode = 1;
  });
}

