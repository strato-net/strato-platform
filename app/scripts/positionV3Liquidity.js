/*
  Script: positionV3Liquidity.js
  Purpose: Reposition corporate laddered liquidity in a V3 (concentrated-liquidity) pool.
           Exits every position the corporate account holds in the pool (principal + fees),
           then re-mints an N-layer ladder of ranges centered on the oracle price (or --price),
           distributing the given per-token budgets across the layers by weight.

  Dry-run by default: prints the current positions, the drift vs the new center, and the
  exact per-layer deposits the mint would pull. Re-run with --execute to submit.

  Drives the app backend REST API (/poolv3/*) as the corporate account, so all liquidity
  math, approvals and tx batching use the same battle-tested path as the UI.

  Env:
    NODE_URL      node base url, e.g. https://<host>  (the script calls <NODE_URL>/api)

  Auth — two supported login types (configure exactly one, or pick with --auth):
    1) Keycloak (OAuth password grant; the node-held key signs server-side):
         OAUTH_URL (openid discovery url; OAUTH_DISCOVERY_URL also accepted),
         OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET,
         OAUTH_USERNAME, OAUTH_PASSWORD, OAUTH_TOTP (accounts with 2FA)
       If the login fails without a valid OTP and the shell is interactive, the
       script prompts for a fresh code.
    2) Wallet key pair (MetaMask-style account; txs are signed locally):
         WALLET_PRIVATE_KEY=<hex private key>
       Mirrors the browser wallet flow: X-Wallet-Address on every request, the backend
       returns unsigned txs, the script EIP-712-signs them (domain "STRATO") and
       submits via /rpc/submit, then polls /rpc/results until confirmed.

  Usage:
    node positionV3Liquidity.js --pool <address> --amount SYMBOL=AMOUNT [--amount SYMBOL=AMOUNT]
      [--price <token1-per-token0>]   center price; default: pool's oracle price
      [--widths 1,3,7,15,35]          layer half-widths, in percent around the center
      [--weights 10,15,20,25,30]      budget share per layer, in percent (sums to 100)
      [--slippage 1]                  min-amount tolerance in percent for mints
      [--keep-existing]               skip the exit phase, only mint the new ladder
      [--auth keycloak|wallet]        force an auth mode when both are configured
      [--execute]                     submit transactions (default: dry-run)

  Example (gold ladder):
    node positionV3Liquidity.js --pool 8f3a... --amount GOLDST=3.0 --amount USDST=15000
*/

// app/scripts has no package.json of its own — resolve deps from a sibling workspace
const path = require("path");
const { createRequire } = require("module");
const req = (name) => {
  for (const anchor of [__filename, path.join(__dirname, "../backend/_.js"), path.join(__dirname, "../contracts/_.js")]) {
    try {
      return createRequire(anchor)(name);
    } catch (_) { /* try next anchor */ }
  }
  throw new Error(`cannot resolve "${name}" — run npm install in app/backend`);
};
const axios = req("axios");
req("dotenv").config();

const MIN_TICK = -887272;
const MAX_TICK = 887272;

// ---------- args ----------

const usageAndExit = (msg) => {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error(
    "Usage: node positionV3Liquidity.js --pool <address> --amount SYM=AMT [--amount SYM=AMT]\n" +
      "         [--price N] [--widths 1,3,7,15,35] [--weights 10,15,20,25,30]\n" +
      "         [--slippage 1] [--keep-existing] [--auth keycloak|wallet] [--execute]"
  );
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = {
    amounts: [],
    widths: [1, 3, 7, 15, 35],
    weights: [10, 15, 20, 25, 30],
    slippage: 1,
    execute: false,
    keepExisting: false,
  };
  const numList = (s) => s.split(",").map((x) => Number(x.trim()));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) usageAndExit(`${a} requires a value`);
      return argv[++i];
    };
    if (a === "--pool") args.pool = val().toLowerCase().replace(/^0x/, "");
    else if (a === "--amount") args.amounts.push(val());
    else if (a === "--price") args.price = Number(val());
    else if (a === "--widths") args.widths = numList(val());
    else if (a === "--weights") args.weights = numList(val());
    else if (a === "--slippage") args.slippage = Number(val());
    else if (a === "--auth") args.auth = val();
    else if (a === "--execute") args.execute = true;
    else if (a === "--keep-existing") args.keepExisting = true;
    else if (a === "--help" || a === "-h") usageAndExit();
    else usageAndExit(`unknown flag ${a}`);
  }
  if (!args.pool) usageAndExit("--pool is required");
  if (args.amounts.length === 0) usageAndExit("at least one --amount SYM=AMT is required");
  if (args.widths.length !== args.weights.length)
    usageAndExit("--widths and --weights must have the same number of layers");
  if (args.widths.some((w) => !(w > 0 && w < 100)) )
    usageAndExit("--widths must be percentages in (0, 100)");
  const weightSum = args.weights.reduce((s, w) => s + w, 0);
  if (Math.abs(weightSum - 100) > 0.001) usageAndExit(`--weights must sum to 100 (got ${weightSum})`);
  if (args.price !== undefined && !(args.price > 0)) usageAndExit("--price must be a positive number");
  if (args.auth !== undefined && !["keycloak", "wallet"].includes(args.auth))
    usageAndExit(`--auth must be "keycloak" or "wallet" (got "${args.auth}")`);
  if (!(args.slippage >= 0 && args.slippage < 100)) usageAndExit("--slippage must be in [0, 100)");
  return args;
};

