import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForAllTxs, postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus, bridge, eth } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix } from "../../utils/utils";
import { getTokenMetadata } from "../helpers/cirrusHelpers";
import {
  buildQueryParams,
  BridgeMappingRow,
  NativeBridgeAssetRow,
  enrichTransactionData, 
  enrichAssetsWithTokenData,
  executeParallelQueries,
  parseBridgeRouteMappings,
  parseNativeBridgeAssets,
  QUERY_CONFIGS 
} from "../helpers/bridge.helper";
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, DepositActionRequestParams, WithdrawalSummaryResponse, TransactionResponse, DepositAction, WithdrawalProof, WithdrawalTransactionResponse } from "@mercata/shared-types";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getOraclePrices, getRebaseFactors } from "./oracle.service";
import { toUTCTime } from "../helpers/cirrusHelpers";

const { MercataBridge, StratoNativeBridge, Token, LendingPool, LendingRegistry, mercataBridge, DECIMALS } = constants;

const stripPagingParams = (
  params: Record<string, string | undefined>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([key, value]) => value !== undefined && !["limit", "offset", "order", "select"].includes(key)
    )
  ) as Record<string, string>;

const applyPagination = (
  rows: any[],
  rawParams: Record<string, string | undefined>
) => {
  const order = rawParams.order || "block_timestamp.desc";
  const desc = order.endsWith(".desc");
  const sorted = [...rows].sort((a, b) => {
    const aTime = new Date(a.block_timestamp || 0).getTime();
    const bTime = new Date(b.block_timestamp || 0).getTime();
    return desc ? bTime - aTime : aTime - bTime;
  });
  const offset = Math.max(Number(rawParams.offset || 0), 0);
  const limit = rawParams.limit == null ? sorted.length : Math.max(Number(rawParams.limit), 0);
  return sorted.slice(offset, offset + limit);
};

const nativeTransactionParams = (
  rawParams: Record<string, string | undefined>,
  userAddress: string | undefined,
  type: "withdrawal" | "deposit"
): Record<string, string> => {
  const params = stripPagingParams(rawParams);
  const chainFilter = type === "deposit" ? params.key : undefined;
  delete params.key;

  return {
    ...params,
    ...(chainFilter ? { "value->>externalChainId": chainFilter } : {}),
    address: `eq.${constants.stratoNativeBridge}`,
    ...(userAddress && {
      [`value->>${type === "deposit" ? "stratoRecipient" : "stratoSender"}`]: `eq.${userAddress}`,
    }),
  };
};

const normalizeNativeTransactions = (
  rows: any[],
  type: "withdrawal" | "deposit"
) => rows.map((row) => {
  const value = row?.value || {};
  if (type === "withdrawal") {
    return {
      withdrawalId: row.key,
      WithdrawalInfo: {
        ...value,
        externalToken: value.representationToken,
      },
      block_timestamp: row.block_timestamp,
      routeType: "native",
    };
  }

  return {
    depositId: row.key,
    externalChainId: value.externalChainId,
    externalTxHash: value.externalTxHash,
    DepositInfo: {
      ...value,
      externalToken: value.representationToken,
    },
    block_timestamp: row.block_timestamp,
    routeType: "native",
  };
});

