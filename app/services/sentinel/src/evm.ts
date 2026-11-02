import { Interface, JsonRpcProvider, Log, LogDescription, ZeroHash, id } from "ethers";
import { CATCH_UP_MS, CHAIN_NAMES, Config, Severity, normalize } from "./config";
import { Alert, brief, short, units } from "./rules";
import { cirrus } from "./strato";
import { notify } from "./notify";
import { StateStore } from "./state";

const log = (msg: string) => console.log(`${new Date().toISOString()} [evm] ${msg}`);

/** StratoNativeRepresentationBridge + its OpenZeppelin AccessControl / UUPS / Pausable bases.
 *  The routed-redemption, redemption-refund and mint-cancel events come from the newer bridge
 *  version (feature/extassetbridge) already deployed on testnet. */
export const iface = new Interface([
  "event RepresentationMinted(uint256 sourceChainId, address indexed sourceBridge, uint256 indexed sourceWithdrawalId, address indexed stratoToken, address representationToken, address recipient, uint256 amount, bytes32 mintId)",
  "event RedemptionRequested(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId)",
  "event RedemptionRequestedWithRoute(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId, address actionToken, uint256 minFinalOut)",
  "event RedemptionRefunded(uint256 indexed redemptionId, address indexed representationToken, address indexed recipient, uint256 amount)",
  "event NativeMintCanceled(bytes32 indexed mintId, uint256 sourceChainId, address sourceBridge, uint256 sourceWithdrawalId)",
  "event TokenMappingRegistered(address indexed stratoToken, address indexed representationToken, bool frozen)",
  "event TokenMappingDisabled(address indexed stratoToken, address indexed representationToken)",
  "event TokenMappingEnabled(address indexed stratoToken, address indexed representationToken)",
  "event TokenMappingFrozen(address indexed stratoToken, address indexed representationToken)",
  "event TokenMappingMigrated(address indexed stratoToken, address indexed previousRepresentationToken, address indexed newRepresentationToken, bool frozen)",
  "event MintPauseUpdated(bool paused)",
  "event RedemptionPauseUpdated(bool paused)",
  "event AttestationSignerUpdated(address indexed signer, bool enabled)",
  "event AttestationThresholdUpdated(uint8 threshold)",
  "event MaxAttestationValidityUpdated(uint256 previousValiditySeconds, uint256 newValiditySeconds)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)",
  "event Upgraded(address indexed implementation)",
  "event Initialized(uint64 version)",
  "event Paused(address account)",
  "event Unpaused(address account)",
]);

const SEVERITY: Record<string, Severity | null> = {
  RepresentationMinted: null, // checked against STRATO below
  RedemptionRequested: null, // normal user flow
  RedemptionRequestedWithRoute: null, // normal user flow
  RedemptionRefunded: null, // checked against STRATO below
  NativeMintCanceled: "high",
  RoleGranted: "critical",
  RoleRevoked: "critical",
  RoleAdminChanged: "critical",
  Upgraded: "critical",
  Initialized: "critical",
  AttestationSignerUpdated: "critical",
  AttestationThresholdUpdated: "critical",
  MaxAttestationValidityUpdated: "critical",
};

const ROLE_NAMES: Record<string, string> = Object.fromEntries([
  [ZeroHash, "DEFAULT_ADMIN_ROLE"],
  ...["UPGRADER_ROLE", "MAPPING_ADMIN_ROLE", "PAUSER_ROLE", "UNPAUSER_ROLE", "ATTESTATION_ADMIN_ROLE", "MINT_EXECUTOR_ROLE"].map(
    (r) => [id(r), r]
  ),
]);

const argsOf = (d: LogDescription) =>
  Object.fromEntries(
    d.fragment.inputs.map((input, i) => {
      const v = String(d.args[i]);
      return [input.name, input.type === "bytes32" ? ROLE_NAMES[v] || v : v];
    })
  );

/** A representation mint must mirror a non-aborted STRATO withdrawal field for field. */
async function checkMint(cfg: Config, chainId: string, l: Log, d: LogDescription): Promise<string[]> {
  const [row] = await cirrus(cfg, "/BlockApps-StratoNativeBridge-withdrawals", {
    address: `eq.${cfg.stratoNativeBridge}`,
    key: `eq.${d.args.sourceWithdrawalId}`,
    select: "value",
  });
  const w = row?.value;
  const problems: string[] = [];
  if (normalize(d.args.sourceBridge) !== cfg.stratoNativeBridge) problems.push("source bridge is not the STRATO native bridge");
  if (!w) return [...problems, "no STRATO withdrawal with this id"];
  if (String(w.externalChainId) !== chainId) problems.push(`withdrawal is for chain ${w.externalChainId}`);
  if (normalize(w.externalBridge) !== normalize(l.address)) problems.push("withdrawal names a different bridge");
  if (normalize(w.externalRecipient) !== normalize(d.args.recipient)) problems.push("recipient differs");
  if (normalize(w.representationToken) !== normalize(d.args.representationToken)) problems.push("token differs");
  if (String(w.externalTokenAmount) !== d.args.amount.toString()) problems.push(`amount differs (STRATO ${w.externalTokenAmount})`);
  if (String(w.bridgeStatus) === "4") problems.push("STRATO withdrawal was aborted and refunded");
  return problems;
}

