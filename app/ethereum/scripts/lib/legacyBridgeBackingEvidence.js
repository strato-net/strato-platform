const fs = require("node:fs/promises");
const path = require("node:path");
const { ethers } = require("ethers");
const { getReadToken, readRows } = require("../prepareBridgeRollout");
const { LEGACY_STATUS } = require("./legacyBridgeBacking");

const ZERO = ethers.ZeroAddress.toLowerCase();
const depositInterface = new ethers.Interface([
  "event DepositRouted(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId)",
  "event DepositRoutedWithAction(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId,uint8 action,address actionToken,uint256 minFinalOut)",
]);
const transferInterface = new ethers.Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const erc20Interface = new ethers.Interface(["function balanceOf(address account) view returns (uint256)"]);

const bare = value => String(value).toLowerCase().replace(/^0x/, "");
const normalizeAddress = (value, field) => {
  if (String(value) === "0") return ZERO;
  try { return ethers.getAddress(String(value)).toLowerCase(); }
  catch { throw new Error(`${field} is not a valid address`); }
};
const uint = (value, field) => {
  const result = String(value);
  if (!/^\d+$/.test(result)) throw new Error(`${field} must be an unsigned decimal string`);
  return result;
};
const safeNumber = (value, field) => {
  const result = uint(value, field);
  if (BigInt(result) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${field} exceeds the safe integer range`);
  return Number(result);
};
const has = (value, field) => value && typeof value === "object"
  && Object.prototype.hasOwnProperty.call(value, field);
const canonicalDepositKey = value => {
  const [hash, depositId] = String(value).split("#");
  const normalized = hash.replace(/^0x/i, "").toLowerCase();
  return depositId === undefined ? `0x${normalized}` : `0x${normalized}#${BigInt(depositId)}`;
};
const statusOf = row => String(row.value.bridgeStatus);
const parseOrigin = (bridge, origin) => {
  let value = origin;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  if (bare(value.bridge) !== bare(bridge)) return null;
  return typeof value.withdrawalId === "string" && value.withdrawalId ? value.withdrawalId : null;
};

const checkedUrl = (value, field) => {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${field} must be a valid HTTPS URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must use HTTPS without credentials, query or fragment`);
  }
  return url.toString().replace(/\/$/, "");
};

async function json(response, description) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${description} failed with HTTP ${response.status}`);
  try { return JSON.parse(text); } catch { throw new Error(`${description} returned invalid JSON`); }
}

async function readOptionalJson(filePath) {
  try {
    const data = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("expected a JSON object");
    return { data, present: true };
  } catch (error) {
    if (error.code === "ENOENT") return { data: {}, present: false };
    throw new Error(`${filePath} is not readable JSON: ${error.message}`);
  }
}

async function safeGet(baseUrl, endpoint, apiKey, fetchImpl) {
  const headers = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return json(await fetchImpl(`${baseUrl}${endpoint}`, { headers }), "Safe Transaction Service request");
}

function transferAmount(receipt, token, recipient, senders) {
  let amount = 0n;
  for (const log of receipt.logs || []) {
    if (String(log.address).toLowerCase() !== token) continue;
    try {
      const parsed = transferInterface.parseLog(log);
      if (!parsed || String(parsed.args.to).toLowerCase() !== recipient) continue;
      if (senders?.size && !senders.has(String(parsed.args.from).toLowerCase())) continue;
      amount += BigInt(parsed.args.value);
    } catch {}
  }
  return amount;
}