export const requestWithdrawal = async (
  accessToken: string,
  {
    routeType,
    externalChainId,
    externalRecipient,
    externalToken,
    stratoToken,
    stratoTokenAmount,
  }: WithdrawalRequestParams,
  userAddress: string
): Promise<TransactionResponse> => {
  if (routeType === "native") {
    throw new Error("Use the native bridge withdrawal route for native requests");
  }

  const tx = await buildFunctionTx(
    [
      {
        contractName: extractContractName(Token),
        contractAddress: stratoToken,
        method: "approve",
        args: { spender: constants.mercataBridge, value: stratoTokenAmount },
      },
      {
        contractName: extractContractName(MercataBridge),
        contractAddress: constants.mercataBridge,
        method: "requestWithdrawalProof",
        args: {
          externalChainId,
          externalRecipient,
          externalToken,
          stratoToken,
          stratoTokenAmount,
        },
      },
    ],
    userAddress,
    accessToken
  );

  const allResults = await postAndWaitForAllTxs(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  // External-signing path: txs aren't on-chain yet, so we can't fetch a
  // proof. Frontend will sign + submit, then call /bridge/withdrawalProof to
  // pick up the proof once the requestWithdrawalProof tx is finalized.
  const externalSigning = allResults.length > 0 && allResults[0]?.status === undefined && allResults[0]?.data !== undefined;
  if (externalSigning) {
    return { status: "unsigned", hash: allResults[0]?.hash };
  }

  // The requestWithdrawalProof tx is the second (and final) entry in the batch.
  const proofTx = allResults[allResults.length - 1];
  const baseResponse: WithdrawalTransactionResponse = {
    status: proofTx?.status,
    hash: proofTx?.hash,
  };

  // Best-effort proof fetch -- a failure here doesn't break the withdrawal
  // submission. The frontend can retry via getWithdrawalProof if needed.
  try {
    const proof = await getWithdrawalProof(accessToken, proofTx);
    if (proof) baseResponse.proof = proof;
  } catch (err: any) {
    console.warn(`Failed to fetch withdrawal proof for tx ${proofTx?.hash}: ${err?.message ?? err}`);
  }

  return baseResponse;
};

/**
 * Fetch the inclusion proof for the Withdrawal (or WithdrawalRequestedV2)
 * event emitted by a `requestWithdrawalProof` tx. The frontend feeds the
 * returned bytes into `BridgeVault.claimWithdrawal` (or `submitProof`) on
 * the external chain.
 *
 * Pass either a tx-hash string or a bloc result entry that already includes
 * the block hash; the latter avoids a round-trip.
 */
export const getWithdrawalProof = async (
  accessToken: string,
  txOrHash: string | { hash?: string; blockHash?: string; txResult?: { blockHash?: string } }
): Promise<WithdrawalProof | undefined> => {
  const hash = typeof txOrHash === "string" ? txOrHash : txOrHash?.hash;
  if (!hash) return undefined;
  const inlineBlockHash =
    typeof txOrHash === "string"
      ? undefined
      : txOrHash?.blockHash || txOrHash?.txResult?.blockHash;

  const blockHash = inlineBlockHash || (await fetchBlockHashForTx(accessToken, hash));
  if (!blockHash) return undefined;

  const txIndex = await fetchTxIndexInBlock(accessToken, blockHash, hash);
  if (txIndex < 0) return undefined;

  const proofResp = await eth.get<any>(
    accessToken,
    `/receipts/hash/${blockHash}/proof/${txIndex}`
  );
  const data = proofResp?.data;
  if (!data || !data.receiptRLP) return undefined;

  const logs: Array<{ contractAddress: string; eventName: string; args?: string[] }> = data.logs || [];
  const wantedAddr = mercataBridge.toLowerCase();
  const logIndex = logs.findIndex(
    (l) =>
      (l.eventName === "Withdrawal" || l.eventName === "WithdrawalRequestedV2") &&
      (l.contractAddress || "").toLowerCase().replace(/^0x/, "") ===
        wantedAddr.replace(/^0x/, "")
  );
  if (logIndex < 0) return undefined;
  const matchedLog = logs[logIndex];
  const eventName = matchedLog.eventName as "Withdrawal" | "WithdrawalRequestedV2";

  const blockNumber = typeof data.blockNumber === "number" ? data.blockNumber : Number(data.blockNumber || 0);

  // Hot-path Withdrawal events emit 10 args; the trailing pair is
  // (prevWithdrawalBlock, seq) -- the BridgeVault uses these to enforce
  // sequence-ordered fund release. Cold-path WithdrawalRequestedV2 stays
  // at 8 args and doesn't use sequencing (admin gates release).
  const args = matchedLog.args || [];
  const sequenced = eventName === "Withdrawal" && args.length === 10;
  const seq = sequenced ? rlpUintToNumber(args[9]) : undefined;
  const prevWithdrawalBlock = sequenced ? rlpUintToNumber(args[8]) : undefined;

  return {
    blockNumber,
    txIndex,
    logIndex,
    headerRLP: data.headerRLP,
    signatures: data.signatures || [],
    receiptRLP: data.receiptRLP,
    mptProof: data.mptProof || [],
    eventName,
    seq,
    prevWithdrawalBlock,
  };
};

/**
 * Find the proof for a specific (chainId, seq) Withdrawal event known to be
 * in `blockNumber`. Used by the UI's catch-up flow when walking the
 * `prevWithdrawalBlock` chain backwards: the user has their own seq=K and
 * needs the predecessors seq=T..seq=K-1 (where T is the vault's
 * `nextSeqToProcess`) before their own claim can release.
 *
 * Scans every tx receipt in the block looking for a hot-path Withdrawal log
 * whose externalChainId arg matches and whose seq arg equals `targetSeq`.
 * Returns the same shape as the txHash-keyed `getWithdrawalProof` so callers
 * can drop it into the same on-chain claim path.
 */
export const getWithdrawalProofForSeq = async (
  accessToken: string,
  chainId: number,
  blockNumber: number,
  targetSeq: number,
): Promise<WithdrawalProof | undefined> => {
  // Look up the canonical block hash so we can hit the receipts endpoint by
  // hash (the by-number variant exists too but redirects through hash; one
  // less round trip to do it ourselves).
  const blockResp = await eth.get<any[]>(accessToken, `/block`, {
    params: { number: blockNumber },
  });
  const block = blockResp?.data?.[0];
  if (!block) return undefined;
  const blockHash: string | undefined = block.blockHash;
  if (!blockHash) return undefined;
  const txs: any[] = block.receiptTransactions || [];

  const wantedAddr = mercataBridge.toLowerCase().replace(/^0x/, "");
  for (let txIndex = 0; txIndex < txs.length; txIndex++) {
    const proofResp = await eth.get<any>(accessToken, `/receipts/hash/${blockHash}/proof/${txIndex}`);
    const data = proofResp?.data;
    if (!data || !data.receiptRLP) continue;
    const logs: Array<{ contractAddress: string; eventName: string; args?: string[] }> = data.logs || [];
    for (let logIndex = 0; logIndex < logs.length; logIndex++) {
      const l = logs[logIndex];
      if (l.eventName !== "Withdrawal") continue;
      if ((l.contractAddress || "").toLowerCase().replace(/^0x/, "") !== wantedAddr) continue;
      const args = l.args || [];
      // The Withdrawal event has had two shapes over MercataBridge's
      // lifetime: an 8-arg legacy form (no seq/prevWithdrawalBlock) and the
      // current 10-arg sequenced form. On a deployment that was upgraded
      // mid-chain, an early hot-path withdrawal can still be sitting in
      // legacy form while subsequent ones are sequenced. The L1 vault's
      // {STRATOEventDecoder} accepts both shapes and defaults
      // `seq=0` / `prevWithdrawalBlock=0` for legacy logs, so for the
      // catch-up walk we accept the 8-arg form too — but only when the
      // caller's targetSeq is 0, since that's how the decoder will
      // interpret it on-chain.
      if (args.length !== 10 && args.length !== 8) continue;
      const eventChainId = rlpUintToNumber(args[1]);
      if (eventChainId !== chainId) continue;
      const seq = args.length === 10 ? rlpUintToNumber(args[9]) : 0;
      const prevWithdrawalBlock = args.length === 10 ? rlpUintToNumber(args[8]) : 0;
      if (args.length === 10 && seq !== targetSeq) continue;
      // Legacy 8-arg: the event encodes no seq, so we can only match it
      // when the caller wants seq=0 (the legacy event always decodes as
      // seq=0 on-chain). Anything else here is a misalignment.
      if (args.length === 8 && targetSeq !== 0) continue;
      return {
        blockNumber: typeof data.blockNumber === "number" ? data.blockNumber : Number(data.blockNumber || 0),
        txIndex,
        logIndex,
        headerRLP: data.headerRLP,
        signatures: data.signatures || [],
        receiptRLP: data.receiptRLP,
        mptProof: data.mptProof || [],
        eventName: "Withdrawal",
        seq: args.length === 10 ? seq : targetSeq,
        prevWithdrawalBlock,
      };
    }
  }
  return undefined;
};

/**
 * Decode a STRATO log arg (canonical RLP-encoded uint, hex-prefixed) into
 * a JS number. Args are emitted as minimal big-endian by the producer,
 * with `0` represented as the empty string (`0x80`). Returns 0 for
 * malformed input so missing-field bugs surface as zeroes rather than
 * NaN/throws.
 */
function rlpUintToNumber(hex: string | undefined): number {
  if (!hex) return 0;
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length === 0) return 0;
  // Empty string sentinel: 0x80 = list-of-length-0 in RLP, encoded value 0.
  if (stripped === "80") return 0;
  // Single byte 0x00..0x7f encodes itself.
  if (stripped.length === 2 && parseInt(stripped, 16) < 0x80) {
    return parseInt(stripped, 16);
  }
  // Otherwise: 0x80 + length prefix, followed by big-endian bytes.
  const lenByte = parseInt(stripped.slice(0, 2), 16);
  if (lenByte < 0x81 || lenByte > 0x88) return 0; // outside uint64-ish range
  const payloadHex = stripped.slice(2);
  if (payloadHex.length === 0) return 0;
  return Number(BigInt("0x" + payloadHex));
}

