/**
 * Minimal Across bridge runner using the vault signing utility.
 *
 * Default flow:
 *  - discover Across-supported chains and token addresses
 *  - fetch a quote for USDC Sepolia -> Base Sepolia
 *  - optionally execute approval txs
 *  - send the Across bridge tx via the vault signer
 *  - poll Across deposit status until filled
 *  - compare destination token balance before/after
 *
 * Usage:
 *   node across-bridge.js
 *   node across-bridge.js --submit
 *   node across-bridge.js --amount 1 --submit
 *   node across-bridge.js --origin-chain-id 84532 --destination-chain-id 11155111 --submit
 *
 * Env:
 *   ACROSS_API_BASE   default: https://testnet.across.to/api
 *   ACROSS_API_KEY    optional bearer token for Across API
 *   ORIGIN_RPC        optional origin chain RPC override
 *   DESTINATION_RPC   optional destination chain RPC override
 *   VAULT_URL         optional vault URL override
 */

const { ethers } = require("ethers");
const {
  vaultGetAddress,
  signTransaction,
  submitSignedTransaction,
} = require("./send-tx");

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const DEFAULT_API_BASE = process.env.ACROSS_API_BASE || "https://testnet.across.to/api";
const DEFAULT_ORIGIN_CHAIN_ID = 11155111;
const DEFAULT_DESTINATION_CHAIN_ID = 84532;
const DEFAULT_SYMBOL = "USDC";
const DEFAULT_AMOUNT = "1";
const DEFAULT_POLL_INTERVAL_MS = 10000;
const DEFAULT_POLL_TIMEOUT_MS = 12 * 60 * 1000;
const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
const FALLBACK_CHAIN_CONFIG = {
  11155111: {
    chainId: 11155111,
    name: "Sepolia",
    publicRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
  },
  84532: {
    chainId: 84532,
    name: "Base Sepolia",
    publicRpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
  },
};