function depositEvent(receipt, row, approvedRouters) {
  const expectedId = row.key.includes("#") ? row.key.split("#")[1] : undefined;
  const matches = [];
  for (const log of receipt.logs || []) {
    try {
      const parsed = depositInterface.parseLog(log);
      if (!parsed) continue;
      const router = String(log.address).toLowerCase();
      const depositId = BigInt(parsed.args.depositId).toString();
      if (!approvedRouters.has(router)) continue;
      if (expectedId !== undefined && depositId !== BigInt(expectedId).toString()) continue;
      if (String(parsed.args.token).toLowerCase() !== String(row.value.externalToken).toLowerCase()) continue;
      if (String(parsed.args.stratoAddress).toLowerCase() !== String(row.value.stratoRecipient).toLowerCase()) continue;
      if (String(parsed.args.targetStratoToken).toLowerCase() !== String(row.value.stratoToken).toLowerCase()) continue;
      matches.push({ amount: BigInt(parsed.args.amount), router, depositId });
    } catch {}
  }
  if (matches.length !== 1) throw new Error(`expected one approved deposit event, found ${matches.length}`);
  return matches[0];
}

function successfulNativeCalls(traces) {
  const rows = Array.isArray(traces) ? traces : [];
  const failed = new Set(rows.filter(trace => trace?.error)
    .map(trace => JSON.stringify(trace.traceAddress || [])));
  return rows.map((trace, index) => ({ trace, index })).filter(({ trace }) => {
    const traceAddress = Array.isArray(trace?.traceAddress) ? trace.traceAddress : [];
    const reverted = traceAddress.some((_, index) =>
      failed.has(JSON.stringify(traceAddress.slice(0, index + 1))));
    const callType = String(trace?.action?.callType || "call").toLowerCase();
    return trace?.type === "call" && callType === "call" && !trace?.error && !reverted;
  });
}

async function nativeMovement(provider, txHash, recipients, senders) {
  const traces = await provider.send("trace_transaction", [txHash]);
  const approved = new Set(recipients);
  const approvedSenders = senders && new Set(senders);
  return successfulNativeCalls(traces).reduce((sum, { trace }) =>
    approved.has(String(trace.action.to || "").toLowerCase())
      && (!approvedSenders || approvedSenders.has(String(trace.action.from || "").toLowerCase()))
      ? sum + BigInt(trace.action.value || "0x0") : sum, 0n);
}

async function tokenBalance(provider, token, account, block) {
  if (token === ZERO) return provider.getBalance(account, Number(block));
  const result = await provider.send("eth_call", [{
    to: token,
    data: erc20Interface.encodeFunctionData("balanceOf", [account]),
  }, `0x${BigInt(block).toString(16)}`]);
  return BigInt(erc20Interface.decodeFunctionResult("balanceOf", result)[0]);
}

async function collectDepositFlows(rows, chains, input, providers, violations) {
  const flows = [];
  const receipts = new Map();
  const traces = new Map();
  const consumedMovements = new Map();
  for (const row of rows.filter(item => statusOf(item) === LEGACY_STATUS.COMPLETED)) {
    const chain = chains.get(row.chainId);
    const provider = providers.get(row.chainId);
    if (!chain || !provider) continue;
    const txHash = canonicalDepositKey(row.key).split("#")[0];
    try {
      const receiptKey = `${row.chainId}:${txHash}`;
      if (!receipts.has(receiptKey)) receipts.set(receiptKey, await provider.getTransactionReceipt(txHash));
      const receipt = receipts.get(receiptKey);
      if (!receipt || Number(receipt.status) !== 1) throw new Error("external receipt is missing or unsuccessful");
      if (BigInt(receipt.blockNumber) > BigInt(input.chains[row.chainId].cutoffBlock)) {
        throw new Error(`receipt block ${receipt.blockNumber} is after cutoff`);
      }
      const approvedRouters = new Set([
        chain.depositRouter, ...(input.chains[row.chainId].approvedDepositRouters || []),
      ].map(item => normalizeAddress(item, "approved deposit router")));
      const event = depositEvent(receipt, row, approvedRouters);
      const token = normalizeAddress(row.value.externalToken, `deposit ${row.key} token`);
      const movementKey = `${receiptKey}:${token}`;
      let movements;
      if (token === ZERO) {
        if (!traces.has(receiptKey)) traces.set(receiptKey, await provider.send("trace_transaction", [txHash]));
        movements = successfulNativeCalls(traces.get(receiptKey))
          .filter(({ trace }) => chain.custodyAddresses.includes(String(trace?.action?.to || "").toLowerCase()))
          .map(({ trace, index }) => ({ index, amount: BigInt(trace.action.value || "0x0") }));
      } else {
        movements = (receipt.logs || []).map((log, index) => ({ log, index })).flatMap(({ log, index }) => {
          if (String(log.address).toLowerCase() !== token) return [];
          try {
            const parsed = transferInterface.parseLog(log);
            if (!parsed || !chain.custodyAddresses.includes(String(parsed.args.to).toLowerCase())) return [];
            return [{ index, amount: BigInt(parsed.args.value) }];
          } catch { return []; }
        });
      }
      const consumed = consumedMovements.get(movementKey) || new Set();
      const movement = movements.find(item => !consumed.has(item.index) && item.amount === event.amount);
      if (!movement) throw new Error(`no unconsumed custody movement exactly matches routed amount ${event.amount}`);
      consumed.add(movement.index);
      consumedMovements.set(movementKey, consumed);
      flows.push({
        id: row.key, chainId: row.chainId, externalToken: token, amount: event.amount.toString(),
        evidence: { txHash, blockNumber: String(receipt.blockNumber), router: event.router, depositId: event.depositId },
      });
    } catch (error) {
      violations.push({
        code: "DEPOSIT_EVIDENCE_INCOMPLETE", severity: "failed", chainId: row.chainId,
        externalToken: String(row.value.externalToken), detail: `Completed deposit ${row.key}: ${error.message}`,
      });
    }
  }
  return flows;
}