const fetchBlockHashForTx = async (
  accessToken: string,
  txHash: string
): Promise<string | undefined> => {
  const cleanHash = txHash.startsWith("0x") ? txHash.slice(2) : txHash;
  const resp = await eth.get<any[]>(accessToken, `/transactionResult/${cleanHash}`);
  const rows = resp?.data;
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const bh = rows[0]?.blockHash;
  if (!bh) return undefined;
  return typeof bh === "string" ? bh : String(bh);
};

const fetchTxIndexInBlock = async (
  accessToken: string,
  blockHash: string,
  txHash: string
): Promise<number> => {
  const resp = await eth.get<any[]>(accessToken, `/block`, {
    params: { hash: blockHash },
  });
  const blocks = resp?.data;
  if (!Array.isArray(blocks) || blocks.length === 0) return -1;
  const block = blocks[0];
  const txs: any[] = block?.receiptTransactions || [];
  const wanted = txHash.startsWith("0x") ? txHash.slice(2).toLowerCase() : txHash.toLowerCase();
  return txs.findIndex((t: any) => {
    const h = (t?.hash || "").toLowerCase();
    return h === wanted || h === `0x${wanted}` || h.replace(/^0x/, "") === wanted;
  });
};

export const requestNativeWithdrawal = async (
  accessToken: string,
  {
    externalChainId,
    externalRecipient,
    stratoToken,
    stratoTokenAmount,
  }: WithdrawalRequestParams,
  userAddress: string
): Promise<TransactionResponse> => {
  if (!constants.stratoNativeBridge) {
    throw new Error("STRATO_NATIVE_BRIDGE is not configured");
  }
  if (!constants.stratoNativeCustodyVault) {
    throw new Error("STRATO_NATIVE_CUSTODY_VAULT is not configured");
  }

  const tx = await buildFunctionTx(
    [
      {
        contractName: extractContractName(Token),
        contractAddress: stratoToken,
        method: "approve",
        args: {
          spender: constants.stratoNativeCustodyVault,
          value: stratoTokenAmount,
        },
      },
      {
        contractName: extractContractName(StratoNativeBridge),
        contractAddress: constants.stratoNativeBridge,
        method: "requestWithdrawal",
        args: {
          externalChainId,
          externalRecipient,
          stratoToken,
          stratoTokenAmount,
        },
      },
    ],
    userAddress,
    accessToken
  );

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
};

