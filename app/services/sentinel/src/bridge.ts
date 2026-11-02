import { CHAIN_NAMES, Config, MERCATA_BRIDGE, PRICE_ORACLE, normalize } from "./config";
import { Alert, CirrusEvent, eventFields, short, units } from "./rules";
import { cirrus } from "./strato";
import { iface, providerFor } from "./evm";

const WITHDRAWALS = ["WithdrawalRequested", "NativeWithdrawalRequested"];
const ABORTS = ["WithdrawalAborted", "NativeWithdrawalAborted"];

/** Cirrus filter for the STRATO bridge events below */
export const bridgeFilter = (cfg: Config) =>
  `and(address.eq.${MERCATA_BRIDGE},event_name.in.(WithdrawalRequested,WithdrawalAborted))` +
  (cfg.stratoNativeBridge
    ? `,and(address.eq.${cfg.stratoNativeBridge},event_name.in.(NativeWithdrawalRequested,NativeWithdrawalAborted,NativeDepositCompleted))`
    : "");

/** MercataBridge and StratoNativeBridge name the same withdrawal fields differently */
const withdrawalOf = (e: CirrusEvent) =>
  e.event_name === "WithdrawalRequested"
    ? { token: e.attributes.token, amount: e.attributes.stratoTokenAmount, dest: e.attributes.dest, chainId: e.attributes.destChainId, instant: e.attributes.useHotWallet }
    : { token: e.attributes.stratoToken, amount: e.attributes.stratoTokenAmount, dest: e.attributes.externalRecipient, chainId: e.attributes.externalChainId, instant: e.attributes.useInstantPath };

const chainName = (chainId: unknown) => CHAIN_NAMES[String(chainId)] || `chain ${chainId}`;

async function symbolOf(cfg: Config, token: string): Promise<string> {
  const [row] = await cirrus(cfg, "/BlockApps-ERC20", { address: `eq.${token}`, select: "_symbol" });
  return row?._symbol || short(token);
}

/** "2 SILVST to Base Sepolia" */
const describe = async (cfg: Config, w: ReturnType<typeof withdrawalOf>) =>
  `${units(w.amount)} ${await symbolOf(cfg, w.token)} to ${chainName(w.chainId)}`;

/** Large, first-time or instant-path bridge-outs. */
async function checkWithdrawal(cfg: Config, e: CirrusEvent): Promise<Alert | null> {
  const w = withdrawalOf(e);
  const reasons: string[] = [];

  const [[price], what] = await Promise.all([
    cirrus(cfg, "/BlockApps-PriceOracle-prices", { address: `eq.${PRICE_ORACLE}`, key: `eq.${w.token}`, select: "value" }),
    describe(cfg, w),
  ]);
  const usd = price ? (Number(w.amount) / 1e18) * (Number(price.value) / 1e18) : undefined;
  if (usd === undefined) reasons.push("token has no oracle price");
  else if (usd > cfg.bridgeOutAlertUsd) reasons.push(`large ($${Math.round(usd).toLocaleString("en-US")})`);

  const [earlier] = await cirrus(cfg, "/event", {
    id: `lt.${e.id}`,
    or: `(and(event_name.eq.WithdrawalRequested,attributes->>dest.eq.${w.dest}),and(event_name.eq.NativeWithdrawalRequested,attributes->>externalRecipient.eq.${w.dest}))`,
    limit: 1,
    select: "id",
  });
  if (!earlier) reasons.push("first bridge-out to this destination");
  if (String(w.instant) === "true") reasons.push("instant path (no Safe review)");

  if (reasons.length === 0) return null;
  const large = usd !== undefined && usd > cfg.bridgeOutAlertUsd;
  return {
    severity: large ? "critical" : usd === undefined ? "high" : "info",
    title: `Bridge-out #${e.attributes.withdrawalId} of ${what} (${short(w.dest)}): ${reasons.join(", ")}`,
    fields: { token: w.token, chain: chainName(w.chainId), destination: w.dest, usd: usd?.toFixed(2), ...eventFields(e) },
  };
}

/** A refund after the bridge operator moved the withdrawal on (Safe tx created / mint proposal
 *  recorded) can leave a usable external signature — the double-spend path. Admin rejections take
 *  this path too, so it asks for confirmation; a native mint after the refund is critical in evm.ts. */
