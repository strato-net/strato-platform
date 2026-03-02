// @file: scripts/recover-eoa-funds/recover-eoa-funds.js
//
// Recovers ERC-20 tokens sent to a STRATO address that matches an Ethereum EOA.
// Since STRATO uses identical secp256k1/keccak256 address derivation, the same
// private key can sign valid STRATO transactions from that address.
//
// This script signs locally and submits a pre-signed transaction via the STRATO
// core API. The signature proves ownership of the sending address.
//
// Authentication: Uses the same OAuth flow as mercata/contracts/deploy/ scripts.
// Set OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, USERNAME, PASSWORD, and PRIVATE_KEY
// in a .env file (see .env.example).
//
// Usage:
//   # Copy .env.example to .env and fill in secrets, then:
//   node scripts/recover-eoa-funds.js \
//     --from 0xSourceEOA... \
//     --to 0x742d35Cc... \
//     --token-contract 0x8f3Cf7ad... \
//     --amount 1000000 \
//     --nonce 0
//
// Prerequisites:
//   npm install ethers yargs blockapps-rest dotenv

require("dotenv").config({ quiet: true });
const { ethers } = require("ethers");
const { oauthUtil } = require("blockapps-rest");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

// ── Secrets (from .env only — never passed on the command line) ──────────────

const privateKey = process.env.PRIVATE_KEY;
const password = process.env.STRATO_PASSWORD;
const oauthClientSecret = process.env.OAUTH_CLIENT_SECRET;

// Non-secrets from .env
const oauthUrl = process.env.OAUTH_URL;
const oauthClientId = process.env.OAUTH_CLIENT_ID;
const username = process.env.STRATO_USERNAME;
const stratoUrl = (process.env.NODE_URL || "http://localhost").replace(/\/+$/, "");

// ── CLI argument parsing ────────────────────────────────────────────────────

const argv = yargs(hideBin(process.argv))
  .option("from", {
    type: "string",
    demandOption: true,
    describe: "EOA address whose funds are being recovered (must match PRIVATE_KEY)",
  })
  .option("to", {
    type: "string",
    demandOption: true,
    describe: "STRATO address to receive the tokens",
  })
  .option("token-contract", {
    type: "string",
    demandOption: true,
    describe: "Token contract address on STRATO (from Asset Details page)",
  })
  .option("amount", {
    type: "string",
    demandOption: true,
    describe: "Token amount in base units (wei); i.e. 12000000000000000000 for 12 USDST (which has 18 decimals)",
  })
  .option("network", {
    type: "string",
    default: "mercata",
    describe: "STRATO network name",
  })
  .option("nonce", {
    type: "number",
    demandOption: true,
    describe: "Transaction nonce for the sending address",
  })
  .option("gas-limit", {
    type: "number",
    default: 100000000,
    describe: "Gas limit for the transaction",
  })
  .option("dry-run", {
    type: "boolean",
    default: false,
    describe: "Print the transaction JSON without submitting",
  })
  .strict()
  .help()
  .parseSync();

// ── RLP encoding helpers ────────────────────────────────────────────────────
//
// STRATO's RLP encoding matches standard Ethereum RLP. ethers.encodeRlp()
// expects hex-string leaf values (0x-prefixed). We convert each type:
//
// Integer:  0 → "0x" (empty), 1-127 → single byte, ≥128 → big-endian bytes
// Address:  always 20 bytes, zero-padded (Data.Binary.encode for Word160)
// Text:     UTF-8 → hex bytes
// [Text]:   RLP array of hex-encoded texts
//
// Reference: strato/libs/ethereum-rlp/library/Blockchain/Data/RLP.hs:177-206

function intToRlpHex(n) {
  if (n === 0 || n === 0n) return "0x"; // RLPString empty → serializes as 0x80
  const big = BigInt(n);
  let hex = big.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  return "0x" + hex;
}

function textToRlpHex(text) {
  return ethers.hexlify(ethers.toUtf8Bytes(text));
}