export const requestDepositAction = async (
  accessToken: string,
  {
    externalChainId,
    externalTxHash,
    action,
    targetToken,
  }: DepositActionRequestParams,
  userAddress: string
) : Promise<TransactionResponse> => {
  const response = await bridge.post<TransactionResponse>(accessToken, `/request-deposit-action`, {
    externalChainId,
    externalTxHash,
    action,
    targetToken,
  });
  return response.data;
};

export const getBridgeTransactions = async (
  accessToken: string,
  type: 'withdrawal' | 'deposit',
  userAddress: string | undefined,
  rawParams: Record<string, string | undefined> = {}
): Promise<BridgeTransactionResponse> => {
  const config = QUERY_CONFIGS[type];
  const isDeposit = type === "deposit";
  const offset = Math.max(Number(rawParams.offset || 0), 0);
  const limit = rawParams.limit == null ? undefined : Math.max(Number(rawParams.limit), 0);
  const sourceLimit = isDeposit && limit != null ? String(offset + limit) : undefined;
  const sourcePageParams = isDeposit
    ? {
        order: rawParams.order || "block_timestamp.desc",
        ...(sourceLimit ? { limit: sourceLimit } : {}),
      }
    : {};
  const queryParams = buildQueryParams(stripPagingParams(rawParams), userAddress, [], type);

  const dataParams = {
    select: config.selectFields,
    ...queryParams,
    ...sourcePageParams
  };
  const nativeParams = nativeTransactionParams(rawParams, userAddress, type);

  const [standardResponse, nativeResponse, nativeCountResponse] = await Promise.all([
    executeParallelQueries(
      accessToken,
      config,
      dataParams,
      { ...queryParams, select: config.countField }
    ),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}-${type === "withdrawal" ? "withdrawals" : "deposits"}`, {
          params: {
            select: "key,value,block_timestamp",
            ...nativeParams,
            ...sourcePageParams,
          }
        })
      : Promise.resolve({ data: [] }),
    isDeposit && constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}-deposits`, {
          params: {
            select: "count()",
            ...nativeParams,
          }
        })
      : Promise.resolve({ data: [] }),
  ]);

  const nativeRows = Array.isArray(nativeResponse.data)
    ? normalizeNativeTransactions(nativeResponse.data, type)
    : [];
  const mergedResults = [...standardResponse.results, ...nativeRows];
  const allResults = isDeposit ? applyPagination(mergedResults, rawParams) : mergedResults;
  const nativeCount = Number(nativeCountResponse.data?.[0]?.count || 0);
  const totalCount = isDeposit
    ? Number(standardResponse.totalCount || 0) + nativeCount
    : allResults.length;

  if (!allResults.length) {
    return { data: [], totalCount };
  }

  const enrichedData = await enrichTransactionData(accessToken, allResults, type);
  return { data: isDeposit ? enrichedData : applyPagination(enrichedData, rawParams), totalCount };
};