// ---------- units ----------

// "3.0" + 18 decimals -> 3000000000000000000n (exact, no floats)
const toWei = (human, decimals) => {
  const m = String(human).trim().match(/^(\d+)(?:\.(\d*))?$/);
  if (!m) throw new Error(`invalid amount "${human}"`);
  const frac = (m[2] || "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(m[1] + frac);
};

const fromWei = (wei, decimals, dp = 6) => {
  const s = BigInt(wei).toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).slice(0, dp).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
};

const pctOf = (wei, pct) => (BigInt(wei) * BigInt(Math.round(pct * 100))) / 10000n;

// ---------- tick math (display/planning only; exact math is server-side) ----------

// human price is token1-per-token0; raw on-chain ratio adjusts for decimals
const priceToTick = (humanPrice, dec0, dec1) =>
  Math.log(humanPrice * Math.pow(10, dec1 - dec0)) / Math.log(1.0001);

const tickToPrice = (tick, dec0, dec1) => Math.pow(1.0001, tick) * Math.pow(10, dec0 - dec1);

const clampTick = (t) => Math.min(MAX_TICK, Math.max(MIN_TICK, t));

// ---------- output ----------

const printTable = (headers, rows) => {
  const all = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, c) => Math.max(...all.map((r) => r[c].length)));
  const line = (r) => "  " + r.map((cell, c) => cell.padEnd(widths[c])).join("  ");
  console.log(line(headers));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((r) => console.log(line(r.map(String))));
};

const fmt = (n, dp = 2) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: dp });

// adaptive decimals so sub-1 prices don't render as "0"
const fmtPrice = (n) => fmt(n, Number(n) >= 1000 ? 2 : Number(n) >= 1 ? 4 : 8);

// ---------- main ----------