function getArgValue(args, flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx < 0) return fallback;
  return args[idx + 1];
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function normalizeAddress(value, label) {
  try {
    return ethers.getAddress(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeAcrossHeaders() {
  const headers = { Accept: "application/json" };
  if (process.env.ACROSS_API_KEY) {
    headers.Authorization = `Bearer ${process.env.ACROSS_API_KEY}`;
  }
  return headers;
}

async function acrossGet(path, params = {}) {
  const url = new URL(`${DEFAULT_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { headers: makeAcrossHeaders() });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Across ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function getAcrossChains() {
  return acrossGet("/swap/chains");
}

async function getAcrossTokens(chainId) {
  return acrossGet("/swap/tokens", { chainId });
}

function findChain(chains, chainId) {
  const chain = chains.find((item) => Number(item.chainId) === Number(chainId));
  return chain || FALLBACK_CHAIN_CONFIG[Number(chainId)] || null;
}

function findToken(tokens, symbol) {
  const upper = String(symbol).toUpperCase();
  const token = tokens.find((item) => String(item.symbol).toUpperCase() === upper);
  if (!token) {
    throw new Error(`Across did not return token symbol ${symbol}`);
  }
  return token;
}

function resolveToken({ tokens, symbol, explicitAddress, label }) {
  if (explicitAddress) {
    const normalized = normalizeAddress(explicitAddress, label);
    const match = tokens.find(
      (item) => String(item.address).toLowerCase() === normalized.toLowerCase()
    );
    if (match) return match;
    if (normalized.toLowerCase() === NATIVE_TOKEN) {
      return {
        chainId: tokens[0]?.chainId,
        address: NATIVE_TOKEN,
        decimals: 18,
        symbol: "ETH",
        name: "Ether",
      };
    }
    throw new Error(`Across did not return ${label} address ${normalized}`);
  }
  return findToken(tokens, symbol);
}

async function getQuote({
  originChainId,
  destinationChainId,
  inputToken,
  outputToken,
  amount,
  depositor,
  recipient,
}) {
  return acrossGet("/swap/approval", {
    tradeType: "exactInput",
    originChainId,
    destinationChainId,
    inputToken,
    outputToken,
    amount,
    depositor,
    recipient,
  });
}

function getRpcUrl(chain, envOverrideName) {
  const override = process.env[envOverrideName];
  if (override) return override;
  if (chain.publicRpcUrl) return chain.publicRpcUrl;
  throw new Error(`Missing ${envOverrideName} and Across did not return a public RPC URL`);
}

function formatTokenAmount(amount, decimals) {
  return ethers.formatUnits(BigInt(amount), Number(decimals));
}

async function readTokenBalance(provider, tokenAddress, owner) {
  if (String(tokenAddress).toLowerCase() === NATIVE_TOKEN) {
    return provider.getBalance(owner);
  }
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return contract.balanceOf(owner);
}

async function readAllowance(provider, tokenAddress, owner, spender) {
  if (String(tokenAddress).toLowerCase() === NATIVE_TOKEN) {
    return (2n ** 256n) - 1n;
  }
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return contract.allowance(owner, spender);
}

function txRequestFromAcrossTx(tx) {
  const rawGas = tx.gasLimit || tx.gas;
  return {
    to: normalizeAddress(tx.to, "transaction target"),
    data: tx.data || "0x",
    value: tx.value || "0",
    gasLimit: rawGas && rawGas !== "0" ? rawGas : undefined,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  };
}

async function signAndMaybeSubmitTx({ label, provider, fromAddress, tx, submit }) {
  const txRequest = txRequestFromAcrossTx(tx);
  if (!txRequest.gasLimit) {
    const estimatedGas = await provider.estimateGas({
      from: fromAddress,
      to: txRequest.to,
      data: txRequest.data,
      value: BigInt(txRequest.value || "0"),
    });
    txRequest.gasLimit = (estimatedGas * 12n) / 10n;
  }

  console.log(`\n=== ${label}: entry ===`);
  console.log(`target=${tx.to} valueWei=${tx.value || "0"} gas=${txRequest.gasLimit}`);

  const signedTx = await signTransaction(provider, fromAddress, txRequest);

  console.log(`=== ${label}: signed ===`);
  console.log(`hash=${signedTx.hash}`);

  if (!submit) {
    console.log(`=== ${label}: exit dry-run ===`);
    return { hash: signedTx.hash, signedTx, receipt: null };
  }

  const { response, receipt } = await submitSignedTransaction(provider, signedTx);

  console.log(`=== ${label}: exit submitted ===`);
  console.log(`txHash=${response.hash} block=${receipt.blockNumber} status=${receipt.status}`);

  return { hash: response.hash, signedTx, receipt };
}

async function pollDepositStatus({ originChainId, depositTxnRef }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEFAULT_POLL_TIMEOUT_MS) {
    let status;
    try {
      status = await acrossGet("/deposit/status", { originChainId, depositTxnRef });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("DepositNotFoundException")) {
        console.log("\n=== deposit-status poll ===");
        console.log(
          `status=indexing originChainId=${originChainId} depositTxnRef=${depositTxnRef} fillTxnRef=pending`
        );
        await sleep(DEFAULT_POLL_INTERVAL_MS);
        continue;
      }
      throw error;
    }

    console.log("\n=== deposit-status poll ===");
    console.log(
      `status=${status.status} originChainId=${status.originChainId} destinationChainId=${status.destinationChainId} fillTxnRef=${status.fillTxnRef || "pending"}`
    );

    if (status.status === "filled") return status;
    if (status.status === "expired" || status.status === "refunded") {
      throw new Error(`Across deposit ended in terminal state: ${status.status}`);
    }

    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Across deposit to fill");
}

async function waitForAllowance({
  provider,
  tokenAddress,
  owner,
  spender,
  minimum,
}) {
  if (String(tokenAddress).toLowerCase() === NATIVE_TOKEN) return;

  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const allowance = await readAllowance(provider, tokenAddress, owner, spender);
    console.log(`allowanceCheckCurrent=${allowance.toString()} allowanceCheckExpected=${minimum}`);
    if (allowance >= BigInt(minimum)) return;
    await sleep(2000);
  }

  throw new Error(`Allowance did not reach ${minimum} in time for ${spender}`);
}

async function main() {
  const args = process.argv.slice(2);
  const submit = hasFlag(args, "--submit");
  const originChainId = Number(getArgValue(args, "--origin-chain-id", DEFAULT_ORIGIN_CHAIN_ID));
  const destinationChainId = Number(
    getArgValue(args, "--destination-chain-id", DEFAULT_DESTINATION_CHAIN_ID)
  );
  const symbol = getArgValue(args, "--symbol", DEFAULT_SYMBOL);
  const amountHuman = getArgValue(args, "--amount", DEFAULT_AMOUNT);
  const requestedRecipient = getArgValue(args, "--recipient");
  const inputTokenAddressArg = getArgValue(args, "--input-token");
  const outputTokenAddressArg = getArgValue(args, "--output-token");

  console.log("Across Minimal Bridge Runner");
  console.log("============================");
  console.log(`apiBase=${DEFAULT_API_BASE}`);
  console.log(`submit=${submit}`);
  console.log(`originChainId=${originChainId}`);
  console.log(`destinationChainId=${destinationChainId}`);
  console.log(`symbol=${symbol}`);
  console.log(`amount=${amountHuman}`);

  console.log("\n=== discover-vault-address: entry ===");
  const { address: depositor } = await vaultGetAddress();
  const recipient = requestedRecipient ? normalizeAddress(requestedRecipient, "recipient") : depositor;
  console.log(`depositor=${depositor}`);
  console.log(`recipient=${recipient}`);
  console.log("=== discover-vault-address: exit ===");

  console.log("\n=== across-discovery: entry ===");
  const chains = await getAcrossChains();
  const [originTokens, destinationTokens] = await Promise.all([
    getAcrossTokens(originChainId),
    getAcrossTokens(destinationChainId),
  ]);
  const originChain = findChain(chains, originChainId);
  const destinationChain = findChain(chains, destinationChainId);
  if (!originChain) {
    throw new Error(`No RPC metadata found for origin chain ${originChainId}`);
  }
  if (!destinationChain) {
    throw new Error(`No RPC metadata found for destination chain ${destinationChainId}`);
  }
  const inputToken = resolveToken({
    tokens: originTokens,
    symbol,
    explicitAddress: inputTokenAddressArg,
    label: "input token",
  });
  const outputToken = resolveToken({
    tokens: destinationTokens,
    symbol,
    explicitAddress: outputTokenAddressArg,
    label: "output token",
  });
  const amount = ethers.parseUnits(amountHuman, Number(inputToken.decimals)).toString();
  console.log(
    `origin=${originChain.name} rpc=${getRpcUrl(originChain, "ORIGIN_RPC")} token=${inputToken.address}`
  );
  console.log(
    `destination=${destinationChain.name} rpc=${getRpcUrl(destinationChain, "DESTINATION_RPC")} token=${outputToken.address}`
  );
  console.log(`amountBaseUnits=${amount}`);
  console.log("=== across-discovery: exit ===");

  const originProvider = new ethers.JsonRpcProvider(getRpcUrl(originChain, "ORIGIN_RPC"));
  const destinationProvider = new ethers.JsonRpcProvider(
    getRpcUrl(destinationChain, "DESTINATION_RPC")
  );

  console.log("\n=== preflight-balances: entry ===");
  const [originNativeBalance, destinationNativeBalance, originTokenBalanceBefore, destinationTokenBalanceBefore] =
    await Promise.all([
      originProvider.getBalance(depositor),
      destinationProvider.getBalance(recipient),
      readTokenBalance(originProvider, inputToken.address, depositor),
      readTokenBalance(destinationProvider, outputToken.address, recipient),
    ]);
  console.log(`originNativeEth=${ethers.formatEther(originNativeBalance)}`);
  console.log(`destinationNativeEth=${ethers.formatEther(destinationNativeBalance)}`);
  console.log(
    `origin${symbol}Before=${formatTokenAmount(originTokenBalanceBefore, inputToken.decimals)}`
  );
  console.log(
    `destination${symbol}Before=${formatTokenAmount(destinationTokenBalanceBefore, outputToken.decimals)}`
  );
  console.log("=== preflight-balances: exit ===");

  console.log("\n=== across-quote: entry ===");
  let quote = await getQuote({
    originChainId,
    destinationChainId,
    inputToken: inputToken.address,
    outputToken: outputToken.address,
    amount,
    depositor,
    recipient,
  });
  console.log(`quoteId=${quote.id}`);
  console.log(`expectedFillTime=${quote.expectedFillTime}`);
  console.log(`expectedOutputAmount=${quote.expectedOutputAmount}`);
  console.log(`minOutputAmount=${quote.minOutputAmount}`);
  console.log(
    `allowanceActual=${quote.checks?.allowance?.actual || "n/a"} allowanceExpected=${quote.checks?.allowance?.expected || "n/a"}`
  );
  console.log(
    `balanceActual=${quote.checks?.balance?.actual || "n/a"} balanceExpected=${quote.checks?.balance?.expected || "n/a"}`
  );
  console.log(`approvalTxCount=${quote.approvalTxns?.length || 0}`);
  console.log(`swapTarget=${quote.swapTx?.to || "missing"}`);
  console.log("=== across-quote: exit ===");

  if (!quote.swapTx) {
    throw new Error("Across quote did not include swapTx");
  }

  if (originNativeBalance === 0n && submit) {
    throw new Error(`Vault address ${depositor} has 0 native balance on origin chain ${originChainId}`);
  }

  if (originTokenBalanceBefore < BigInt(amount)) {
    throw new Error(
      `Insufficient ${symbol} balance. Need ${amountHuman}, have ${formatTokenAmount(
        originTokenBalanceBefore,
        inputToken.decimals
      )}`
    );
  }

  const allowanceSpender =
    quote.checks?.allowance?.spender || quote.approvalTxns?.[0]?.to || quote.swapTx.to;
  if (allowanceSpender) {
    const allowance = await readAllowance(originProvider, inputToken.address, depositor, allowanceSpender);
    console.log("\n=== allowance-check ===");
    console.log(`spender=${allowanceSpender}`);
    console.log(`allowance=${allowance.toString()}`);
  }

  for (let i = 0; i < (quote.approvalTxns || []).length; i += 1) {
    await signAndMaybeSubmitTx({
      label: `approval-${i + 1}`,
      provider: originProvider,
      fromAddress: depositor,
      tx: quote.approvalTxns[i],
      submit,
    });
  }

  if ((quote.approvalTxns || []).length > 0) {
    await waitForAllowance({
      provider: originProvider,
      tokenAddress: inputToken.address,
      owner: depositor,
      spender: allowanceSpender,
      minimum: quote.checks?.allowance?.expected || amount,
    });

    quote = await getQuote({
      originChainId,
      destinationChainId,
      inputToken: inputToken.address,
      outputToken: outputToken.address,
      amount,
      depositor,
      recipient,
    });
  }

  const bridgeResult = await signAndMaybeSubmitTx({
    label: "across-swap",
    provider: originProvider,
    fromAddress: depositor,
    tx: quote.swapTx,
    submit,
  });

  if (!submit) {
    console.log("\nDry-run complete. Re-run with --submit to broadcast approvals and bridge tx.");
    return;
  }

  const status = await pollDepositStatus({
    originChainId,
    depositTxnRef: bridgeResult.hash,
  });

  console.log("\n=== post-bridge-balances: entry ===");
  const [originTokenBalanceAfter, destinationTokenBalanceAfter] = await Promise.all([
    readTokenBalance(originProvider, inputToken.address, depositor),
    readTokenBalance(destinationProvider, outputToken.address, recipient),
  ]);
  const originDelta = originTokenBalanceAfter - originTokenBalanceBefore;
  const destinationDelta = destinationTokenBalanceAfter - destinationTokenBalanceBefore;
  console.log(`origin${symbol}After=${formatTokenAmount(originTokenBalanceAfter, inputToken.decimals)}`);
  console.log(
    `destination${symbol}After=${formatTokenAmount(destinationTokenBalanceAfter, outputToken.decimals)}`
  );
  console.log(`originDelta=${formatTokenAmount(originDelta, inputToken.decimals)}`);
  console.log(`destinationDelta=${formatTokenAmount(destinationDelta, outputToken.decimals)}`);
  console.log(`fillTxnRef=${status.fillTxnRef}`);
  console.log("=== post-bridge-balances: exit ===");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
