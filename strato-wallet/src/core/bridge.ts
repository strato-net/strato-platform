// Token bridging between STRATO and EVM chains. One side is always STRATO.
//   - STRATO -> EVM (withdrawal): BLOC approve + MercataBridge.requestWithdrawal.
//   - EVM -> STRATO (deposit): DepositRouter.deposit (ERC20 via Permit2) or
//     depositETH (native), on the EVM chain. A relayer completes the far side.
// Bridgeable routes + per-chain contract addresses come from the STRATO node's
// Cirrus registry (the "properly configured tokens" gate). Standard routes only;
// native/representation (wSTRATO) routes are a follow-up.

import {
  type Address,
  type Hex,
  encodeFunctionData,
  decodeFunctionResult,
  formatEther,
  hashTypedData,
  maxUint256,
} from "viem";
import type { StratoNetwork } from "./networks";
import { keyring } from "./keyring";
import { rpcCall } from "./rpc";
import { sendBlocCalls } from "./tx-strato";
import { sendEvmTransaction } from "./tx-evm";
import {
  DEPOSIT_ROUTER_ABI,
  ERC20_ABI,
  PERMIT2_ADDRESS,
  PERMIT2_TYPES,
  REPRESENTATION_BRIDGE_ABI,
} from "./bridge-abi";

const NATIVE = "0000000000000000000000000000000000000000";

export interface BridgeRoute {
  routeType: "standard" | "native";
  stratoToken: string; // no 0x
  externalChainId: string; // decimal string, e.g. "1"
  /** no 0x. Standard: external ERC20 (zero = native coin). Native: representation token. */
  externalToken: string;
  externalSymbol: string;
  externalName: string;
  externalDecimals: number;
  enabled: boolean;
  /** Native routes only: the representation bridge contract on the EVM chain. */
  externalBridge?: string;
}

export interface BridgeChainCfg {
  chainId: string;
  depositRouter: string; // 0x-prefixed
  custody: string;
  enabled: boolean;
}

export interface BridgeConfig {
  bridgeAddr: string; // STRATO MercataBridge address (no 0x), standard routes
  nativeBridgeAddr: string; // STRATO StratoNativeBridge address (no 0x), native routes
  custodyVault: string; // STRATO native custody vault (no 0x), native withdrawal approve target
  routes: BridgeRoute[];
  chains: BridgeChainCfg[];
}

function cirrus(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/cirrus/search`;
}

async function cget(url: string): Promise<any[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cirrus ${res.status}`);
  const j = await res.json();
  return Array.isArray(j) ? j : [];
}

/** Discover the bridge address, routes, and per-chain deposit routers. */
export async function fetchBridgeConfig(stratoNetwork: StratoNetwork): Promise<BridgeConfig> {
  const base = cirrus(stratoNetwork);
  // The MercataBridge address is whatever the -chains config lives under.
  const chainRows = await cget(`${base}/BlockApps-MercataBridge-chains?select=address,key,value&limit=50`);
  const bridgeAddr = (chainRows[0]?.address ?? "").replace(/^0x/, "");

  // Standard routes (MercataBridge "assets" mapping).
  const assetRows = bridgeAddr
    ? await cget(
        `${base}/mapping?address=eq.${bridgeAddr}&collection_name=eq.assets&select=value&limit=500`
      ).catch(() => [])
    : [];
  const standardRoutes: BridgeRoute[] = assetRows
    .map((r) => r.value)
    .filter((v) => v && v.stratoToken && v.enabled)
    .map((v): BridgeRoute => ({
      routeType: "standard",
      stratoToken: String(v.stratoToken).replace(/^0x/, "").toLowerCase(),
      externalChainId: String(v.externalChainId),
      externalToken: String(v.externalToken ?? NATIVE).replace(/^0x/, "").toLowerCase(),
      externalSymbol: v.externalSymbol ?? "?",
      externalName: v.externalName ?? v.externalSymbol ?? "Token",
      externalDecimals: Number(v.externalDecimals) || 18,
      enabled: v.enabled === true,
    }));

  const chains: BridgeChainCfg[] = chainRows
    .filter((r) => r.value?.depositRouter)
    .map((r): BridgeChainCfg => ({
      chainId: String(r.key),
      depositRouter: `0x${String(r.value.depositRouter).replace(/^0x/, "")}`,
      custody: String(r.value.custody ?? "").replace(/^0x/, ""),
      enabled: r.value.enabled === true,
    }));

  // Native routes (StratoNativeBridge): representation tokens (e.g. wSTRATO).
  const nativeAssetRows = await cget(
    `${base}/BlockApps-StratoNativeBridge-assets?select=address,key,key2,value&limit=500`
  ).catch(() => []);
  const nativeBridgeAddr = (nativeAssetRows[0]?.address ?? "").replace(/^0x/, "");
  let custodyVault = "";
  if (nativeBridgeAddr) {
    const cfg = await cget(
      `${base}/BlockApps-StratoNativeBridge?address=eq.${nativeBridgeAddr}&select=custodyVault&limit=1`
    ).catch(() => []);
    custodyVault = String(cfg[0]?.custodyVault ?? "").replace(/^0x/, "");
  }
  const nativeRoutes: BridgeRoute[] = nativeAssetRows
    .filter((r) => r.value?.representationToken && r.value?.enabled)
    .map((r): BridgeRoute => ({
      routeType: "native",
      stratoToken: String(r.key).replace(/^0x/, "").toLowerCase(),
      externalChainId: String(r.key2),
      externalToken: String(r.value.representationToken).replace(/^0x/, "").toLowerCase(),
      externalSymbol: r.value.externalSymbol ?? "?",
      externalName: r.value.externalName ?? r.value.externalSymbol ?? "Token",
      externalDecimals: 18,
      enabled: r.value.enabled === true,
      externalBridge: String(r.value.externalBridge ?? "").replace(/^0x/, "").toLowerCase(),
    }));

  return {
    bridgeAddr,
    nativeBridgeAddr,
    custodyVault,
    routes: [...standardRoutes, ...nativeRoutes],
    chains,
  };
}

