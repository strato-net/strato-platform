/*
  Script: mintKeyAssets.js
  Purpose: Mint ~$10k worth of each key asset (wBTCST, ETHST, GOLDST, SILVST)
           directly to a target wallet using an existing admin JWT – no OAuth dance.

  Usage example (bash):
    export NODE_URL=https://node.mercata.xyz
    export ADMIN_TOKEN=<jwt-of-admin>
    export TO_ADDRESS=1b7dc206ef2fe3aab27404b88c36470ccf16c0ce

    # If you want to override token addresses / amounts, export these too
    export WBTCST=7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9
    export ETHST=93fb7295859b2d70199e0a4883b7c320cf874e6c
    export GOLDST=491cdfe98470bfe69b662ab368826dca0fc2f24d
    export SILVST=2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94

    export AMT_WBTCST=91590000000000000        # 0.09159 WBTC (18-dec)
    export AMT_ETHST=3858150000000000000       # 3.85815 ETH  (18-dec)
    export AMT_GOLDST=2988870000000000000      # 2.98887 GOLD (18-dec)
    export AMT_SILVST=269235000000000000000    # 269.235 SILV (18-dec)

    node scripts/mintKeyAssets.js

  The script will POST a single batch transaction containing four Token.mint
  calls – one per asset. If any tx fails the script exits with code 1.
*/

const axios = require("axios");
require("dotenv").config();

(async () => {
  const node = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  if (!node) throw new Error("Set STRATO_NODE_URL or NODE_URL env var");
  const ROOT = node.replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;

  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN env var is required (JWT)");

  const TO_ADDRESS_RAW = process.env.TO_ADDRESS || "";
  const TO_ADDRESS = TO_ADDRESS_RAW.trim().toLowerCase();
  if (!/^[0-9a-fA-F]{40}$/.test(TO_ADDRESS) && !/^0x[0-9a-fA-F]{40}$/.test(TO_ADDRESS)) {
    console.error(`TO_ADDRESS received: '${TO_ADDRESS_RAW}' (after trim: '${TO_ADDRESS}')`);
    throw new Error("TO_ADDRESS invalid – expected 40 hex characters, with or without 0x prefix");
  }

  // token address helpers – fall back to hard-coded constants
  const addrs = {
    WBTCST: (process.env.WBTCST || "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9").toLowerCase(),
    ETHST : (process.env.ETHST  || "93fb7295859b2d70199e0a4883b7c320cf874e6c").toLowerCase(),
    GOLDST: (process.env.GOLDST || "cdc93d30182125e05eec985b631c7c61b3f63ff0").toLowerCase(),
    SILVST: (process.env.SILVST || "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94").toLowerCase(),
  };

  const amounts = {
    WBTCST: process.env.AMT_WBTCST || "91590000000000000",      // 0.09159 WBTCST
    ETHST : process.env.AMT_ETHST  || "3858150000000000000",   // 3.85815 ETHST
    GOLDST: process.env.AMT_GOLDST || "2988870000000000000",   // 2.98887 GOLDST
    SILVST: process.env.AMT_SILVST || "269235000000000000000", // 269.235 SILVST
  };

  const headers = {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  };

  const buildCall = (name, addr, method, args = {}) => ({
    payload: {
      contractName: name,
      contractAddress: addr,
      method,
      args,
    },
    type: "FUNCTION",
  });

  const txs = Object.entries(addrs).map(([sym, addr]) =>
    buildCall("Token", addr, "mint", {
      to: TO_ADDRESS.replace(/^0x/, ""),
      amount: amounts[sym],
    })
  );

  console.log("Submitting batch mint transaction…");
  try {
    const { data: results } = await axios.post(
      txEndpoint,
      { txs, txParams: { gasPrice: 1, gasLimit: 32100000000 } },
      { headers }
    );

    const failedIdx = results.findIndex((r) => r.status !== "Success");
    if (failedIdx !== -1) {
      console.error("Batch failed:", JSON.stringify(results[failedIdx], null, 2));
      process.exit(1);
    }

    console.log("Mint successful – tx hashes:");
    results.forEach((r, i) => console.log(`  ▸ ${Object.keys(addrs)[i]} → ${r.hash}`));
  } catch (err) {
    console.error("Mint transaction failed:", err.response?.data || err.message || err);
    process.exit(1);
  }
})(); 