(async () => {
  const args = parseArgs(process.argv.slice(2));

  const NODE = (process.env.STRATO_NODE_URL || process.env.NODE_URL || "").replace(/\/+$/, "");
  if (!NODE) usageAndExit("set NODE_URL env var, e.g. https://<host>");
  const API = NODE.endsWith("/api") ? NODE : `${NODE}/api`;

  // ---- auth: keycloak (server-side signing) or wallet key pair (local signing) ----
  const ask = (q) =>
    new Promise((resolve) => {
      const rl = require("readline").createInterface({ input: process.stdin, output: process.stderr });
      rl.question(q, (a) => { rl.close(); resolve(a); });
    });

  const keycloakLogin = async () => {
    const disc = process.env.OAUTH_URL || process.env.OAUTH_DISCOVERY_URL;
    if (!disc) usageAndExit("set OAUTH_URL + OAUTH_* creds (or WALLET_PRIVATE_KEY)");
    const { data: meta } = await axios.get(disc);
    const grant = async (totp) => {
      const form = new URLSearchParams({
        grant_type: "password",
        client_id: process.env.OAUTH_CLIENT_ID,
        client_secret: process.env.OAUTH_CLIENT_SECRET,
        username: process.env.OAUTH_USERNAME,
        password: process.env.OAUTH_PASSWORD,
      });
      if (totp) form.set("totp", totp);
      const { data } = await axios.post(meta.token_endpoint, form);
      return data.access_token;
    };
    const otp = (process.env.OAUTH_TOTP || "").trim();
    try {
      return await grant(otp);
    } catch (err) {
      const detail = err.response ? JSON.stringify(err.response.data) : err.message;
      // Keycloak answers invalid_grant for a missing, expired or wrong OTP the same
      // way as for bad credentials — when interactive, ask for a fresh code and retry
      if (process.stdin.isTTY) {
        console.error(`Keycloak login failed (${detail})${otp ? " — OAUTH_TOTP may have expired" : ""}`);
        for (let attempt = 0; attempt < 3; attempt++) {
          const code = (await ask("Fresh OTP code (blank to give up): ")).trim();
          if (!code) break;
          try {
            return await grant(code);
          } catch (retryErr) {
            const retryDetail = retryErr.response ? JSON.stringify(retryErr.response.data) : retryErr.message;
            console.error(`Still failing (${retryDetail})`);
          }
        }
      }
      throw new Error(`Keycloak login failed: ${detail}`);
    }
  };

  const hasWalletKey = !!process.env.WALLET_PRIVATE_KEY;
  const hasKeycloak = !!(process.env.OAUTH_URL || process.env.OAUTH_DISCOVERY_URL);
  let mode = args.auth;
  if (!mode) {
    if (hasWalletKey && hasKeycloak)
      usageAndExit("both WALLET_PRIVATE_KEY and Keycloak env are configured — choose with --auth keycloak|wallet");
    mode = hasWalletKey ? "wallet" : "keycloak";
  }

  let api, who, wallet;
  if (mode === "wallet") {
    if (!hasWalletKey) usageAndExit("--auth wallet requires WALLET_PRIVATE_KEY");
    const { Wallet } = req("ethers");
    wallet = new Wallet(process.env.WALLET_PRIVATE_KEY.trim());
    who = wallet.address;
    api = axios.create({ baseURL: API, headers: { "X-Wallet-Address": wallet.address } });
  } else {
    const token = await keycloakLogin();
    api = axios.create({ baseURL: API, headers: { Authorization: `Bearer ${token}` } });
    who = "";
    try {
      // decode JWT payload (display only, no verification)
      who = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).preferred_username || "";
    } catch (_) { /* opaque token — fine */ }
  }

  const apiError = (err, what) => {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`${what} failed: ${detail}`);
  };

  // Wallet mode returns unsigned txs instead of executing. Mirror the browser flow
  // (app/ui/src/lib/axios.ts signAndSubmitUnsignedTxs): EIP-712-sign each tx with
  // domain STRATO/1, submit via /rpc/submit, then poll /rpc/results until confirmed.
  const STRATO_TX_TYPES = {
    Transaction: [
      { name: "to", type: "address" },
      { name: "funcName", type: "string" },
      { name: "args", type: "string[]" },
      { name: "nonce", type: "uint256" },
      { name: "gasLimit", type: "uint256" },
      { name: "network", type: "string" },
    ],
  };

  const submitWalletTxs = async (unsignedTxs) => {
    const hashes = [];
    for (const tx of unsignedTxs) {
      const d = { ...tx.data, network: tx.data.network || "STRATO" };
      const sig = await wallet.signTypedData({ name: "STRATO", version: "1" }, STRATO_TX_TYPES, {
        to: `0x${String(d.to).replace(/^0x/, "")}`,
        funcName: d.functionName ?? "",
        args: d.args ?? [],
        nonce: BigInt(d.nonce),
        gasLimit: BigInt(d.gasLimit),
        network: d.network,
      });
      const raw = sig.replace(/^0x/, "");
      const { data: submitted } = await api.post("/rpc/submit", {
        nonce: d.nonce,
        gasLimit: d.gasLimit,
        to: d.to,
        funcName: d.functionName,
        args: d.args,
        network: d.network,
        r: raw.slice(0, 64),
        s: raw.slice(64, 128),
        v: raw.slice(128, 130),
        txVersion: 1,
      });
      hashes.push(typeof submitted === "string" ? submitted : tx.hash);
    }
    const deadline = Date.now() + 120000;
    for (;;) {
      const { data: results } = await api.post("/rpc/results", hashes);
      const failed = results.find((r) => r && r.status === "Failure");
      if (failed)
        throw new Error(`tx failed on-chain: ${failed.txResult?.message || failed.message || JSON.stringify(failed)}`);
      if (results.every((r) => r && r.status !== "Pending")) return results;
      if (Date.now() > deadline) throw new Error(`timed out waiting for confirmation of ${hashes.join(", ")}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  };

  // POST/DELETE that works in both modes: keycloak executes server-side; wallet mode
  // signs and submits the returned unsigned txs locally
  const mutate = async (method, url, body) => {
    const res = method === "delete" ? await api.delete(url, { data: body }) : await api.post(url, body);
    if (res.data && res.data._unsigned && Array.isArray(res.data._unsignedTxs)) {
      return submitWalletTxs(res.data._unsignedTxs);
    }
    return res.data;
  };

  // ---- pool state ----
  const pool = await api.get(`/poolv3/pools/${args.pool}`).then((r) => r.data, (e) => apiError(e, "fetch pool"));
  const { token0, token1 } = pool;
  const pair = `${token0.symbol}/${token1.symbol}`;

  if (pool.isDisabled) throw new Error(`pool ${pair} is disabled — minting would fail; aborting before exiting anything`);
  if (pool.isPaused) throw new Error(`pool ${pair} is paused — minting would fail; aborting before exiting anything`);

  // ---- budgets (symbol- or address-keyed, mapped onto the pool's token0/token1) ----
  const budgets = { 0: 0n, 1: 0n };
  for (const spec of args.amounts) {
    const [sym, amt] = spec.split("=");
    if (!sym || amt === undefined) usageAndExit(`--amount must be SYMBOL=AMOUNT (got "${spec}")`);
    const key = sym.trim().toLowerCase().replace(/^0x/, "");
    const side =
      key === token0.symbol.toLowerCase() || key === token0.address.toLowerCase() ? 0
      : key === token1.symbol.toLowerCase() || key === token1.address.toLowerCase() ? 1
      : usageAndExit(`"${sym}" is not in this pool (tokens: ${token0.symbol}, ${token1.symbol})`);
    budgets[side] += toWei(amt, side === 0 ? token0.decimals : token1.decimals);
  }
  if (budgets[0] === 0n && budgets[1] === 0n) usageAndExit("all budgets are zero");
  if (budgets[0] === 0n || budgets[1] === 0n)
    console.warn(`⚠ only one token budgeted — layers spanning the current price will be limited by the zero side\n`);

  // ---- center price ----
  const spot = Number(pool.priceWad) / 1e18;
  const oracle = Number(pool.oraclePriceWad) / 1e18;
  let center = args.price;
  if (center === undefined) {
    if (!(oracle > 0)) throw new Error(`pool has no oracle price — pass --price <${token1.symbol} per ${token0.symbol}>`);
    center = oracle;
  }
  const driftPct = spot > 0 ? ((spot - center) / center) * 100 : 0;

  console.log(`\n=== positionV3Liquidity — ${pair} (fee ${pool.fee / 10000}%) ===`);
  console.log(`Backend:      ${API}${who ? `  (as ${who})` : ""}`);
  console.log(`Pool:         ${pool.address}  tickSpacing ${pool.tickSpacing}  currentTick ${pool.currentTick}`);
  console.log(`Pool spot:    1 ${token0.symbol} = ${fmt(spot, 6)} ${token1.symbol}`);
  console.log(`Oracle:       ${oracle > 0 ? `1 ${token0.symbol} = ${fmt(oracle, 6)} ${token1.symbol}` : "n/a"}`);
  console.log(`Center used:  ${fmt(center, 6)} ${args.price !== undefined ? "(--price)" : "(oracle)"}  — pool spot is ${fmt(driftPct, 2)}% off center`);
  if (Math.abs(driftPct) > 5)
    console.warn(`⚠ pool spot deviates >5% from the chosen center — ranges near the center will mint single-sided until arbitrage converges`);
  console.log(`Budgets:      ${fromWei(budgets[0], token0.decimals)} ${token0.symbol} + ${fromWei(budgets[1], token1.decimals)} ${token1.symbol}`);

  // ---- existing positions ----
  const positions = await api
    .get("/poolv3/positions", { params: { poolAddress: args.pool } })
    .then((r) => r.data, (e) => apiError(e, "fetch positions"));
  const live = positions.filter(
    (p) =>
      BigInt(p.liquidity) > 0n ||
      BigInt(p.tokensOwed0) + BigInt(p.pendingFees0) > 0n ||
      BigInt(p.tokensOwed1) + BigInt(p.pendingFees1) > 0n
  );

  let exit0 = 0n, exit1 = 0n;
  console.log(`\n--- Existing positions (${live.length}) ${args.keepExisting ? "— kept (--keep-existing)" : "— will be exited"} ---`);
  if (live.length > 0) {
    printTable(
      ["#", "kind", "id/range", "price range", "in", token0.symbol, token1.symbol, `fees ${token0.symbol}`, `fees ${token1.symbol}`],
      live.map((p, i) => {
        const fees0 = BigInt(p.tokensOwed0) + BigInt(p.pendingFees0);
        const fees1 = BigInt(p.tokensOwed1) + BigInt(p.pendingFees1);
        exit0 += BigInt(p.amount0) + fees0;
        exit1 += BigInt(p.amount1) + fees1;
        return [
          i + 1,
          p.kind || "nft",
          p.kind === "legacy" ? `[${p.tickLower},${p.tickUpper}]` : `#${p.tokenId}`,
          `${fmtPrice(Number(p.priceLowerWad) / 1e18)} – ${fmtPrice(Number(p.priceUpperWad) / 1e18)}`,
          p.inRange ? "✓" : "·",
          fromWei(p.amount0, token0.decimals, 4),
          fromWei(p.amount1, token1.decimals, 4),
          fromWei(fees0, token0.decimals, 4),
          fromWei(fees1, token1.decimals, 4),
        ];
      })
    );
    console.log(`  Exiting recovers ≈ ${fromWei(exit0, token0.decimals, 4)} ${token0.symbol} + ${fromWei(exit1, token1.decimals, 4)} ${token1.symbol} (principal + fees)`);
  } else {
    console.log("  none — this run only mints the new ladder");
  }

  // ---- plan the new ladder ----
  const spacing = pool.tickSpacing;
  const layers = [];
  for (let i = 0; i < args.widths.length; i++) {
    const w = args.widths[i];
    const lowerPrice = center * (1 - w / 100);
    const upperPrice = center * (1 + w / 100);
    // snap outward so the requested band is fully contained
    let tickLower = clampTick(Math.floor(priceToTick(lowerPrice, token0.decimals, token1.decimals) / spacing) * spacing);
    let tickUpper = clampTick(Math.ceil(priceToTick(upperPrice, token0.decimals, token1.decimals) / spacing) * spacing);
    if (tickUpper <= tickLower) tickUpper = clampTick(tickLower + spacing);
    layers.push({
      n: i + 1,
      width: w,
      weight: args.weights[i],
      tickLower,
      tickUpper,
      amount0Desired: pctOf(budgets[0], args.weights[i]),
      amount1Desired: pctOf(budgets[1], args.weights[i]),
    });
  }

  // exact deposit preview per layer (server-side pool math)
  for (const l of layers) {
    const preview = await api
      .get("/poolv3/amounts-for-liquidity", {
        params: {
          poolAddress: args.pool,
          tickLower: l.tickLower,
          tickUpper: l.tickUpper,
          amount0Desired: l.amount0Desired.toString(),
          amount1Desired: l.amount1Desired.toString(),
        },
      })
      .then((r) => r.data, (e) => apiError(e, `preview L${l.n}`));
    l.amount0 = BigInt(preview.amount0);
    l.amount1 = BigInt(preview.amount1);
    l.liquidity = preview.liquidity;
  }

  let mint0 = 0n, mint1 = 0n;
  console.log(`\n--- New ladder (centered ${fmt(center, 6)} ${token1.symbol} per ${token0.symbol}) ---`);
  printTable(
    ["L", "±%", "wt%", "price range (snapped)", "ticks", token0.symbol, token1.symbol, `≈value ${token1.symbol}`],
    layers.map((l) => {
      mint0 += l.amount0;
      mint1 += l.amount1;
      const lo = tickToPrice(l.tickLower, token0.decimals, token1.decimals);
      const hi = tickToPrice(l.tickUpper, token0.decimals, token1.decimals);
      const value = Number(fromWei(l.amount0, token0.decimals)) * center + Number(fromWei(l.amount1, token1.decimals));
      return [
        `L${l.n}`,
        l.width,
        l.weight,
        `${fmtPrice(lo)} – ${fmtPrice(hi)}`,
        `[${l.tickLower}, ${l.tickUpper}]`,
        fromWei(l.amount0, token0.decimals, 4),
        fromWei(l.amount1, token1.decimals, 4),
        fmt(value),
      ];
    })
  );
  console.log(`  Total deposit: ${fromWei(mint0, token0.decimals, 4)} ${token0.symbol} + ${fromWei(mint1, token1.decimals, 4)} ${token1.symbol}`);
  const short0 = mint0 - (args.keepExisting ? 0n : exit0);
  const short1 = mint1 - (args.keepExisting ? 0n : exit1);
  if (short0 > 0n || short1 > 0n)
    console.log(
      `  Beyond what exiting recovers, the wallet must hold ≈ ` +
        `${short0 > 0n ? `${fromWei(short0, token0.decimals, 4)} ${token0.symbol}` : ""}${short0 > 0n && short1 > 0n ? " + " : ""}` +
        `${short1 > 0n ? `${fromWei(short1, token1.decimals, 4)} ${token1.symbol}` : ""}`
    );

  if (!args.execute) {
    console.log(`\nDry run — nothing submitted. Re-run with --execute to reposition.`);
    return;
  }

  // ---- execute: exit, then mint ----
  if (!args.keepExisting && live.length > 0) {
    console.log(`\n--- Exiting ${live.length} position(s) ---`);
    for (const [i, p] of live.entries()) {
      const label = p.kind === "legacy" ? `legacy [${p.tickLower},${p.tickUpper}]` : `NFT #${p.tokenId}`;
      const hasLiquidity = BigInt(p.liquidity) > 0n;
      try {
        if (hasLiquidity) {
          const body =
            p.kind === "legacy"
              ? { poolAddress: args.pool, tickLower: p.tickLower, tickUpper: p.tickUpper, liquidity: p.liquidity, collect: true }
              : { tokenId: p.tokenId, liquidity: p.liquidity, collect: true };
          await mutate("delete", "/poolv3/positions", body);
        } else {
          const body =
            p.kind === "legacy"
              ? { poolAddress: args.pool, tickLower: p.tickLower, tickUpper: p.tickUpper }
              : { tokenId: p.tokenId };
          await mutate("post", "/poolv3/positions/collect", body);
        }
        console.log(`  ✔ ${i + 1}/${live.length} ${label} ${hasLiquidity ? "burned + collected" : "collected"}`);
      } catch (err) {
        apiError(err, `exit ${label}`);
      }
    }
    console.log(`  (cleared position NFTs stay behind as empty tokens; future runs ignore them)`);
  }

  console.log(`\n--- Minting ${layers.length} layer(s) ---`);
  const slipPct = 100 - args.slippage;
  for (const l of layers) {
    try {
      await mutate("post", "/poolv3/positions", {
        poolAddress: args.pool,
        tickLower: l.tickLower,
        tickUpper: l.tickUpper,
        amount0Desired: l.amount0Desired.toString(),
        amount1Desired: l.amount1Desired.toString(),
        amount0Min: pctOf(l.amount0, slipPct).toString(),
        amount1Min: pctOf(l.amount1, slipPct).toString(),
      });
      console.log(`  ✔ L${l.n} [${l.tickLower}, ${l.tickUpper}] minted (${fromWei(l.amount0, token0.decimals, 4)} ${token0.symbol} + ${fromWei(l.amount1, token1.decimals, 4)} ${token1.symbol})`);
    } catch (err) {
      apiError(err, `mint L${l.n}`);
    }
  }

  // ---- final state ----
  const after = await api
    .get("/poolv3/positions", { params: { poolAddress: args.pool } })
    .then((r) => r.data, (e) => apiError(e, "fetch final positions"));
  const afterLive = after.filter((p) => BigInt(p.liquidity) > 0n);
  console.log(`\n--- Positions after repositioning (${afterLive.length}) ---`);
  printTable(
    ["kind", "id", "price range", "in", token0.symbol, token1.symbol],
    afterLive.map((p) => [
      p.kind || "nft",
      p.kind === "legacy" ? `[${p.tickLower},${p.tickUpper}]` : `#${p.tokenId}`,
      `${fmtPrice(Number(p.priceLowerWad) / 1e18)} – ${fmtPrice(Number(p.priceUpperWad) / 1e18)}`,
      p.inRange ? "✓" : "·",
      fromWei(p.amount0, token0.decimals, 4),
      fromWei(p.amount1, token1.decimals, 4),
    ])
  );
  console.log(`\n✔ Repositioning complete.`);
})().catch((err) => {
  console.error(`\n❌ ${err.message || err}`);
  process.exit(1);
});
