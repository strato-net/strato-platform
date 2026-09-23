// Import first in every test file: the config module exits the process on missing variables,
// and state files (checkpoints, journals, the health flag) must not land in the working tree
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

for (const envVar of [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_PRIVATE_KEY",
]) {
  process.env[envVar] = process.env[envVar] || "test";
}

process.chdir(mkdtempSync(path.join(os.tmpdir(), "bridge-test-")));