async function collectWithdrawalFlows(rows, chains, input, providers, fetchImpl, apiKey, violations) {
  const flows = [];
  const consumedSafeTxHashes = new Set();
  const consumedExecutionTxHashes = new Set();
  for (const row of rows.filter(item => statusOf(item) === LEGACY_STATUS.COMPLETED)) {
    const chainId = String(row.value.externalChainId);
    const chain = chains.get(chainId);
    const provider = providers.get(chainId);
    if (!chain || !provider) continue;
    const safeTxHash = String(row.value.custodyTxHash || "");
    try {
      if (!/^0x[0-9a-f]{64}$/i.test(safeTxHash)) throw new Error("missing Safe transaction hash");
      const safeTx = await safeGet(input.chains[chainId].safeTransactionServiceUrl,
        `/api/v1/multisig-transactions/${safeTxHash}/`, apiKey, fetchImpl);
      if (safeTx.isExecuted !== true || safeTx.isSuccessful !== true ||
          !/^0x[0-9a-f]{64}$/i.test(String(safeTx.transactionHash || ""))) {
        throw new Error("Safe transaction is not successfully executed");
      }
      const normalizedSafeTxHash = safeTxHash.toLowerCase();
      const normalizedExecutionHash = String(safeTx.transactionHash).toLowerCase();
      if (consumedSafeTxHashes.has(normalizedSafeTxHash)
        || consumedExecutionTxHashes.has(normalizedExecutionHash)) {
        const error = new Error("Safe or external execution transaction is already attributed to another withdrawal");
        error.code = "DUPLICATE_WITHDRAWAL_PAYOUT";
        throw error;
      }
      const receipt = await provider.getTransactionReceipt(safeTx.transactionHash);
      if (!receipt || Number(receipt.status) !== 1) throw new Error("external execution receipt is missing or unsuccessful");
      if (BigInt(receipt.blockNumber) > BigInt(input.chains[chainId].cutoffBlock)) {
        throw new Error(`receipt block ${receipt.blockNumber} is after cutoff`);
      }
      const token = normalizeAddress(row.value.externalToken, `withdrawal ${row.id} token`);
      const senders = new Set(row.value.useHotWallet ? chain.hotWalletAddresses : chain.custodyAddresses);
      const recipient = normalizeAddress(row.value.externalRecipient, `withdrawal ${row.id} recipient`);
      const paid = token === ZERO
        ? await nativeMovement(provider, safeTx.transactionHash, [recipient], [...senders])
        : transferAmount(receipt, token, recipient, senders);
      if (paid <= 0n) throw new Error("no matching recipient payout found");
      consumedSafeTxHashes.add(normalizedSafeTxHash);
      consumedExecutionTxHashes.add(normalizedExecutionHash);
      let expected;
      try {
        expected = BigInt(uint(row.value.externalTokenAmount,
          `withdrawal ${row.id} externalTokenAmount`));
        if (expected <= 0n) throw new Error(`withdrawal ${row.id} externalTokenAmount must be greater than zero`);
      } catch (error) {
        violations.push({
          code: "WITHDRAWAL_EXPECTED_AMOUNT_INVALID", severity: "failed", chainId,
          externalToken: token, detail: `Completed withdrawal ${row.id}: ${error.message}`,
        });
      }
      flows.push({
        id: row.id, chainId, externalToken: token, amount: paid.toString(),
        observedAmount: paid.toString(), expectedAmount: expected?.toString() ?? null,
        evidence: {
          safeTxHash, transactionHash: safeTx.transactionHash,
          blockNumber: String(receipt.blockNumber), approvedSenders: [...senders],
        },
      });
      if (expected !== undefined && paid !== expected) violations.push({
        code: "WITHDRAWAL_PAYOUT_AMOUNT_MISMATCH", severity: "failed", chainId,
        externalToken: token,
        detail: `Completed withdrawal ${row.id}: expected payout ${expected}, observed ${paid}`,
        evidence: { withdrawalId: row.id, expectedAmount: expected.toString(), observedAmount: paid.toString() },
      });
    } catch (error) {
      violations.push({
        code: error.code || "WITHDRAWAL_EVIDENCE_INCOMPLETE", severity: "failed", chainId,
        externalToken: String(row.value.externalToken), detail: `Completed withdrawal ${row.id}: ${error.message}`,
      });
    }
  }
  return flows;
}