/** A refund re-mints a redemption the STRATO side never credited; if STRATO did credit it, the user is paid twice. */
async function refundDoubleSpent(cfg: Config, chainId: string, d: LogDescription): Promise<boolean> {
  const [deposit] = await cirrus(cfg, "/event", {
    address: `eq.${cfg.stratoNativeBridge}`,
    event_name: "eq.NativeDepositCompleted",
    "attributes->>externalChainId": `eq.${chainId}`,
    "attributes->>externalRedemptionId": `eq.${d.args.redemptionId}`,
    limit: 1,
    select: "id",
  });
  return !!deposit;
}

const providers = new Map<string, JsonRpcProvider>();

export function providerFor(chain: Config["evmChains"][number]): JsonRpcProvider {
  if (!providers.has(chain.chainId))
    providers.set(chain.chainId, new JsonRpcProvider(chain.rpcUrl, Number(chain.chainId), { staticNetwork: true }));
  return providers.get(chain.chainId)!;
}

/** Watch the external bridge contracts: every admin-level change alerts, every mint is verified. */
export async function scanEvm(cfg: Config, store: StateStore): Promise<void> {
  const blocks = (store.state.evmBlocks ??= {});
  for (const chain of cfg.evmChains) {
    const provider = providerFor(chain);
    const head = (await provider.getBlockNumber()) - cfg.evmConfirmations;

    if (blocks[chain.chainId] === undefined) {
      blocks[chain.chainId] = head;
      store.save();
      log(`chain ${chain.chainId}: no cursor; starting from block ${head}`);
      continue;
    }

    if (blocks[chain.chainId] >= head) log(`chain ${chain.chainId}: no new blocks after ${blocks[chain.chainId]}`);
    const name = CHAIN_NAMES[chain.chainId] || `chain ${chain.chainId}`;
    const deadline = Date.now() + CATCH_UP_MS;
    while (blocks[chain.chainId] < head && Date.now() < deadline) {
      const from = blocks[chain.chainId] + 1;
      const to = Math.min(head, from + cfg.evmLogChunk - 1);
      const logs = await provider.getLogs({ address: chain.bridges.map((b) => `0x${b}`), fromBlock: from, toBlock: to });

      const alerts: Alert[] = [];
      for (const l of logs) {
        const base = { chain: name, contract: l.address, block: l.blockNumber, tx: l.transactionHash };
        const d = iface.parseLog(l);
        if (!d) {
          alerts.push({ severity: "high", title: `Unrecognized event on ${name} bridge ${short(l.address)}`, fields: { ...base, topic: l.topics[0] } });
          continue;
        }
        const args = argsOf(d);
        const fields = { ...base, event: d.name, args: JSON.stringify(args) };
        if (d.name === "RepresentationMinted") {
          const problems = await checkMint(cfg, chain.chainId, l, d);
          if (problems.length)
            alerts.push({
              severity: "critical",
              title:
                `Bridge mint of ${units(d.args.amount)} on ${name} to ${short(d.args.recipient)} without a matching ` +
                `STRATO withdrawal #${d.args.sourceWithdrawalId}: ${problems.join("; ")}`,
              fields,
            });
          continue;
        }
        if (d.name === "RedemptionRefunded") {
          if (await refundDoubleSpent(cfg, chain.chainId, d))
            alerts.push({
              severity: "critical",
              title:
                `Redemption #${d.args.redemptionId} refunded on ${name} (${units(d.args.amount)} to ${short(d.args.recipient)}) ` +
                `although STRATO already completed its deposit`,
              fields,
            });
          continue;
        }
        const severity = d.name in SEVERITY ? SEVERITY[d.name] : "high";
        if (severity) alerts.push({ severity, title: `${d.name} on ${name} bridge ${short(l.address)}: ${brief(args)}`, fields });
      }

      await notify(cfg, alerts);
      blocks[chain.chainId] = to;
      store.save();
      log(`chain ${chain.chainId}: scanned blocks ${from}-${to}, ${logs.length} log(s), ${alerts.length} alert(s)`);
    }
  }
}
