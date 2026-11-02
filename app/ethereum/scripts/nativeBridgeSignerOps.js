const fs = require("fs");
const { ethers } = require("ethers");
const {
  normalizeAddress,
  getRpcUrl,
  buildTransactionBuilderBatch,
} = require("./lib/depositRouterSafeOps");

const ABI = [
  "function attestationSignerCount() view returns (uint8)",
  "function attestationThreshold() view returns (uint8)",
  "function attestationSigners(address) view returns (bool)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function setAttestationSigner(address,bool)",
  "function setAttestationThreshold(uint8)",
];

function normalizeConfig(input) {
  const address = (value) => {
    const result = normalizeAddress(value);
    if (!result || result === ethers.ZeroAddress)
      throw new Error("Invalid nonzero address");
    return result;
  };
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0)
    throw new Error("Invalid chainId");
  const lists = ["attestationSigners", "disabledAttestationSigners"].map(
    (name) => {
      if (!Array.isArray(input[name]))
        throw new Error(`${name} must be an explicit array`);
      return input[name].map(address);
    }
  );
  const all = lists.flat();
  if (new Set(all).size !== all.length)
    throw new Error("Duplicate or overlapping signer lists");
  const threshold = input.attestationThreshold;
  if (
    !Number.isInteger(threshold) ||
    threshold < 2 ||
    threshold > lists[0].length ||
    all.length > 255
  ) {
    throw new Error("Invalid threshold or signer count");
  }
  return {
    chainId: input.chainId,
    bridgeAddress: address(input.bridgeAddress),
    safeAddress: address(input.safeAddress),
    attestationSigners: lists[0],
    disabledAttestationSigners: lists[1],
    attestationThreshold: threshold,
  };
}

function buildSignerOperations(config, state) {
  const all = [
    ...config.attestationSigners,
    ...config.disabledAttestationSigners,
  ];
  if (all.some((signer) => typeof state.enabled[signer] !== "boolean")) {
    throw new Error("Missing signer state");
  }
  if (all.filter((signer) => state.enabled[signer]).length !== state.count) {
    throw new Error(
      "Unaccounted enabled signer: identify it and include it in disabledAttestationSigners before proceeding"
    );
  }
  const additions = config.attestationSigners.filter(
    (signer) => !state.enabled[signer]
  );
  if (state.count + additions.length > 255)
    throw new Error("Intermediate signer count exceeds uint8");
  return [
    ...additions.map((signer) => ({
      method: "setAttestationSigner",
      args: [signer, true],
    })),
    ...(state.threshold === config.attestationThreshold
      ? []
      : [
          {
            method: "setAttestationThreshold",
            args: [config.attestationThreshold],
          },
        ]),
    ...config.disabledAttestationSigners
      .filter((signer) => state.enabled[signer])
      .map((signer) => ({
        method: "setAttestationSigner",
        args: [signer, false],
      })),
  ];
}

async function readState(config, provider) {
  if ((await provider.getNetwork()).chainId !== BigInt(config.chainId))
    throw new Error("RPC chain mismatch");
  const blockTag = await provider.getBlockNumber();
  const bridge = new ethers.Contract(config.bridgeAddress, ABI, provider);
  const all = [
    ...config.attestationSigners,
    ...config.disabledAttestationSigners,
  ];
  const [count, threshold, authorized, ...enabled] = await Promise.all([
    bridge.attestationSignerCount({ blockTag }),
    bridge.attestationThreshold({ blockTag }),
    bridge.hasRole(ethers.id("ATTESTATION_ADMIN_ROLE"), config.safeAddress, {
      blockTag,
    }),
    ...all.map((signer) => bridge.attestationSigners(signer, { blockTag })),
  ]);
  if (!authorized)
    throw new Error("Configured Safe lacks ATTESTATION_ADMIN_ROLE");
  return {
    blockTag,
    count: Number(count),
    threshold: Number(threshold),
    enabled: Object.fromEntries(
      all.map((signer, index) => [signer, enabled[index]])
    ),
  };
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--verify") {
      options.verify = true;
      continue;
    }
    if (
      !["--config", "--output"].includes(argv[i]) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith("--")
    ) {
      throw new Error("Usage: --config FILE [--output FILE | --verify]");
    }
    options[argv[i].slice(2)] = argv[++i];
  }
  if (
    !options.config ||
    (!options.verify && !options.output) ||
    (options.verify && options.output)
  ) {
    throw new Error("Supply --config and either --output or --verify");
  }
  require("dotenv").config();
  const config = normalizeConfig(
    JSON.parse(fs.readFileSync(options.config, "utf8"))
  );
  const rpcUrl = getRpcUrl(config.chainId);
  if (!rpcUrl) throw new Error("RPC URL is required");
  const state = await readState(config, new ethers.JsonRpcProvider(rpcUrl));
  const operations = buildSignerOperations(config, state);
  if (options.verify) {
    if (operations.length)
      throw new Error(
        "Signer configuration does not match; pending additions, removals or threshold change"
      );
    console.log(
      `Verified at block ${state.blockTag}: ${state.threshold}-of-${state.count}; all retired signers disabled`
    );
    return;
  }
  const iface = new ethers.Interface(ABI);
  const transactions = operations.map(({ method, args }) => ({
    to: config.bridgeAddress,
    value: "0",
    data: iface.encodeFunctionData(method, args),
  }));
  const batch = buildTransactionBuilderBatch(
    config.chainId,
    config.safeAddress,
    transactions,
    {
      name: "Native bridge signer replacement",
      description: `Snapshot block ${state.blockTag}. Execute atomically; regenerate if signer state changes. Refresh outstanding attestations afterward.`,
    }
  );
  fs.writeFileSync(options.output, JSON.stringify(batch, null, 2) + "\n");
  console.log(
    `Wrote ${transactions.length} calls to ${options.output}. No transaction submitted. Run --verify after execution.`
  );
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { normalizeConfig, buildSignerOperations, readState };