async function inspectSafeHistory(chain, bridge, chainInput, withdrawalStatuses, apiKey, fetchImpl, violations) {
  try {
    const pendingByWithdrawal = new Map();
    const executedByWithdrawal = new Map();
    for (const safe of new Set([...chain.custodyAddresses, ...chain.hotWalletAddresses])) {
      const info = await safeGet(chainInput.safeTransactionServiceUrl, `/api/v1/safes/${safe}/`, apiKey, fetchImpl);
      const safeNonce = safeNumber(info?.nonce, `Safe ${safe} nonce`);
      for (let offset = 0; ; offset += 100) {
        const page = await safeGet(chainInput.safeTransactionServiceUrl,
          `/api/v1/safes/${safe}/multisig-transactions/?limit=100&offset=${offset}`,
          apiKey, fetchImpl);
        if (!Array.isArray(page?.results) || !has(page, "next") ||
            (page.next !== null && typeof page.next !== "string")) {
          throw new Error(`Safe ${safe} transaction history response is incomplete`);
        }
        for (const tx of page.results) {
          if (!/^0x[0-9a-f]{64}$/i.test(String(tx?.safeTxHash || "")) ||
              !has(tx, "origin") || typeof tx.isExecuted !== "boolean" ||
              !has(tx, "isSuccessful") ||
              (tx.isSuccessful !== null && typeof tx.isSuccessful !== "boolean") ||
              (tx.isExecuted && typeof tx.isSuccessful !== "boolean")) {
            throw new Error(`Safe ${safe} transaction history entry is incomplete`);
          }
          const nonce = safeNumber(tx.nonce, `Safe transaction ${tx.safeTxHash} nonce`);
          const withdrawalId = parseOrigin(bridge, tx.origin);
          if (!withdrawalId) continue;
          if (tx.isExecuted && tx.isSuccessful === true) {
            const hashes = executedByWithdrawal.get(withdrawalId) || [];
            hashes.push(tx.safeTxHash);
            executedByWithdrawal.set(withdrawalId, hashes);
          } else if (!tx.isExecuted && nonce >= safeNonce) {
            const hashes = pendingByWithdrawal.get(withdrawalId) || [];
            hashes.push(tx.safeTxHash);
            pendingByWithdrawal.set(withdrawalId, hashes);
          }
        }
        if (page.next === null) break;
        if (!page.results.length) throw new Error(`Safe ${safe} transaction history pagination did not advance`);
      }
    }
    for (const [withdrawalId, hashes] of pendingByWithdrawal) violations.push({
      code: hashes.length > 1 ? "DUPLICATE_PENDING_SAFE_PAYOUTS" : "PENDING_SAFE_PAYOUT",
      severity: "failed", chainId: chain.chainId,
      detail: `Withdrawal ${withdrawalId} has ${hashes.length} executable Safe proposal(s)`,
      evidence: { withdrawalId, safeTxHashes: hashes },
    });
    for (const [withdrawalId, hashes] of executedByWithdrawal) {
      if (hashes.length > 1) violations.push({
        code: "DUPLICATE_EXECUTED_SAFE_PAYOUTS", severity: "failed", chainId: chain.chainId,
        detail: `Withdrawal ${withdrawalId} has ${hashes.length} successful Safe transactions`,
        evidence: { withdrawalId, safeTxHashes: hashes },
      });
      const status = withdrawalStatuses.get(withdrawalId);
      if (status !== LEGACY_STATUS.COMPLETED) violations.push({
        code: "SAFE_EXECUTION_FOR_NONCOMPLETED_WITHDRAWAL", severity: "failed", chainId: chain.chainId,
        detail: `Withdrawal ${withdrawalId} has a successful Safe transaction but legacy status ${status || "missing"}`,
        evidence: { withdrawalId, safeTxHashes: hashes },
      });
    }
  } catch (error) {
    violations.push({
      code: "SAFE_QUEUE_UNAVAILABLE", severity: "failed", chainId: chain.chainId,
      detail: `Could not inspect pending Safe proposals: ${error.message}`,
    });
  }
}