async function checkAbort(cfg: Config, e: CirrusEvent): Promise<Alert | null> {
  const mercata = e.event_name === "WithdrawalAborted";
  const earlier = (event_name: string) =>
    cirrus<CirrusEvent>(cfg, "/event", {
      address: `eq.${e.address}`,
      event_name,
      "attributes->>withdrawalId": `eq.${e.attributes.withdrawalId}`,
      id: `lt.${e.id}`,
      limit: 1,
      select: "event_name,attributes",
    });
  const [progressed] = await earlier(mercata ? "eq.WithdrawalPending" : "in.(NativeWithdrawalPending,NativeWithdrawalProposalRecorded)");
  if (!progressed) return null;
  const [request] = await earlier(mercata ? "eq.WithdrawalRequested" : "eq.NativeWithdrawalRequested");
  const what = request ? ` of ${await describe(cfg, withdrawalOf(request))}` : "";
  return {
    severity: "high",
    title: `Bridge-out #${e.attributes.withdrawalId}${what} refunded after ${progressed.event_name}: confirm the external payout was cancelled`,
    fields: eventFields(e),
  };
}

/** A native deposit unlocks STRATO tokens; it must mirror a RedemptionRequested on the external bridge. */
async function checkDeposit(cfg: Config, e: CirrusEvent): Promise<Alert | null> {
  const a = e.attributes;
  const what = `Bridge deposit ${String(a.depositId).slice(0, 10)}… of ${units(a.stratoTokenAmount)} ${await symbolOf(cfg, a.stratoToken)} from ${chainName(a.externalChainId)} to ${short(a.stratoRecipient)}`;
  const unverified = (reason: string): Alert => ({
    severity: "high",
    title: `${what} could not be verified: ${reason}`,
    fields: { ...eventFields(e), problems: reason },
  });
  const chain = cfg.evmChains.find((c) => c.chainId === String(a.externalChainId));
  if (!chain) return unverified(`chain ${a.externalChainId} is not monitored`);

  const receipt = await providerFor(chain).getTransactionReceipt(a.externalTxHash);
  // public RPCs drop older receipts, so a miss is not proof of a forged deposit
  if (!receipt) return unverified("external tx not found by the RPC");

  const [deposit] = await cirrus(cfg, "/BlockApps-StratoNativeBridge-deposits", {
    address: `eq.${e.address}`,
    key: `eq.${a.depositId}`,
    select: "value",
  });
  const redemption = receipt.logs
    .filter((l) => normalize(l.address) === normalize(a.externalBridge))
    .map((l) => iface.parseLog(l))
    .find(
      (d) =>
        (d?.name === "RedemptionRequested" || d?.name === "RedemptionRequestedWithRoute") &&
        d.args.redemptionId.toString() === String(a.externalRedemptionId)
    );
  const problems: string[] = [];
  if (receipt.status !== 1) problems.push("external tx reverted");
  else if (!redemption) problems.push("no RedemptionRequested with this id in the external tx");
  else {
    if (normalize(redemption.args.sender) !== normalize(a.externalSender)) problems.push("sender differs");
    if (normalize(redemption.args.stratoRecipient) !== normalize(a.stratoRecipient)) problems.push("recipient differs");
    if (redemption.args.amount.toString() !== String(a.stratoTokenAmount))
      problems.push(`amount differs (external ${units(redemption.args.amount)})`);
    if (normalize(redemption.args.representationToken) !== normalize(deposit?.value?.representationToken || ""))
      problems.push("representation token differs");
  }
  return problems.length
    ? {
        severity: "critical",
        title: `${what} has no matching redemption on ${chainName(a.externalChainId)}: ${problems.join("; ")}`,
        fields: { ...eventFields(e), problems: problems.join("; ") },
      }
    : null;
}

export async function checkBridge(cfg: Config, events: CirrusEvent[]): Promise<Alert[]> {
  const alerts: (Alert | null)[] = [];
  for (const e of events) {
    if (e.address !== MERCATA_BRIDGE && e.address !== cfg.stratoNativeBridge) continue;
    if (WITHDRAWALS.includes(e.event_name)) alerts.push(await checkWithdrawal(cfg, e));
    else if (ABORTS.includes(e.event_name)) alerts.push(await checkAbort(cfg, e));
    else if (e.event_name === "NativeDepositCompleted") alerts.push(await checkDeposit(cfg, e));
  }
  return alerts.filter((a): a is Alert => a !== null);
}