// --------------------------------------------------------------- history
export type BridgeStatus = "completed" | "pending" | "failed";

export interface BridgeHistoryItem {
  direction: "out" | "in"; // out = STRATO->EVM withdrawal, in = EVM->STRATO deposit
  status: BridgeStatus;
  amount: string; // formatted (STRATO token, 18dp)
  symbol: string;
  externalChainId: string;
  counterparty: string; // 0x-prefixed
  timestamp: number;
  stratoToken: string; // internal, for symbol enrichment
}

function bridgeStatus(s: unknown): BridgeStatus {
  const v = String(s);
  return v === "3" ? "completed" : v === "4" ? "failed" : "pending";
}

function parseTs(s: unknown): number {
  const t = Date.parse(String(s).replace(" ", "T").replace(" UTC", "Z"));
  return Number.isNaN(t) ? Date.now() : t;
}

function fmt18(v: unknown): string {
  try {
    return Number(formatEther(BigInt(String(v ?? "0")))).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  } catch {
    return "0";
  }
}

/** The user's bridge transfers (both directions, standard + native routes). */
export async function fetchBridgeHistory(
  stratoNetwork: StratoNetwork,
  address: string
): Promise<BridgeHistoryItem[]> {
  const base = cirrus(stratoNetwork);
  const addr = address.toLowerCase().replace(/^0x/, "");
  const SS = "value-%3E%3EstratoSender"; // value->>stratoSender
  const SR = "value-%3E%3EstratoRecipient"; // value->>stratoRecipient

  const bridgeAddr = (
    await cget(`${base}/BlockApps-MercataBridge-chains?select=address&limit=1`).catch(() => [])
  )[0]?.address?.replace(/^0x/, "");
  const nativeAddr = (
    await cget(`${base}/BlockApps-StratoNativeBridge-assets?select=address&limit=1`).catch(() => [])
  )[0]?.address?.replace(/^0x/, "");

  const wq = (table: string, a: string) =>
    cget(
      `${base}/${table}-withdrawals?address=eq.${a}&${SS}=eq.${addr}` +
        `&select=WithdrawalInfo:value,block_timestamp&order=block_timestamp.desc&limit=25`
    ).catch(() => []);
  const dq = (table: string, a: string) =>
    cget(
      `${base}/${table}-deposits?address=eq.${a}&${SR}=eq.${addr}` +
        `&select=externalChainId:key,DepositInfo:value,block_timestamp&order=block_timestamp.desc&limit=25`
    ).catch(() => []);

  const groups = await Promise.all([
    bridgeAddr ? wq("BlockApps-MercataBridge", bridgeAddr) : Promise.resolve([]),
    bridgeAddr ? dq("BlockApps-MercataBridge", bridgeAddr) : Promise.resolve([]),
    nativeAddr ? wq("BlockApps-StratoNativeBridge", nativeAddr) : Promise.resolve([]),
    nativeAddr ? dq("BlockApps-StratoNativeBridge", nativeAddr) : Promise.resolve([]),
  ]);

  const items: BridgeHistoryItem[] = [];
  for (const r of [...groups[0], ...groups[2]]) {
    const i = r.WithdrawalInfo ?? {};
    items.push({
      direction: "out",
      status: bridgeStatus(i.bridgeStatus),
      amount: fmt18(i.stratoTokenAmount),
      symbol: "",
      externalChainId: String(i.externalChainId ?? ""),
      counterparty: `0x${String(i.externalRecipient ?? "").replace(/^0x/, "")}`,
      timestamp: parseTs(r.block_timestamp),
      stratoToken: String(i.stratoToken ?? "").replace(/^0x/, "").toLowerCase(),
    });
  }
  for (const r of [...groups[1], ...groups[3]]) {
    const i = r.DepositInfo ?? {};
    // Standard deposits key on the chainId; native deposits key on a depositId
    // hash and carry the chainId in DepositInfo. Use whichever is numeric.
    const isNum = (v: unknown) => /^\d+$/.test(String(v ?? ""));
    const externalChainId = isNum(i.externalChainId)
      ? String(i.externalChainId)
      : isNum(r.externalChainId)
        ? String(r.externalChainId)
        : "";
    items.push({
      direction: "in",
      status: bridgeStatus(i.bridgeStatus),
      amount: fmt18(i.stratoTokenAmount),
      symbol: "",
      externalChainId,
      counterparty: `0x${String(i.externalSender ?? "").replace(/^0x/, "")}`,
      timestamp: parseTs(r.block_timestamp),
      stratoToken: String(i.stratoToken ?? "").replace(/^0x/, "").toLowerCase(),
    });
  }

  // Enrich with STRATO token symbols.
  const tokenAddrs = [...new Set(items.map((i) => i.stratoToken).filter(Boolean))];
  if (tokenAddrs.length) {
    const rows = await cget(
      `${base}/BlockApps-Token?address=in.(${tokenAddrs.join(",")})&select=address,_symbol`
    ).catch(() => []);
    const map = new Map(rows.map((t: any) => [String(t.address).toLowerCase(), t._symbol]));
    for (const i of items) i.symbol = map.get(i.stratoToken) ?? "token";
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.slice(0, 50);
}

const GAS = { gasLimit: 32_100_000_000, gasPrice: 1 };

/** STRATO -> EVM. BLOC approve + requestWithdrawal (standard or native route). */
export async function executeWithdrawal(
  stratoNetwork: StratoNetwork,
  config: BridgeConfig,
  from: Address,
  route: BridgeRoute,
  stratoTokenAmount: string, // base units (18)
  externalRecipient: string
): Promise<any[]> {
  const recipient = externalRecipient.replace(/^0x/, "");
  if (route.routeType === "native") {
    if (!config.nativeBridgeAddr || !config.custodyVault) {
      throw new Error("Native bridge is not configured on this node");
    }
    return sendBlocCalls(
      stratoNetwork,
      from,
      [
        {
          contractName: "Token",
          contractAddress: route.stratoToken,
          method: "approve",
          args: { spender: config.custodyVault, value: stratoTokenAmount },
        },
        {
          contractName: "StratoNativeBridge",
          contractAddress: config.nativeBridgeAddr,
          method: "requestWithdrawal",
          args: {
            externalChainId: route.externalChainId,
            externalRecipient: recipient,
            stratoToken: route.stratoToken,
            stratoTokenAmount,
          },
        },
      ],
      GAS
    );
  }

  const bridge = config.bridgeAddr.replace(/^0x/, "");
  return sendBlocCalls(
    stratoNetwork,
    from,
    [
      {
        contractName: "Token",
        contractAddress: route.stratoToken,
        method: "approve",
        args: { spender: bridge, value: stratoTokenAmount },
      },
      {
        contractName: "MercataBridge",
        contractAddress: bridge,
        method: "requestWithdrawal",
        args: {
          externalChainId: route.externalChainId,
          externalRecipient: recipient,
          externalToken: route.externalToken,
          stratoToken: route.stratoToken,
          stratoTokenAmount,
        },
      },
    ],
    GAS
  );
}

async function waitForReceipt(rpcUrl: string, hash: Hex, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await rpcCall<{ status?: string } | null>(rpcUrl, "eth_getTransactionReceipt", [hash]).catch(
      () => null
    );
    if (r) return;
    await new Promise((res) => setTimeout(res, 3000));
  }
}

