import { Interface, JsonRpcProvider, Log, LogDescription, ZeroHash, id } from "ethers";
import { Config, Severity, normalize } from "./config";
import { Alert } from "./rules";
import { cirrus } from "./strato";
import { notify } from "./notify";
import { StateStore } from "./state";

const log = (msg: string) => console.log(`${new Date().toISOString()} [evm] ${msg}`);

/** StratoNativeRepresentationBridge + its OpenZeppelin AccessControl / UUPS / Pausable bases */
export const iface = new Interface([
  "event RepresentationMinted(uint256 sourceChainId, address indexed sourceBridge, uint256 indexed sourceWithdrawalId, address indexed stratoToken, address representationToken, address recipient, uint256 amount, bytes32 mintId)",
  "event RedemptionRequested(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId)",
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
  JSON.stringify(
    Object.fromEntries(
      d.fragment.inputs.map((input, i) => {
        const v = String(d.args[i]);
        return [input.name, input.type === "bytes32" ? ROLE_NAMES[v] || v : v];
      })
    )
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
    while (blocks[chain.chainId] < head) {
      const from = blocks[chain.chainId] + 1;
      const to = Math.min(head, from + cfg.evmLogChunk - 1);
      const logs = await provider.getLogs({ address: chain.bridges.map((b) => `0x${b}`), fromBlock: from, toBlock: to });

      const alerts: Alert[] = [];
      for (const l of logs) {
        const base = { chain: chain.chainId, contract: l.address, block: l.blockNumber, tx: l.transactionHash };
        const d = iface.parseLog(l);
        if (!d) {
          alerts.push({ severity: "high", title: "Unrecognized event on bridge contract", fields: { ...base, topic: l.topics[0] } });
          continue;
        }
        const fields = { ...base, event: d.name, args: argsOf(d) };
        if (d.name === "RepresentationMinted") {
          const problems = await checkMint(cfg, chain.chainId, l, d);
          if (problems.length)
            alerts.push({ severity: "critical", title: "Bridge mint without a matching STRATO withdrawal", fields: { ...fields, problems: problems.join("; ") } });
          continue;
        }
        const severity = d.name in SEVERITY ? SEVERITY[d.name] : "high";
        if (severity) alerts.push({ severity, title: `Bridge ${d.name} on chain ${chain.chainId}`, fields });
      }

      await notify(cfg, alerts);
      blocks[chain.chainId] = to;
      store.save();
      log(`chain ${chain.chainId}: scanned blocks ${from}-${to}, ${logs.length} log(s), ${alerts.length} alert(s)`);
    }
  }
}