function addressToRlpHex(addr) {
  // STRATO encodes Address as exactly 20 bytes via Data.Binary.encode on Word160
  // (putWord32be + putWord64be + putWord64be = 4+8+8 = 20 bytes, big-endian)
  // Reference: strato/libs/blockapps-haskoin/.../BigWord.hs:297-307
  return ethers.zeroPadValue(addr, 20);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!privateKey) {
    throw new Error("PRIVATE_KEY required in .env");
  }
  const privateKeyHex = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
  const from = ethers.getAddress(argv.from);
  const to = ethers.getAddress(argv.to);
  const tokenContract = ethers.getAddress(argv.tokenContract);
  const amount = argv.amount;
  const network = argv.network;
  const gasLimit = argv.gasLimit;

  // Step 1: Derive STRATO address from private key and verify it matches --from
  // Same as Ethereum: pubkey → keccak256 → last 20 bytes
  const signingKey = new ethers.SigningKey(privateKeyHex);
  const derivedAddress = ethers.computeAddress(signingKey.publicKey);

  if (derivedAddress !== from) {
    throw new Error(
      `PRIVATE_KEY derives address ${derivedAddress}, but --from is ${from}. ` +
      "The private key must correspond to the source EOA."
    );
  }

  console.log("==> Step 1: Address verification");
  console.log(`    From (verified): ${from}`);
  console.log(`    To:              ${to}`);
  console.log(`    Token contract:  ${tokenContract}`);
  console.log(`    Amount:          ${amount}`);
  console.log(`    Network:         ${network}`);

  // Step 2: Nonce (provided via CLI)
  const nonce = argv.nonce;
  console.log(`\n==> Step 2: Nonce: ${nonce}`);

  // Step 3: Construct unsigned MessageTX as STRATO RLP
  //
  // partialRLPEncode MessageTX = RLPArray [
  //   rlpEncode (2::Integer),          -- type discriminator
  //   rlpEncode transactionNonce,       -- Integer
  //   rlpEncode transactionGasLimit,    -- Integer
  //   rlpEncode transactionTo,          -- Address (20 bytes)
  //   rlpEncode transactionFuncName,    -- Text
  //   rlpEncode transactionArgs,        -- [Text]
  //   rlpEncode transactionNetwork      -- Text
  // ]
  //
  // Reference: strato/core/blockapps-data/.../TransactionDef.hs:193-203

  // Args for transfer(address _to, uint256 _value):
  //   _to: address wrapped in literal quotes → "\"0x742d35Cc...\""
  //   _value: plain decimal string → "1000000"
  // Reference: strato/api/bloc/bloc2/src/Bloc/Server/Transaction.hs:605-659
  const args = [`"${to}"`, amount];

  const rlpData = [
    intToRlpHex(2), // type discriminator (MessageTX)
    intToRlpHex(nonce), // nonce
    intToRlpHex(gasLimit), // gasLimit
    addressToRlpHex(tokenContract), // to (token contract address)
    textToRlpHex("transfer"), // funcName
    args.map(textToRlpHex), // args as RLP array of texts
    textToRlpHex(network), // network
  ];

  console.log("\n==> Step 3: Constructing unsigned TX RLP");

  // Step 4: Hash — keccak256 of RLP-serialized bytes
  // Reference: strato/core/blockapps-data/.../Transaction.hs:281-282
  //   partialTransactionHash = hash . rlpSerialize . partialRLPEncode
  const rlpEncoded = ethers.encodeRlp(rlpData);
  const txHash = ethers.keccak256(rlpEncoded);
  console.log(`    RLP encoded: ${rlpEncoded}`);
  console.log(`    TX hash:     ${txHash}`);

  // Step 5: Sign — secp256k1 sign the 32-byte hash
  //
  // STRATO uses v = recovery_id + 27 (getSigVals adds 0x1b)
  // Reference: strato/core/blockapps-data/.../Transaction.hs:170-175
  //
  // R/S swap note: STRATO's secp256k1-haskell wrapper has an internal R/S swap
  // in the Storable instance for CompactSig (peek names first 32 bytes "s" and
  // second 32 "r"). signMsg's explicit swap undoes this, so transaction fields
  // store standard (r, s). recoverPub's swap + CompactSig.poke's S-first layout
  // reconstructs correct C memory layout. Net result: standard Node.js signatures
  // work directly without any R/S swap.
  // Reference: strato/libs/secp256k1-haskell/.../Internal.hs:157-212
  //            strato/core/strato-model/.../Secp256k1.hs:287-291
  const sig = signingKey.sign(txHash);

  // ethers v6: sig.r and sig.s are 0x-prefixed 66-char hex strings
  // sig.v is 27 or 28, sig.yParity is 0 or 1
  const rHex = sig.r.slice(2); // strip 0x
  const sHex = sig.s.slice(2); // strip 0x
  const vHex = sig.v.toString(16); // "1b" or "1c"

  console.log(`    v: 0x${vHex} (${sig.v})`);

  // Step 6: Construct JSON payload
  //
  // Must match FromJSON RawTransaction' field names:
  //   from, nonce, gasLimit, to, funcName, args, network, r, s, v, blockNumber, next
  // Reference: strato/core/blockDB/.../JsonBlock.hs:97-142
  //
  // r, s, v are hex strings WITHOUT 0x prefix (parsed by readHex)
  const payload = {
    next: "",
    from: from,
    nonce: nonce,
    gasLimit: gasLimit,
    to: tokenContract,
    funcName: "transfer",
    args: args,
    network: network,
    r: rHex,
    s: sHex,
    v: vHex,
    blockNumber: -1,
  };

  console.log("\n==> Step 4: Transaction JSON");
  console.log(JSON.stringify(payload, null, 2));

  if (argv.dryRun) {
    console.log("\n==> DRY RUN: not submitting transaction");
    return;
  }

  // Step 7: Acquire OAuth token
  //
  // Same pattern as mercata/contracts/deploy/auth.js — uses blockapps-rest oauthUtil
  // with Resource Owner Password Credentials grant.
  let authToken;
  if (username && password) {
    if (!oauthUrl || !oauthClientId || !oauthClientSecret) {
      throw new Error(
        "OAUTH_URL, OAUTH_CLIENT_ID, and OAUTH_CLIENT_SECRET required in .env for authentication. " +
        "See .env.example for reference."
      );
    }
    console.log(`\n==> Authenticating as ${username}...`);
    const oauth = await oauthUtil.init({
      openIdDiscoveryUrl: oauthUrl,
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      tokenField: "access_token",
    });
    const tokenObj = await oauth.getAccessTokenByResourceOwnerCredential(
      username,
      password
    );
    authToken = tokenObj.token.access_token;
    console.log("    Authenticated successfully");
  }

  // Step 8: POST to STRATO core API
  //
  // /strato-api/eth/v1.2/transaction → core API POST /eth/v1.2/transaction
  //   (accepts RawTransaction' JSON, returns tx hash)
  //
  // Reference: strato/api/core/src/Handlers/Transaction.hs:95-97,216-236
  //            nginx-packager/nginx.tpl.conf:442-446
  const postUrl = `${stratoUrl}/strato-api/eth/v1.2/transaction`;
  console.log(`\n==> Step 5: Submitting to ${postUrl}`);

  // User-Agent must match an API client pattern in csrf.lua's whitelist,
  // otherwise nginx treats this as a browser request and blocks the POST
  // for missing CSRF token/session cookie.
  // Reference: nginx-packager/csrf.lua:60-64
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "node-fetch",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const postResp = await fetch(postUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const responseText = await postResp.text();

  console.log(`\n==> Step 6: Submission result`);
  console.log(`    HTTP status: ${postResp.status}`);

  if (!postResp.ok) {
    console.error(`    Submission FAILED`);
    console.error(`    Response: ${responseText}`);
    process.exit(1);
  }

  // The core API returns the tx hash as a quoted JSON string
  const submittedHash = responseText.replace(/^"|"$/g, "").trim();
  console.log(`    Transaction hash: ${submittedHash}`);
  console.log("    Transaction submitted to sequencer, polling for result...");

  // Step 9: Poll for transaction result
  //
  // GET /strato-api/eth/v1.2/transactionResult/{txHash}
  // Returns [] while pending, then [{ status, message, ... }] when processed.
  // status is "success" (string) or { stage, type, ... } (Failure object).
  //
  // Reference: strato/api/core/src/Handlers/TransactionResult.hs:35,40
  //            strato/core/blockapps-datadefs/src/Blockchain/Data/DataDefs.txt:99-114
  //            strato/core/blockapps-datadefs/src/Blockchain/Data/TransactionResultStatus.hs:17-26
  const resultUrl = `${stratoUrl}/strato-api/eth/v1.2/transactionResult/${submittedHash}`;
  const maxAttempts = 60;
  const pollIntervalMs = 2000;

  let txResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const resultResp = await fetch(resultUrl, { headers });
    if (!resultResp.ok) {
      console.log(`    Poll ${attempt}: HTTP ${resultResp.status}`);
      continue;
    }

    const results = await resultResp.json();
    if (Array.isArray(results) && results.length > 0) {
      txResult = results[0];
      break;
    }
    if (attempt % 5 === 0) {
      console.log(`    Poll ${attempt}/${maxAttempts}: still pending...`);
    }
  }

  console.log(`\n==> Step 7: Transaction result`);

  if (!txResult) {
    console.error("    Timed out waiting for transaction result.");
    console.error(`    Check manually: GET ${resultUrl}`);
    process.exit(1);
  }

  if (txResult.status === "success") {
    console.log("    Status: SUCCESS");
    console.log(`    Gas used: ${txResult.gasUsed}`);
    console.log(`\n    Transfer completed successfully!`);
  } else {
    console.error("    Status: FAILED");
    console.error(`    Message: ${txResult.message}`);
    if (txResult.status && typeof txResult.status === "object") {
      console.error(`    Failure stage: ${txResult.status.stage}`);
      console.error(`    Failure type: ${JSON.stringify(txResult.status.type)}`);
      if (txResult.status.details) {
        console.error(`    Details: ${txResult.status.details}`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