export const getBridgeableTokens = async (accessToken: string, chainId?: string): Promise<BridgeToken[]> => {
  const standardParams: Record<string, string> = {
    select: "collection_name,externalToken:key->>key,externalChainId:key->>key2,targetStratoToken:key->>key3,mappingValue:value",
    collection_name: "in.(assets,assetRouteEnabled)",
    address: `eq.${mercataBridge}`
  };
  if (chainId) standardParams["key->>key2"] = `eq.${chainId}`;

  const nativeParams: Record<string, string> = {
    address: `eq.${constants.stratoNativeBridge}`,
    select: "key,key2,value",
  };
  if (chainId) nativeParams["key2"] = `eq.${chainId}`;

  const [standardResponse, nativeResponse, nativeBridgeResponse] = await Promise.all([
    cirrus.get(accessToken, "/mapping", { params: standardParams }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}-assets`, { params: nativeParams })
      : Promise.resolve({ data: [] }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}`, {
          params: {
            address: `eq.${constants.stratoNativeBridge}`,
            select: "depositsPaused,withdrawalsPaused",
            limit: "1",
          }
        })
      : Promise.resolve({ data: [] }),
  ]);

  const standardRoutes = Array.isArray(standardResponse.data)
    ? parseBridgeRouteMappings(standardResponse.data as BridgeMappingRow[])
    : [];
  const nativeBridgeState = Array.isArray(nativeBridgeResponse.data)
    ? nativeBridgeResponse.data[0]
    : undefined;
  const nativeRoutes = Array.isArray(nativeResponse.data)
    ? parseNativeBridgeAssets(nativeResponse.data as NativeBridgeAssetRow[], {
        depositsPaused: nativeBridgeState?.depositsPaused === true,
        withdrawalsPaused: nativeBridgeState?.withdrawalsPaused === true,
      })
    : [];
  const routes = [...standardRoutes, ...nativeRoutes];
  if (!routes.length) return [];

  const tokenAddressSet = new Set<string>();
  for (const { AssetInfo } of routes) {
    const token = AssetInfo?.stratoToken;
    if (!token) continue;
    const lower = token.toLowerCase();
    tokenAddressSet.add(lower.startsWith("0x") ? lower.slice(2) : lower);
  }
  const [tokenMap, rebaseFactorMap] = await Promise.all([
    getTokenMetadata(accessToken, [...tokenAddressSet]),
    getRebaseFactors(accessToken),
  ]);

  const tokens = enrichAssetsWithTokenData(routes, tokenMap);
  for (const token of tokens) {
    const factor = rebaseFactorMap.get(token.stratoToken.toLowerCase().replace(/^0x/, ''));
    if (factor) token.rebaseFactor = factor;
  }
  return tokens;
};