async function collectBackingEvidence(input, env = process.env, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  if (input.version !== 1) throw new Error("Reconciliation input version must be 1");
  const nodeUrl = checkedUrl(input.stratoNodeUrl, "stratoNodeUrl");
  const bridge = normalizeAddress(input.mercataBridge, "mercataBridge");
  uint(input.stratoCutoffBlock, "stratoCutoffBlock");
  const token = env.ACCESS_TOKEN || await getReadToken(env, deps.authenticate);
  const source = { nodeUrl };
  const addressFilter = `eq.${bare(bridge)}`;
  const request = async endpoint => json(await fetchImpl(`${nodeUrl}${endpoint}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  }), endpoint);
  const [metadata, latestBlocks, chainRows, assetRows, depositRows, withdrawalRows, bridgeRows] = await Promise.all([
    request("/strato-api/eth/v1.2/metadata"),
    request("/strato-api/eth/v1.2/block/last/1"),
    readRows(source, "BlockApps-MercataBridge-chains", { address: addressFilter, select: "key,value,block_number", order: "key.asc" }, token, fetchImpl),
    readRows(source, "BlockApps-MercataBridge-assets", { address: addressFilter, select: "key,key2,value,block_number", order: "key2.asc,key.asc" }, token, fetchImpl),
    readRows(source, "BlockApps-MercataBridge-deposits", { address: addressFilter, select: "key,key2,value,block_number", order: "key.asc,key2.asc" }, token, fetchImpl),
    readRows(source, "BlockApps-MercataBridge-withdrawals", { address: addressFilter, select: "key,value,block_number", order: "key.asc" }, token, fetchImpl),
    readRows(source, "BlockApps-MercataBridge", { address: addressFilter, select: "depositsPaused,withdrawalsPaused,withdrawalCounter,block_number" }, token, fetchImpl),
  ]);
  const stratoNetworkId = uint(metadata.networkID, "STRATO network ID");
  const stratoObservedBlock = uint(latestBlocks?.[0]?.blockData?.number, "STRATO observed block");
  if (BigInt(stratoObservedBlock) < BigInt(input.stratoCutoffBlock)) throw new Error("STRATO node is behind the reviewed cutoff");
  for (const [name, rows] of Object.entries({
    chains: chainRows, assets: assetRows, deposits: depositRows,
    withdrawals: withdrawalRows, bridge: bridgeRows,
  })) {
    for (const row of rows) {
      const block = uint(row.block_number, `${name} row block_number`);
      if (BigInt(block) > BigInt(input.stratoCutoffBlock)) {
        throw new Error(`${name} state changed at STRATO block ${block}, after reviewed cutoff ${input.stratoCutoffBlock}`);
      }
    }
  }

  const chains = chainRows.map(({ key, value }) => {
    const chainId = uint(key, "external chain ID");
    const chainInput = input.chains[chainId];
    const custody = normalizeAddress(value.custody, `chain ${chainId} custody`);
    const hotWallet = value.hotWallet && bare(value.hotWallet) !== "0".repeat(40)
      ? normalizeAddress(value.hotWallet, `chain ${chainId} hot wallet`) : ZERO;
    return {
      chainId, custody, hotWallet,
      custodyAddresses: [...new Set([custody, ...(chainInput?.additionalCustodyAddresses || [])
        .map(item => normalizeAddress(item, `chain ${chainId} additional custody`))])],
      hotWalletAddresses: [...new Set([...(hotWallet === ZERO ? [] : [hotWallet]),
        ...(chainInput?.additionalHotWalletAddresses || [])
          .map(item => normalizeAddress(item, `chain ${chainId} additional hot wallet`))])],
      depositRouter: normalizeAddress(value.depositRouter, `chain ${chainId} deposit router`),
      lastProcessedBlock: uint(value.lastProcessedBlock, `chain ${chainId} lastProcessedBlock`),
      enabled: value.enabled === true || value.enabled === "true",
    };
  });
  const configured = new Set(Object.keys(input.chains || {}));
  const discovered = new Set(chains.map(item => item.chainId));
  const missing = [...discovered].filter(chainId => !configured.has(chainId));
  const extra = [...configured].filter(chainId => !discovered.has(chainId));
  if (missing.length || extra.length) {
    throw new Error(`Input chains must exactly match MercataBridge chains; missing=[${missing}] extra=[${extra}]`);
  }

  const violations = [];
  const withdrawalStatuses = new Map(withdrawalRows.map(row =>
    [String(row.key), String(row.value.bridgeStatus)]));
  if (bridgeRows.length !== 1 || bridgeRows[0].depositsPaused !== true ||
      bridgeRows[0].withdrawalsPaused !== true) violations.push({
    code: "LEGACY_BRIDGE_NOT_PAUSED", severity: "failed",
    detail: "MercataBridge deposits and withdrawals must both be paused before reconciliation",
  });
  const providers = new Map();
  for (const chain of chains) {
    const chainInput = input.chains[chain.chainId];
    safeNumber(chainInput.cutoffBlock, `chain ${chain.chainId} cutoffBlock`);
    if (!Number.isSafeInteger(chainInput.confirmations) || chainInput.confirmations < 0) {
      throw new Error(`chain ${chain.chainId} confirmations must be a non-negative integer`);
    }
    chainInput.safeTransactionServiceUrl = checkedUrl(chainInput.safeTransactionServiceUrl,
      `chain ${chain.chainId} safeTransactionServiceUrl`);
    const rpcName = `CHAIN_${chain.chainId}_RPC_URL`;
    const rpcUrl = checkedUrl(env[rpcName], rpcName);
    const provider = deps.providerFor
      ? deps.providerFor(chain.chainId, rpcUrl)
      : new ethers.JsonRpcProvider(rpcUrl, Number(chain.chainId), { staticNetwork: true });
    let rpcChainId;
    try { rpcChainId = BigInt(await provider.send("eth_chainId", [])); }
    catch { throw new Error(`${rpcName} did not return a valid eth_chainId`); }
    if (rpcChainId <= 0n || rpcChainId.toString() !== chain.chainId) {
      throw new Error(`${rpcName} returned the wrong chain ID`);
    }
    const head = await provider.getBlockNumber();
    if (BigInt(head - chainInput.confirmations) < BigInt(chainInput.cutoffBlock)) {
      throw new Error(`chain ${chain.chainId} cutoff is not finalized at ${chainInput.confirmations} confirmations`);
    }
    providers.set(chain.chainId, provider);
    if (BigInt(chain.lastProcessedBlock) < BigInt(chainInput.cutoffBlock)) violations.push({
      code: "ON_CHAIN_CHECKPOINT_BEHIND_CUTOFF", severity: "failed", chainId: chain.chainId,
      detail: `MercataBridge checkpoint ${chain.lastProcessedBlock} is behind cutoff ${chainInput.cutoffBlock}`,
    });
    await inspectSafeHistory(chain, bridge, chainInput, withdrawalStatuses,
      env.SAFE_API_KEY, fetchImpl, violations);
  }

  const deposits = depositRows.map(({ key, key2, value }) => ({
    chainId: uint(key, "deposit chain ID"), key: canonicalDepositKey(key2), value,
  }));
  const withdrawals = withdrawalRows.map(({ key, value }) => ({
    id: uint(key, "withdrawal ID"), value,
  }));
  const openDeposits = deposits
    .filter(row => [LEGACY_STATUS.INITIATED, LEGACY_STATUS.PENDING_REVIEW, LEGACY_STATUS.QUARANTINED].includes(statusOf(row)))
    .map(row => ({ chainId: row.chainId, depositKey: row.key, bridgeStatus: statusOf(row), externalToken: row.value.externalToken }));
  const openWithdrawals = withdrawals
    .filter(row => [LEGACY_STATUS.INITIATED, LEGACY_STATUS.PENDING_REVIEW].includes(statusOf(row)))
    .map(row => ({ withdrawalId: row.id, bridgeStatus: statusOf(row), externalChainId: row.value.externalChainId,
      externalToken: row.value.externalToken, custodyTxHash: row.value.custodyTxHash || "" }));
  if (openDeposits.length) violations.push({
    code: "OPEN_LEGACY_DEPOSITS", severity: "failed",
    detail: `${openDeposits.length} legacy deposits are not terminal`, evidence: { count: openDeposits.length },
  });
  if (openWithdrawals.length) violations.push({
    code: "OPEN_LEGACY_WITHDRAWALS", severity: "failed",
    detail: `${openWithdrawals.length} legacy withdrawals are not terminal`, evidence: { count: openWithdrawals.length },
  });

  const dataDirectory = path.resolve(input.dataDirectory || path.join(process.cwd(), "data"));
  const [deadLetterFile, proposalJournalFile, checkpointFile] = await Promise.all([
    readOptionalJson(path.join(dataDirectory, "depositDeadLetters.json")),
    readOptionalJson(path.join(dataDirectory, "withdrawalProposals.json")),
    readOptionalJson(path.join(dataDirectory, "lastProcessedBlocks.json")),
  ]);
  const deadLetters = deadLetterFile.data;
  const proposalJournal = proposalJournalFile.data;
  const localCheckpoints = checkpointFile.data;
  for (const [name, sourceFile] of Object.entries({
    depositDeadLetters: deadLetterFile,
    withdrawalProposals: proposalJournalFile,
    lastProcessedBlocks: checkpointFile,
  })) {
    if (!sourceFile.present) violations.push({
      code: "PERSISTENT_STATE_FILE_MISSING", severity: "review",
      detail: `${name}.json was not present in the archived legacy-service data directory`,
    });
  }
  if (Object.keys(deadLetters).length) violations.push({
    code: "DEPOSIT_DEAD_LETTERS_PRESENT", severity: "review",
    detail: `${Object.keys(deadLetters).length} deposit dead-letter records require review`,
  });
  const terminal = new Set(withdrawals
    .filter(row => [LEGACY_STATUS.COMPLETED, LEGACY_STATUS.ABORTED, LEGACY_STATUS.SWEPT].includes(statusOf(row)))
    .map(row => row.id));
  const activeJournal = Object.values(proposalJournal).filter(entry => !terminal.has(String(entry?.withdrawalId)));
  if (activeJournal.length) violations.push({
    code: "ACTIVE_WITHDRAWAL_JOURNAL_ENTRIES", severity: "failed",
    detail: `${activeJournal.length} withdrawal proposal journal entries are not terminal`,
  });
  for (const chain of chains) {
    const local = localCheckpoints[chain.chainId];
    if (local === undefined) violations.push({
      code: "LOCAL_CHECKPOINT_MISSING", severity: "review", chainId: chain.chainId,
      detail: "No local legacy-service checkpoint was found",
    });
    else if (BigInt(String(local)) < BigInt(input.chains[chain.chainId].cutoffBlock)) violations.push({
      code: "LOCAL_CHECKPOINT_BEHIND_CUTOFF", severity: "failed", chainId: chain.chainId,
      detail: `Local checkpoint ${local} is behind cutoff ${input.chains[chain.chainId].cutoffBlock}`,
    });
  }

  const chainMap = new Map(chains.map(item => [item.chainId, item]));
  const completedDeposits = await collectDepositFlows(deposits, chainMap, input, providers, violations);
  const completedWithdrawals = await collectWithdrawalFlows(
    withdrawals, chainMap, input, providers, fetchImpl, env.SAFE_API_KEY, violations);
  const assets = assetRows.map(({ key, key2, value }) => ({
    externalToken: normalizeAddress(key, `asset ${key2} token`),
    chainId: uint(key2, "asset chain ID"),
    stratoToken: normalizeAddress(value.stratoToken, `asset ${key2}:${key} STRATO token`),
    externalDecimals: uint(value.externalDecimals, `asset ${key2}:${key} decimals`),
  }));
  const balanceKeys = new Map();
  for (const asset of assets) balanceKeys.set(`${asset.chainId}:${asset.externalToken}`, {
    chain: chainMap.get(asset.chainId), token: asset.externalToken,
  });
  for (const flow of [...completedDeposits, ...completedWithdrawals]) {
    balanceKeys.set(`${flow.chainId}:${flow.externalToken}`, { chain: chainMap.get(flow.chainId), token: flow.externalToken });
  }
  const balances = [];
  for (const { chain, token: externalToken } of balanceKeys.values()) {
    if (!chain) continue;
    const provider = providers.get(chain.chainId);
    const block = input.chains[chain.chainId].cutoffBlock;
    try {
      const [custody, hot] = await Promise.all([
        Promise.all(chain.custodyAddresses.map(account => tokenBalance(provider, externalToken, account, block))),
        Promise.all(chain.hotWalletAddresses.map(account => tokenBalance(provider, externalToken, account, block))),
      ]);
      const retained = input.chains[chain.chainId].retainedReserves?.[externalToken]
        ?? input.chains[chain.chainId].retainedReserves?.[bare(externalToken)] ?? "0";
      balances.push({
        chainId: chain.chainId, externalToken,
        mainSafe: custody.reduce((sum, value) => sum + value, 0n).toString(),
        hotSafe: hot.reduce((sum, value) => sum + value, 0n).toString(),
        retained: uint(retained, `${chain.chainId}:${externalToken} retained reserve`),
      });
    } catch (error) {
      violations.push({
        code: "CUSTODY_BALANCE_UNAVAILABLE", severity: "failed", chainId: chain.chainId, externalToken,
        detail: `Could not read pinned custody balance: ${error.message}`,
      });
    }
  }

  return {
    stratoNetworkId, stratoObservedBlock, chains, assets,
    deposits: completedDeposits, withdrawals: completedWithdrawals, balances,
    openDeposits, openWithdrawals, violations,
    sources: {
      deadLetterCount: Object.keys(deadLetters).length,
      withdrawalJournalCount: Object.keys(proposalJournal).length,
      filesPresent: {
        depositDeadLetters: deadLetterFile.present,
        withdrawalProposals: proposalJournalFile.present,
        lastProcessedBlocks: checkpointFile.present,
      },
    },
  };
}

module.exports = { collectBackingEvidence };
