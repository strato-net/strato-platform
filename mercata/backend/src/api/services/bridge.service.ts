import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForAllTxs } from "../../utils/txHelper";
import { strato, cirrus, bridge, eth } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix } from "../../utils/utils";
import { getTokenMetadata } from "../helpers/cirrusHelpers";
import {
  buildQueryParams,
  BridgeMappingRow,
  enrichTransactionData,
  enrichAssetsWithTokenData,
  executeParallelQueries,
  parseBridgeRouteMappings,
  QUERY_CONFIGS
} from "../helpers/bridge.helper";
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, DepositActionRequestParams, WithdrawalSummaryResponse, TransactionResponse, DepositAction, WithdrawalProof, WithdrawalTransactionResponse } from "@mercata/shared-types";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getOraclePrices, getRebaseFactors } from "./oracle.service";
import { toUTCTime } from "../helpers/cirrusHelpers";

const { MercataBridge, Token, LendingPool, LendingRegistry, mercataBridge, DECIMALS } = constants;

export const requestWithdrawal = async (
  accessToken: string,
  {
    externalChainId,
    externalRecipient,
    externalToken,
    stratoToken,
    stratoTokenAmount,
  }: WithdrawalRequestParams,
  userAddress: string
): Promise<WithdrawalTransactionResponse> => {
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

  const logs: Array<{ contractAddress: string; eventName: string }> = data.logs || [];
  const wantedAddr = mercataBridge.toLowerCase();
  const logIndex = logs.findIndex(
    (l) =>
      (l.eventName === "Withdrawal" || l.eventName === "WithdrawalRequestedV2") &&
      (l.contractAddress || "").toLowerCase().replace(/^0x/, "") ===
        wantedAddr.replace(/^0x/, "")
  );
  if (logIndex < 0) return undefined;
  const eventName = logs[logIndex].eventName as "Withdrawal" | "WithdrawalRequestedV2";

  const blockNumber = typeof data.blockNumber === "number" ? data.blockNumber : Number(data.blockNumber || 0);

  return {
    blockNumber,
    txIndex,
    logIndex,
    headerRLP: data.headerRLP,
    signatures: data.signatures || [],
    receiptRLP: data.receiptRLP,
    mptProof: data.mptProof || [],
    eventName,
  };
};

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
  
  const dataParams = {
    select: config.selectFields,
    ...buildQueryParams(rawParams, userAddress, [], type)
  };

  const countParams = {
    select: config.countField,
    ...buildQueryParams(rawParams, userAddress, ['limit', 'offset', 'order', 'select'], type)
  };

  const { results, totalCount } = await executeParallelQueries(
    accessToken, config, dataParams, countParams
  );

  if (!results.length) {
    return { data: [], totalCount };
  }

  const enrichedData = await enrichTransactionData(accessToken, results, type);
  
  return { data: enrichedData, totalCount };
};

export const getBridgeableTokens = async (accessToken: string, chainId?: string): Promise<BridgeToken[]> => {
  const params: Record<string, string> = {
    select: "collection_name,externalToken:key->>key,externalChainId:key->>key2,targetStratoToken:key->>key3,mappingValue:value",
    collection_name: "in.(assets,assetRouteEnabled)",
    address: `eq.${mercataBridge}`
  };
  if (chainId) params["key->>key2"] = `eq.${chainId}`;

  const { data: mappings } = await cirrus.get(accessToken, "/mapping", { params });
  if (!Array.isArray(mappings) || !mappings.length) return [];

  const routes = parseBridgeRouteMappings(mappings as BridgeMappingRow[]);
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

  const [balances, prices, pending, completed] = await Promise.all([
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
    })
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
  for (const p of pending.data || []) {
    if (!p.stratoToken || !p.stratoTokenAmount) continue;
    const amount = BigInt(p.stratoTokenAmount || "0");
    const price = BigInt(prices.get(p.stratoToken) || "0");
    if (amount > 0n && price > 0n) {
      pendingUSD += (amount * price) / DECIMALS;
    }
  }

  let withdrawnUSD = 0n;
  for (const w of completed.data || []) {
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