/** Ensure `spender` has at least `amount` allowance for `token`; approve max if not. */
async function ensureAllowance(
  evmNetwork: StratoNetwork,
  from: Address,
  token: Hex,
  spender: Hex,
  amount: bigint
): Promise<void> {
  const allowanceHex = await rpcCall<Hex>(evmNetwork.rpcUrl, "eth_call", [
    {
      to: token,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "allowance", args: [from, spender] }),
    },
    "latest",
  ]);
  const allowance = decodeFunctionResult({
    abi: ERC20_ABI,
    functionName: "allowance",
    data: allowanceHex,
  }) as bigint;
  if (allowance >= amount) return;
  const approveHash = await sendEvmTransaction(evmNetwork, {
    from,
    to: token,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, maxUint256] }),
    value: "0",
  });
  await waitForReceipt(evmNetwork.rpcUrl, approveHash);
}

/**
 * EVM -> STRATO. Standard routes: depositETH (native coin) or Permit2 +
 * DepositRouter.deposit (ERC20). Native routes: approve + RepresentationBridge
 * .requestRedemption of the representation token (e.g. wSTRATO).
 */
export async function executeDeposit(
  evmNetwork: StratoNetwork,
  from: Address,
  route: BridgeRoute,
  depositRouter: string,
  amount: string, // external base units
  stratoRecipient: string
): Promise<Hex> {
  const strato = `0x${stratoRecipient.replace(/^0x/, "")}` as Hex;
  const targetStratoToken = `0x${route.stratoToken}` as Hex;

  // Native route: redeem the representation token back to STRATO.
  if (route.routeType === "native") {
    if (!route.externalBridge) throw new Error("Native route missing representation bridge");
    const repToken = `0x${route.externalToken}` as Hex;
    const repBridge = `0x${route.externalBridge}` as Hex;
    await ensureAllowance(evmNetwork, from, repToken, repBridge, BigInt(amount));
    const data = encodeFunctionData({
      abi: REPRESENTATION_BRIDGE_ABI,
      functionName: "requestRedemption",
      args: [repToken, BigInt(amount), strato],
    });
    return sendEvmTransaction(evmNetwork, { from, to: repBridge, data, value: "0" });
  }

  const router = `0x${depositRouter.replace(/^0x/, "")}` as Hex;

  // Standard native coin (ETH): depositETH(stratoAddress, targetStratoToken) payable.
  if (route.externalToken === NATIVE) {
    const data = encodeFunctionData({
      abi: DEPOSIT_ROUTER_ABI,
      functionName: "depositETH",
      args: [strato, targetStratoToken],
    });
    return sendEvmTransaction(evmNetwork, { from, to: router, data, value: amount });
  }

  const token = `0x${route.externalToken}` as Hex;

  // Standard ERC20: Permit2 allowance + signed PermitTransferFrom + deposit.
  await ensureAllowance(evmNetwork, from, token, PERMIT2_ADDRESS, BigInt(amount));

  // Sign the Permit2 PermitTransferFrom (DepositRouter is the spender).
  const nonce = BigInt(Date.now());
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const permitHash = hashTypedData({
    domain: { name: "Permit2", chainId: Number(evmNetwork.chainId), verifyingContract: PERMIT2_ADDRESS },
    types: PERMIT2_TYPES,
    primaryType: "PermitTransferFrom",
    message: {
      permitted: { token, amount: BigInt(amount) },
      spender: router,
      nonce,
      deadline,
    },
  });
  const sig = await keyring.signHash(from, permitHash);
  const signature = `0x${sig.r.replace(/^0x/, "").padStart(64, "0")}${sig.s
    .replace(/^0x/, "")
    .padStart(64, "0")}${(sig.recovery + 27).toString(16).padStart(2, "0")}` as Hex;

  const data = encodeFunctionData({
    abi: DEPOSIT_ROUTER_ABI,
    functionName: "deposit",
    args: [token, BigInt(amount), strato, targetStratoToken, nonce, deadline, signature],
  });
  return sendEvmTransaction(evmNetwork, { from, to: router, data, value: "0" });
}