export const getNetworkConfigs = async (accessToken: string): Promise<NetworkConfig[]> => { 
  const { data } = await cirrus.get(accessToken, `/${MercataBridge}-chains`, {
    params: {
      select: "externalChainId:key,ChainInfo:value",
      "value->>enabled": "eq.true",
      address: `eq.${mercataBridge}`
    }
  });
  return data.map((c: any) => {
    if (c.ChainInfo.depositRouter) c.ChainInfo.depositRouter = ensureHexPrefix(c.ChainInfo.depositRouter);
    if (c.ChainInfo.bridgeVault) c.ChainInfo.bridgeVault = ensureHexPrefix(c.ChainInfo.bridgeVault);
    if (c.ChainInfo.stratoLightClient) c.ChainInfo.stratoLightClient = ensureHexPrefix(c.ChainInfo.stratoLightClient);
    return { externalChainId: c.externalChainId, chainInfo: c.ChainInfo };
  });
};

export const getWithdrawalSummary = async (
  accessToken: string,
  userAddress: string
): Promise<WithdrawalSummaryResponse> => {
  const routes = await getBridgeableTokens(accessToken);
  const stratoTokens = [...new Set(routes.map((route) => route.stratoToken).filter(Boolean))];
  const thirtyDaysAgoUTC = toUTCTime(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  const nativeWithdrawalsTable = `/${StratoNativeBridge}-withdrawals`;
  const [balances, prices, pending, completed, nativePending, nativeCompleted] = await Promise.all([
    stratoTokens.length > 0
      ? cirrus.get(accessToken, `/${Token}-_balances`, {
          params: {
            select: "address,balance:value::text",
            key: `eq.${userAddress}`,
            address: `in.(${stratoTokens.join(",")})`
          }
        })
      : Promise.resolve({ data: [] }),
    getCompletePriceMap(accessToken),
    cirrus.get(accessToken, `/${MercataBridge}-withdrawals`, {
      params: {
        select: "value->>stratoToken,value->>stratoTokenAmount",
        address: `eq.${mercataBridge}`,
        "value->>stratoSender": `eq.${userAddress}`,
        "value->>bridgeStatus": "in.(1,2)"
      }
    }),
    cirrus.get(accessToken, `/${MercataBridge}-withdrawals`, {
      params: {
        select: "value->>stratoToken,value->>stratoTokenAmount",
        address: `eq.${mercataBridge}`,
        "value->>stratoSender": `eq.${userAddress}`,
        "value->>bridgeStatus": "eq.3",
        block_timestamp: `gte.${thirtyDaysAgoUTC}`
      }
    }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, nativeWithdrawalsTable, {
          params: {
            select: "value->>stratoToken,value->>stratoTokenAmount",
            address: `eq.${constants.stratoNativeBridge}`,
            "value->>stratoSender": `eq.${userAddress}`,
            "value->>bridgeStatus": "in.(1,2)"
          }
        })
      : Promise.resolve({ data: [] }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, nativeWithdrawalsTable, {
          params: {
            select: "value->>stratoToken,value->>stratoTokenAmount",
            address: `eq.${constants.stratoNativeBridge}`,
            "value->>stratoSender": `eq.${userAddress}`,
            "value->>bridgeStatus": "eq.3",
            block_timestamp: `gte.${thirtyDaysAgoUTC}`
          }
        })
      : Promise.resolve({ data: [] })
  ]);

  let availableUSD = 0n;
  for (const b of balances.data || []) {
    const balance = BigInt(b.balance || "0");
    const price = BigInt(prices.get(b.address) || "0");
    if (balance > 0n && price > 0n) {
      availableUSD += (balance * price) / DECIMALS / DECIMALS;
    }
  }

  let pendingUSD = 0n;
  for (const p of [...(pending.data || []), ...(nativePending.data || [])]) {
    if (!p.stratoToken || !p.stratoTokenAmount) continue;
    const amount = BigInt(p.stratoTokenAmount || "0");
    const price = BigInt(prices.get(p.stratoToken) || "0");
    if (amount > 0n && price > 0n) {
      pendingUSD += (amount * price) / DECIMALS;
    }
  }

  let withdrawnUSD = 0n;
  for (const w of [...(completed.data || []), ...(nativeCompleted.data || [])]) {
    if (!w.stratoToken || !w.stratoTokenAmount) continue;
    const amount = BigInt(w.stratoTokenAmount || "0");
    const price = BigInt(prices.get(w.stratoToken) || "0");
    if (amount > 0n && price > 0n) {
      withdrawnUSD += (amount * price) / DECIMALS;
    }
  }
  
  return {
    totalWithdrawn30d: withdrawnUSD.toString(),
    pendingWithdrawals: pendingUSD.toString(),
    availableToWithdraw: availableUSD.toString()
  };
};

export const getDepositActions = async (accessToken: string): Promise<DepositAction[]> => {
  const key = (r: any) => typeof r.key === "object" ? r.key.key : r.key;
  const val = (r: any) => typeof r.value === "string" ? JSON.parse(r.value) : r.value ?? {};

  const [{ data: mappings = [] }, { data: [pool] = [] }, prices, { data: [rateEvt] = [] }] = await Promise.all([
    constants.metalForge
      ? cirrus.get(accessToken, "/mapping", {
          params: { select: "collection_name,key,value::text", collection_name: "in.(metalConfigs,isSupportedPayToken)", address: `eq.${constants.metalForge}` }
        })
      : Promise.resolve({ data: [] }),
    cirrus.get(accessToken, `/${LendingRegistry}`, {
      params: { address: `eq.${constants.lendingRegistry}`, select: "lendingPool:lendingPool_fkey(borrowableAsset,mToken)" }
    }),
    getOraclePrices(accessToken),
    cirrus.get(accessToken, `/${LendingPool}-ExchangeRateUpdated`, {
      params: { select: "newRate::text", order: "block_timestamp.desc", limit: "1" }
    }),
  ]);

  const metals = mappings.filter((r: any) => r.collection_name === "metalConfigs").map((r: any) => ({ addr: key(r), ...val(r) })).filter((m: any) => m.isEnabled === true);
  const payTokens = mappings.filter((r: any) => r.collection_name === "isSupportedPayToken").filter((r: any) => r.value === true || r.value === "true").map((r: any) => ({ addr: key(r) }));
  const { borrowableAsset, mToken } = pool?.lendingPool || {};
  if (mToken) prices.set(mToken, rateEvt?.newRate || (10n ** 18n).toString());

  const allAddrs = [...metals.map((m: any) => m.addr), ...(mToken ? [mToken] : [])];
  const tokenMap = allAddrs.length ? await getTokenMetadata(accessToken, allAddrs) : new Map();

  const toAction = (id: string, action: number, addr: string, pay: string, feeBps?: string): DepositAction => {
    const m = tokenMap.get(addr);
    return {
      id,
      action,
      stratoToken: addr,
      stratoTokenName: m?.name ?? "",
      stratoTokenSymbol: m?.symbol ?? "",
      stratoTokenImage: m?.image,
      payToken: pay,
      oraclePrice: prices.get(addr),
      ...(feeBps != null && feeBps !== "" ? { feeBps: String(feeBps) } : {}),
    };
  };

  return [
    ...(borrowableAsset && mToken ? [toAction(`earn-${borrowableAsset}`, 1, mToken, borrowableAsset)] : []),
    ...payTokens.flatMap((p: any) =>
      metals.map((m: any) => toAction(`forge-${p.addr}-${m.addr}`, 2, m.addr, p.addr, m.feeBps)),
    ),
  ];
};
