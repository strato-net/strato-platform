const fs = require("node:fs");
const { ethers } = require("ethers");
const { normalizeConfig, readState, buildSignerOperations } = require("./nativeBridgeSignerOps");
const { buildTransactionBuilderBatch, getRpcUrl } = require("./lib/depositRouterSafeOps");
const { writeJson } = require("./lib/externalBridgeOrchestration");

function loadArtifact(name) {
  return require(`../artifacts/contracts/bridge/${name}.sol/${name}.json`).abi;
}

async function plan(input, provider, stage = "configure") {
  if (!["configure", "activate", "verify"].includes(stage)) throw new Error("Invalid stage");
  const config = normalizeConfig(input);
  const nonzero = v => { const a = ethers.getAddress(v); if (a === ethers.ZeroAddress) throw new Error("Zero address"); return a; };
  const executor = nonzero(input.executor);
  if (executor === nonzero(input.eabExecutor) || executor === config.safeAddress || config.attestationSigners.includes(executor)) throw new Error("Native executor must be distinct from EAB executor, Safe and signers");
  if (!Array.isArray(input.tokens) || !input.tokens.length) throw new Error("tokens is required");
  if (!/^\d+$/.test(String(input.maxAttestationValiditySeconds)) || BigInt(input.maxAttestationValiditySeconds) === 0n) throw new Error("Explicit maxAttestationValiditySeconds required");
  const tokens = input.tokens.map(t => {
    if (typeof t.freezeRoute !== "boolean" || typeof t.transfersEnabled !== "boolean") throw new Error("Explicit token freezeRoute and transfersEnabled required");
    return { ...t, stratoToken: nonzero(t.stratoToken), representationToken: nonzero(t.representationToken) };
  });
  for (const field of ["stratoToken", "representationToken"]) if (new Set(tokens.map(t => t[field])).size !== tokens.length) throw new Error(`Duplicate ${field}`);
  const state = await readState(config, provider);
  const bridge = new ethers.Contract(config.bridgeAddress, loadArtifact("StratoNativeRepresentationBridge"), provider);
  const opts = { blockTag: state.blockTag };
  const calls = [];
  const add = (contract, method, args) => calls.push({ to: contract.target, value: "0", data: contract.interface.encodeFunctionData(method, args) });
  for (const role of [ethers.ZeroHash, ethers.id("MAPPING_ADMIN_ROLE"), ethers.id("PAUSER_ROLE"), ethers.id("UNPAUSER_ROLE"), ethers.id("MINT_CANCELLER_ROLE"), ethers.id("UPGRADER_ROLE")]) {
    if (!await bridge.hasRole(role, config.safeAddress, opts)) throw new Error("Safe lacks required native configuration role");
  }
  const [paused, mintPaused, redemptionsPaused] = await Promise.all([bridge.paused(opts), bridge.mintsPaused(opts), bridge.redemptionsPaused(opts)]);
  if (String(await bridge.maxAttestationValiditySeconds(opts)) !== String(input.maxAttestationValiditySeconds)) add(bridge, "setMaxAttestationValiditySeconds", [input.maxAttestationValiditySeconds]);
  const pauseCalls = [];
  if (!paused) pauseCalls.push("pause");
  for (const op of buildSignerOperations(config, state)) add(bridge, op.method, op.args);
  if (!await bridge.hasRole(ethers.id("MINT_EXECUTOR_ROLE"), executor, opts)) add(bridge, "grantRole", [ethers.id("MINT_EXECUTOR_ROLE"), executor]);
  for (const t of tokens) {
    const token = new ethers.Contract(t.representationToken, loadArtifact("StratoNativeRepresentationToken"), provider);
    const [forward, reverse, active, frozen, canMint, endpoint, transfers, admin, transferAdmin] = await Promise.all([
      bridge.stratoToRepresentation(t.stratoToken, opts), bridge.representationToStrato(t.representationToken, opts),
      bridge.routeActive(t.stratoToken, opts), bridge.routeFrozen(t.stratoToken, opts),
      token.hasRole(ethers.id("BRIDGE_ROLE"), config.bridgeAddress, opts), token.transferEndpoints(config.bridgeAddress, opts), token.transfersEnabled(opts),
      token.hasRole(ethers.ZeroHash, config.safeAddress, opts), token.hasRole(ethers.id("TRANSFER_ADMIN_ROLE"), config.safeAddress, opts),
    ]);
    if (!admin || !transferAdmin) throw new Error("Safe lacks representation-token configuration roles");
    if (forward !== ethers.ZeroAddress && forward !== t.representationToken || reverse !== ethers.ZeroAddress && reverse !== t.stratoToken) throw new Error("Existing native mapping conflicts; migration requires separate review");
    if (forward === ethers.ZeroAddress) {
      if (reverse !== ethers.ZeroAddress) throw new Error("Inconsistent reverse native mapping");
      add(bridge, "registerTokenMapping", [t.stratoToken, t.representationToken, t.freezeRoute]);
    } else {
      if (reverse !== t.stratoToken) throw new Error("Inconsistent reverse native mapping");
      if (!active) add(bridge, "enableTokenMapping", [t.stratoToken]);
      if (frozen && !t.freezeRoute) throw new Error("Cannot unfreeze an existing route");
      if (!frozen && t.freezeRoute) add(bridge, "freezeTokenMapping", [t.stratoToken]);
    }
    if (!canMint) add(token, "grantRole", [ethers.id("BRIDGE_ROLE"), config.bridgeAddress]);
    if (!endpoint) add(token, "setTransferEndpoint", [config.bridgeAddress, true]);
    if (transfers !== t.transfersEnabled) add(token, "setTransfersEnabled", [t.transfersEnabled]);
  }
  const pendingConfiguration = calls.length;
  if (stage !== "configure" && pendingConfiguration) throw new Error(`${pendingConfiguration} native configuration actions remain; run configure first`);
  if (stage === "configure") {
    if (calls.length || !paused) for (const method of pauseCalls) calls.unshift({ to: bridge.target, value: "0", data: bridge.interface.encodeFunctionData(method, []) });
  } else if (stage === "activate") {
    if (mintPaused) add(bridge, "setMintPaused", [false]);
    if (redemptionsPaused) add(bridge, "setRedemptionsPaused", [false]);
    if (paused) add(bridge, "unpause", []);
  } else if (paused || mintPaused || redemptionsPaused) throw new Error("Native bridge is still paused");
  return { block: state.blockTag, pendingConfiguration, transactions: calls,
    safe: buildTransactionBuilderBatch(config.chainId, config.safeAddress, calls, {
      name: `Native bridge ${stage}`, description: `State read at block ${state.blockTag}. Review and execute atomically.`,
    }) };
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--config", "--stage", "--output"].includes(argv[i]) || !argv[i + 1] || args[argv[i]]) throw new Error("Use --config FILE --stage configure|activate|verify [--output FILE]");
    args[argv[i]] = argv[i + 1];
  }
  if (!args["--config"] || !args["--stage"] || (args["--stage"] !== "verify" && !args["--output"])) throw new Error("Missing config, stage or output");
  require("dotenv").config({ quiet: true });
  const input = JSON.parse(fs.readFileSync(args["--config"], "utf8"));
  const provider = new ethers.JsonRpcProvider(getRpcUrl(input.chainId));
  try {
    const result = await plan(input, provider, args["--stage"]);
    if (args["--output"]) {
      if (fs.existsSync(args["--output"])) throw new Error("Output exists; preserve the reviewed JSON and use a new filename");
      writeJson(args["--output"], result.safe);
    }
    console.log(`${result.transactions.length} pending calls at block ${result.block}. No transaction submitted.`);
  } finally { provider.destroy(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { plan };
